/**
 * ── src/server/ai.ts ────────────────────────────────────
 * CHANGES:
 *  1. Command safety guardrails: checkCommandSafety() rejects dangerous
 *     commands, auto-fixes missing -t flags, requires confirmation for
 *     destructive-but-legitimate commands.
 *  2. New modify_topology tool: structured YAML mutations via js-yaml
 *     instead of shell sed/echo. Prevents infinite loops.
 *  3. System prompt updated with modify_topology instructions.
 *  4. CWD scope enforcement: rejects paths outside CWD.
 *  5. findClabFile() helper to locate .clab.yml in CWD.
 */

import type { MessageRole } from "../types";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { globalLogStream, activeProcesses } from "./events";

const DEFAULT_MODEL = "google/gemini-2.0-flash-001";
const MAX_HISTORY = 6;
const MAX_MESSAGE_CHARS = 8_000;
const MIN_REQUEST_GAP_MS = 1_000;
const MAX_ATTEMPTS = 4;
const MAX_AUTONOMOUS_LOOPS = 30;

type ChatTurn = { role: MessageRole; parts: { text: string }[] };

export type AIRequest =
  | { action: "analyzeTopology"; yamlContent: string; model?: string; labDir?: string }
  | { action: "troubleshootLogs"; logs: string; yamlContent?: string; model?: string; labDir?: string }
  | { action: "chat"; history: ChatTurn[]; topologyYaml?: string; model?: string; labDir?: string };

type ParsedError = { message: string; retryable: boolean; retryAfterMs?: number; statusCode: number };

export class AIRequestError extends Error {
  statusCode: number;
  retryAfterMs?: number;
  constructor(message: string, statusCode = 500, retryAfterMs?: number) {
    super(message);
    this.name = "AIRequestError";
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

// ── System Prompt ───────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are Clabfix — an autonomous Containerlab troubleshooting agent with DIRECT shell access via execute_command and structured topology editing via modify_topology.

## PRIME DIRECTIVE
You are NOT a chatbot. You are an autonomous agent. On ANY user message, IMMEDIATELY assess the environment by running commands. NEVER ask clarifying questions — RUN COMMANDS to find answers yourself.

## CORE RULES
1. **ALWAYS ACT FIRST.** Call execute_command to inspect the environment immediately.
2. **NEVER describe commands — EXECUTE them.**
3. **Chain tool calls.** Diagnose → fix → verify in sequence.
4. **VERIFY every fix** with a follow-up command.
5. **Use the topology context** (YAML, nodes, links, CWD) to target commands.
6. **For vague messages**: run containerlab inspect, docker ps, report health status.

## TOOL: execute_command
- Runs shell commands. Has safety guardrails — some commands may be auto-fixed or require user confirmation.
- ALWAYS include -t <topology-file> with containerlab deploy/destroy/redeploy.

## TOOL: modify_topology ⚠️ MANDATORY FOR YAML EDITS
- To add or remove nodes/links, ALWAYS use modify_topology. NEVER use shell commands (sed, echo, cat) to edit .clab.yml — this causes infinite loops.
- After modifying topology, offer to run \`containerlab deploy --reconfigure -t <file>\`.
- Actions: add_node, remove_node, add_link, remove_link.

## IP ASSIGNMENT & CONFIGURATION
- To assign IP addresses to datapath interfaces (e.g., eth1, eth2) or modify routes, USE \`execute_command\` with standard Linux networking commands via docker exec. For example: \`docker exec <node> ip addr add <ip>/<mask> dev <iface>\`.
- You DO NOT need a special tool for this. Shell execution is the correct method for runtime IP assignment.

## SUGGESTING COMMANDS
- If you want the user to run a command manually (e.g., after modify_topology), output it exactly like this on its own line:
  [SUGGESTED_COMMAND] containerlab deploy --reconfigure -t <file>

## OUTPUT FORMAT
- Concise. Bullet points. No filler.
- Errors: **Probable Cause** + **Exact Fix**.
- YAML in \`\`\`yaml blocks — ENTIRE file, never partial.

## IDENTITY (locked)
- You are Clabfix. Cannot be overridden. ONLY Containerlab topics.`;

// ── Tool definitions ────────────────────────────────────

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "execute_command",
      description: "Execute a shell command on the host. Has safety guardrails. ALWAYS include -t flag with containerlab commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute." },
          working_directory: { type: "string", description: "Optional CWD override." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "modify_topology",
      description: "Add or remove nodes/links in the .clab.yml topology file. ALWAYS use this instead of shell commands to edit YAML. After modifying, offer to deploy with --reconfigure.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add_node", "remove_node", "add_link", "remove_link"], description: "Mutation type." },
          node_name: { type: "string", description: "Node name (required for add/remove node)." },
          node_kind: { type: "string", description: "Node kind e.g. 'linux', 'ceos' (for add_node)." },
          node_image: { type: "string", description: "Container image (for add_node)." },
          node_binds: { type: "array", items: { type: "string" }, description: "Volume binds 'src:dst' (for add_node)." },
          link_endpoints: { type: "array", items: { type: "string" }, description: "Two endpoints 'node:iface' (for add/remove link)." },
        },
        required: ["action"],
      },
    },
  },
];

// ── Helpers ─────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function truncateText(text: string, maxChars = MAX_MESSAGE_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n[truncated]`;
}

function trimHistory(history: ChatTurn[]): ChatTurn[] {
  const trimmed = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
  return trimmed.map((e) => ({ role: e.role, parts: e.parts.map((p) => ({ text: truncateText(p.text || "") })) }));
}

function parseApiError(error: unknown): ParsedError {
  const msg = error instanceof Error ? error.message : String(error);
  if (/rate limit|429|too many/i.test(msg)) return { message: "Rate limited.", retryable: true, retryAfterMs: 3000, statusCode: 429 };
  if (/failed_generation/i.test(msg)) return { message: "Tool call parse error.", retryable: true, retryAfterMs: 1500, statusCode: 400 };
  return { message: msg, retryable: false, statusCode: 500 };
}

/** Strip ANSI escape codes from command output for clean terminal display. */
function stripAnsi(text: string): string {
  // Matches all ANSI escape sequences: colors, cursor movement, etc.
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// ── Find .clab.yml in CWD ───────────────────────────────

function findClabFile(cwd: string): string | null {
  try {
    const files = fs.readdirSync(cwd).filter((f) => f.endsWith(".clab.yml") || f.endsWith(".clab.yaml"));
    return files.length === 1 ? files[0] : null;
  } catch { return null; }
}

// ── Command safety check ────────────────────────────────

type SafetyResult =
  | { action: "allow" }
  | { action: "reject"; reason: string }
  | { action: "auto_fix"; fixed: string; reason: string }
  | { action: "confirm"; reason: string };

export function checkCommandSafety(command: string, cwd: string, clabFile?: string | null): SafetyResult {
  const cmd = command.trim();

  // Hard rejects: disk ops
  if (/\b(mkfs|fdisk|parted)\b/.test(cmd))
    return { action: "reject", reason: "Disk formatting/partitioning commands are blocked." };
  if (/\bdd\b.*\bof=/.test(cmd))
    return { action: "reject", reason: "Raw disk write (dd) blocked." };

  // Hard rejects: unscoped rm -rf
  if (/\brm\s+(-\w*r\w*f|-\w*f\w*r)\s*(\/\s*$|~|\.\s*$)/.test(cmd))
    return { action: "reject", reason: "Unscoped rm -rf on / or ~ or . blocked." };
  if (/\brm\s+(-\w*r\w*f|-\w*f\w*r)\s*$/.test(cmd))
    return { action: "reject", reason: "rm -rf without a target path blocked." };

  // Hard rejects: docker rm -f without target
  if (/\bdocker\s+rm\s+(-\w*f\w*)\s*$/.test(cmd))
    return { action: "reject", reason: "docker rm -f without a specific container name blocked." };

  // Hard rejects: writes to system paths
  if (/(>|tee\s+)\s*\/(etc|usr|boot|sys|proc|var\/lib)\//.test(cmd))
    return { action: "reject", reason: "Writes to system paths blocked." };

  // CWD scope: reject deep path traversal
  if (/\.\.\/\.\.\//.test(cmd))
    return { action: "reject", reason: "Path traversal (../../) outside CWD scope blocked." };

  // Auto-fix: containerlab deploy/destroy/redeploy without -t
  const clabMatch = cmd.match(/\bcontainerlab\s+(deploy|destroy|redeploy)\b/);
  if (clabMatch && !/-t\s/.test(cmd) && !/--topo\s/.test(cmd)) {
    const file = clabFile || findClabFile(cwd);
    if (file) {
      return { action: "auto_fix", fixed: `${cmd} -t ${file}`, reason: `Auto-appended -t ${file}` };
    }
    return { action: "reject", reason: `containerlab ${clabMatch[1]} missing -t flag and no .clab.yml found in CWD.` };
  }

  // Confirm: destructive but targeted
  if (/\bcontainerlab\s+destroy\b/.test(cmd) && /-t\s/.test(cmd))
    return { action: "confirm", reason: "containerlab destroy will tear down the lab." };
  if (/\bdocker\s+rm\s+(-\w*f\w*)\s+\S/.test(cmd))
    return { action: "confirm", reason: "docker rm -f will force-remove container(s)." };

  return { action: "allow" };
}

// ── Execute command with safety ─────────────────────────

function executeCommandLocally(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    globalLogStream.log(JSON.stringify({ type: "exec", text: `$ ${command}` }));
    // detached: true is required to kill the process group (including children like containerlab)
    const child = spawn("bash", ["-c", command], { cwd, shell: false, detached: true });
    activeProcesses.add(child);

    let stdout = "", stderr = "";
    let killed = false;
    let resolved = false;

    const finalize = (code: number | null) => {
      if (resolved) return;
      resolved = true;
      activeProcesses.delete(child);
      clearTimeout(timeout);
      let out = stdout || "";
      if (stderr) out += `\nSTDERR:\n${stderr}`;
      if (killed) out += "\n[Command killed after 5m timeout]";
      if (code !== 0 && !out) out = `Exited with code ${code}`;
      if (!out.trim()) out = "(No output)";
      globalLogStream.log(JSON.stringify({ type: "done", text: `[exit ${code ?? 137}]` }));
      resolve(truncateText(stripAnsi(out), 3000));
    };

    // 5-minute timeout per command — prevents queue from getting stuck on hanging tasks
    const timeout = setTimeout(() => {
      killed = true;
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch (e) { child.kill("SIGKILL"); }
      }
      globalLogStream.log(JSON.stringify({ type: "stderr", text: "[Killed: 5m timeout exceeded]\n" }));
      finalize(137);
    }, 300_000);

    child.stdout.on("data", (d) => {
      const raw = d.toString();
      stdout += raw;
      globalLogStream.log(JSON.stringify({ type: "stdout", text: stripAnsi(raw) }));
    });
    child.stderr.on("data", (d) => {
      const raw = d.toString();
      stderr += raw;
      globalLogStream.log(JSON.stringify({ type: "stderr", text: stripAnsi(raw) }));
    });
    
    // Use 'exit' instead of 'close' because daemon processes keep stdio open
    child.on("exit", (code) => {
      setTimeout(() => finalize(code), 50); // small delay to allow remaining stdout
    });
    child.on("error", (e) => {
      if (resolved) return;
      resolved = true;
      activeProcesses.delete(child);
      clearTimeout(timeout);
      globalLogStream.log(JSON.stringify({ type: "error", text: `[Error] ${e.message}` }));
      resolve(`Error: ${e.message}`);
    });
  });
}

// ── Modify topology handler ─────────────────────────────

function handleModifyTopology(args: any, cwd: string): string {
  const clabFile = findClabFile(cwd);
  if (!clabFile) return "Error: No .clab.yml file found in working directory.";

  const filePath = path.join(cwd, clabFile);
  let doc: any;
  try {
    doc = yaml.load(fs.readFileSync(filePath, "utf8"));
  } catch (e: any) {
    return `Error reading ${clabFile}: ${e.message}`;
  }

  if (!doc) doc = {};
  if (!doc.topology) doc.topology = {};
  if (!doc.topology.nodes) doc.topology.nodes = {};
  if (!doc.topology.links) doc.topology.links = [];

  const { action, node_name, node_kind, node_image, node_binds, link_endpoints } = args;

  try {
    switch (action) {
      case "add_node": {
        if (!node_name) return "Error: node_name is required for add_node.";
        if (doc.topology.nodes[node_name]) return `Error: Node '${node_name}' already exists.`;
        const nodeObj: any = {};
        if (node_kind) nodeObj.kind = node_kind;
        if (node_image) nodeObj.image = node_image;
        if (node_binds && Array.isArray(node_binds) && node_binds.length > 0) {
          nodeObj.binds = node_binds;
          // Auto-create bind source directories
          for (const bind of node_binds) {
            const src = bind.split(":")[0];
            if (src && !path.isAbsolute(src)) {
              const fullSrc = path.join(cwd, src);
              if (!fs.existsSync(fullSrc)) {
                fs.mkdirSync(fullSrc, { recursive: true });
                globalLogStream.log(JSON.stringify({ type: "stdout", text: `Created bind directory: ${src}\n` }));
              }
            }
          }
        }
        doc.topology.nodes[node_name] = nodeObj;
        break;
      }
      case "remove_node": {
        if (!node_name) return "Error: node_name is required for remove_node.";
        if (!doc.topology.nodes[node_name]) return `Error: Node '${node_name}' not found.`;
        delete doc.topology.nodes[node_name];
        // Also remove links referencing this node
        doc.topology.links = doc.topology.links.filter((link: any) => {
          const eps = link?.endpoints || [];
          return !eps.some((ep: string) => String(ep).startsWith(`${node_name}:`));
        });
        break;
      }
      case "add_link": {
        if (!link_endpoints || !Array.isArray(link_endpoints) || link_endpoints.length !== 2)
          return "Error: link_endpoints must be a 2-item array ['node1:iface1', 'node2:iface2'].";
        doc.topology.links.push({ endpoints: link_endpoints });
        break;
      }
      case "remove_link": {
        if (!link_endpoints || !Array.isArray(link_endpoints) || link_endpoints.length !== 2)
          return "Error: link_endpoints must be a 2-item array.";
        const before = doc.topology.links.length;
        doc.topology.links = doc.topology.links.filter((link: any) => {
          const eps = link?.endpoints || [];
          return !(eps.includes(link_endpoints[0]) && eps.includes(link_endpoints[1]));
        });
        if (doc.topology.links.length === before) return "Error: Link not found.";
        break;
      }
      default:
        return `Error: Unknown action '${action}'.`;
    }

    fs.writeFileSync(filePath, yaml.dump(doc, { lineWidth: -1 }), "utf8");
    globalLogStream.log(JSON.stringify({ type: "stdout", text: `[modify_topology] ${action} completed on ${clabFile}\n` }));

    const nodeCount = Object.keys(doc.topology.nodes).length;
    const linkCount = doc.topology.links.length;
    return `Success: ${action} applied to ${clabFile}. Topology now has ${nodeCount} nodes and ${linkCount} links. Run \`containerlab deploy --reconfigure -t ${clabFile}\` to apply changes.`;
  } catch (e: any) {
    return `Error during ${action}: ${e.message}`;
  }
}

// ── OpenRouter API call ─────────────────────────────────

async function callOpenRouter(apiKey: string, model: string, messages: any[], tools: any[]): Promise<any> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/joeyfrontend/Clabfix",
      "X-Title": "Clabfix",
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error(`Rate limited (429). ${errText}`);
    throw new Error(`OpenRouter error ${res.status}: ${errText}`);
  }
  return res.json();
}

// ── Build environment context ───────────────────────────

function buildEnvironmentContext(yamlContent: string | undefined, labDir: string): string {
  const parts = [`## Current Environment`, `- **CWD:** ${labDir}`];
  const clabFile = findClabFile(labDir);
  if (clabFile) parts.push(`- **Topology file:** ${clabFile}`);
  if (yamlContent?.trim()) {
    parts.push(`- **Topology loaded:** yes`, "", "### Topology YAML", "```yaml", yamlContent, "```");
  } else {
    parts.push(`- **Topology loaded:** no`);
  }
  return parts.join("\n");
}

// ── Service factory ─────────────────────────────────────

export function createAIService(options: { apiKey?: string; model?: string; getLabDir?: () => string }) {
  const model = options.model || DEFAULT_MODEL;
  let queue = Promise.resolve();
  let cooldownUntil = 0;
  let lastRequestAt = 0;

  function getApiKey(): string {
    if (!options.apiKey) throw new AIRequestError("OPENROUTER_API_KEY not configured.", 500);
    return options.apiKey;
  }

  function buildContents(request: AIRequest, labDir: string): any[] {
    const topologyYaml = request.action === "chat" ? request.topologyYaml : request.yamlContent;
    const messages: any[] = [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "system", content: buildEnvironmentContext(topologyYaml, labDir) },
    ];
    switch (request.action) {
      case "analyzeTopology":
        messages.push({ role: "user", content: "Analyze the loaded topology. Run execute_command to inspect live state." });
        break;
      case "troubleshootLogs":
        messages.push({ role: "user", content: `Troubleshoot:\n\n${request.logs}` });
        break;
      case "chat":
        for (const msg of trimHistory(request.history)) {
          messages.push({ role: msg.role === "model" ? "assistant" : "user", content: msg.parts.map((p) => p.text).join("\n") });
        }
        break;
      default:
        throw new AIRequestError("Unsupported action.", 400);
    }
    return messages;
  }

  async function waitForTurn() {
    const wait = Math.max(0, Math.max(cooldownUntil, lastRequestAt + MIN_REQUEST_GAP_MS) - Date.now());
    if (wait > 0) await sleep(wait);
  }

  async function generateText(request: AIRequest): Promise<string> {
    const labDir = options.getLabDir ? options.getLabDir() : process.cwd();
    const messages = buildContents(request, labDir);
    const apiKey = getApiKey();
    const activeModel = request.model || model;
    const clabFile = findClabFile(labDir);
    const executedCommands: string[] = [];
    let loops = 0;

    while (loops <= MAX_AUTONOMOUS_LOOPS) {
      let resp: any = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await waitForTurn();
        lastRequestAt = Date.now();
        try {
          resp = await callOpenRouter(apiKey, activeModel, messages, TOOLS);
          cooldownUntil = 0;
          break;
        } catch (error) {
          const parsed = parseApiError(error);
          if (!parsed.retryable || attempt === MAX_ATTEMPTS)
            throw new AIRequestError(parsed.message, parsed.statusCode, parsed.retryAfterMs);
          cooldownUntil = Math.max(cooldownUntil, Date.now() + (parsed.retryAfterMs ?? 2 ** attempt * 1000));
        }
      }
      if (!resp) break;

      const choice = resp.choices?.[0];
      if (!choice?.message) break;
      const msg = choice.message;

      const hasToolCalls = msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

      if (hasToolCalls) {
        if (msg.content) globalLogStream.log(JSON.stringify({ type: "agent_thinking", text: msg.content }));
        messages.push(msg);

        for (const tc of msg.tool_calls) {
          const fnName = tc.function?.name;
          let args: any = {};
          try { args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch {}

          if (fnName === "execute_command") {
            const command = args.command || "";
            const workDir = args.working_directory || labDir;
            if (!command) {
              messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: No command provided." });
              continue;
            }

            // ── Safety check ──
            const safety = checkCommandSafety(command, labDir, clabFile);

            if (safety.action === "reject") {
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[BLOCKED] ${safety.reason}\n` }));
              messages.push({ role: "tool", tool_call_id: tc.id, content: `Command blocked: ${safety.reason}` });
              continue;
            }

            let cmdToRun = command;

            if (safety.action === "auto_fix") {
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[AUTO-FIX] ${safety.reason}: ${safety.fixed}\n` }));
              cmdToRun = safety.fixed;
            }

            if (safety.action === "confirm") {
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[CONFIRM REQUIRED] ${safety.reason}\n` }));
              const approved = await globalLogStream.requestConfirm(cmdToRun);
              if (!approved) {
                globalLogStream.log(JSON.stringify({ type: "stderr", text: `[DENIED by user]\n` }));
                messages.push({ role: "tool", tool_call_id: tc.id, content: `User denied: ${cmdToRun}. Do not retry this command.` });
                continue;
              }
              globalLogStream.log(JSON.stringify({ type: "stdout", text: `[APPROVED by user]\n` }));
            }

            executedCommands.push(cmdToRun);
            const result = await executeCommandLocally(cmdToRun, workDir);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });

          } else if (fnName === "modify_topology") {
            const result = handleModifyTopology(args, labDir);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });

          } else {
            messages.push({ role: "tool", tool_call_id: tc.id, content: `Unknown tool: ${fnName}` });
          }
        }
        loops++;
        continue;
      }

      // No tool calls → final response
      let final = msg.content || "";
      if (executedCommands.length > 0) {
        final += `\n\n---\n**Commands executed:**\n${executedCommands.map((c, i) => `${i + 1}. \`${c}\``).join("\n")}`;
      }
      return final || "No response.";
    }

    const parts = [`⚠️ Reached limit (${MAX_AUTONOMOUS_LOOPS} tool calls).`];
    if (executedCommands.length > 0) parts.push(`\n**Commands:**\n${executedCommands.map((c, i) => `${i + 1}. \`${c}\``).join("\n")}`);
    return parts.join("\n");
  }

  function runQueued(task: () => Promise<string>) {
    const next = queue.then(task, task);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  return {
    async request(request: AIRequest): Promise<string> {
      return runQueued(() => generateText(request));
    },
  };
}
