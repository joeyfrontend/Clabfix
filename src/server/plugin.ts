/**
 * ── src/server/plugin.ts ────────────────────────────────
 * CHANGES (Problems 2 & 5):
 *  1. /api/exec: spawn uses ['bash', '-c', command] with { cwd } as option
 *     object — never interpolated into shell string. Handles paths with spaces.
 *  2. /api/exec: stdout/stderr streamed to SSE immediately (no buffering).
 *  3. /api/exec: proper error handling — all errors return JSON, never crash.
 *  4. /api/cwd POST: auto-runs health check command after CWD change.
 *  5. /api/fs: accepts optional initialPath param for directory picker.
 *  6. /api/fs: falls back to user home dir when path is "/" or invalid.
 */

import type { Plugin, Connect } from "vite";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { globalLogStream, activeProcesses, killAllProcesses } from "./events";
import { AIRequestError, createAIService, checkCommandSafety, type AIRequest } from "./ai";

function parseBody(req: Connect.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

export function clabfixApi(options: { apiKey?: string; model?: string } = {}): Plugin {
  let labDir = process.cwd();
  const aiService = createAIService({
    apiKey: options.apiKey,
    model: options.model,
    getLabDir: () => labDir,
  });

  return {
    name: "clabfix-api",
    configureServer(server) {
      // ── /api/fs — File system browser for DirectoryPicker ──
      server.middlewares.use("/api/fs", (req, res, next) => {
        if (req.method === "GET") {
          const url = new URL(req.url || "/", `http://${req.headers.host}`);
          let dirPath = url.searchParams.get("path") || process.cwd();

          // Problem 5: If path is "/" or empty, fall back to user home dir
          if (dirPath === "/" || !dirPath) {
            dirPath = os.homedir();
          }

          // Validate the path exists; if not, fall back to home
          try {
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
              dirPath = os.homedir();
            }
          } catch {
            dirPath = os.homedir();
          }

          try {
            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            const folders = items
              .filter(item => item.isDirectory() && !item.name.startsWith('.'))
              .map(item => ({
                name: item.name,
                path: path.join(dirPath, item.name).replace(/\\/g, '/'),
              }));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              folders,
              current: dirPath.replace(/\\/g, '/'),
              home: os.homedir().replace(/\\/g, '/'),
            }));
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
        next();
      });

      // ── /api/ai — AI requests ──
      server.middlewares.use("/api/ai", (req, res) => {
        // Disable Node.js server timeouts immediately — AI agentic loop can take 10+ minutes
        req.setTimeout(0);
        res.setTimeout(0);

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        parseBody(req)
          .then(async (body: AIRequest) => {
            try {
              const text = await aiService.request(body);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ text }));
            } catch (error) {
              const aiError =
                error instanceof AIRequestError
                  ? error
                  : new AIRequestError(error instanceof Error ? error.message : String(error));

              res.statusCode = aiError.statusCode;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: aiError.message,
                  retryAfterMs: aiError.retryAfterMs ?? null,
                })
              );
            }
          })
          .catch(() => {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request body" }));
          });
      });

      // ── /api/cwd — Get/set working directory ──
      server.middlewares.use("/api/cwd", (req, res) => {
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ cwd: labDir }));
          return;
        }

        if (req.method === "POST") {
          parseBody(req)
            .then(({ cwd }) => {
              labDir = cwd;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ cwd: labDir }));

              // Problem 2: Auto-run health check after CWD change so
              // the terminal shows signs of life immediately.
              const healthCmd = `echo "▶ Terminal ready — $(pwd)"`;
              const child = spawn("bash", ["-c", healthCmd], { cwd: labDir });
              child.stdout.on("data", (data) => {
                globalLogStream.log(
                  JSON.stringify({ type: "stdout", text: data.toString() })
                );
              });
              child.on("close", () => {
                globalLogStream.log(
                  JSON.stringify({ type: "done", text: "[CWD changed]" })
                );
              });
              child.on("error", () => {}); // Swallow — CWD was already set
            })
            .catch(() => {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Bad request" }));
            });
          return;
        }

        res.statusCode = 405;
        res.end();
      });

      // ── /api/stream — SSE event stream ──
      server.middlewares.use("/api/stream", (req, res) => {
        // Disable timeout for long-lived SSE connection
        req.setTimeout(0);
        res.setTimeout(0);

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });

        // Keepalive ping every 15s — prevents browser/proxy from killing the connection
        const keepalive = setInterval(() => {
          res.write(":keepalive\n\n");
        }, 15_000);

        const onLog = (data: string) => {
          try {
            if (!res.writableEnded) {
              res.write(`data: ${data}\n\n`);
            }
          } catch (e) {
            // Socket likely closed, ignore to prevent server crash
          }
        };

        globalLogStream.on("log", onLog);
        
        const cleanup = () => {
          clearInterval(keepalive);
          globalLogStream.off("log", onLog);
        };
        
        req.on("close", cleanup);
        req.on("error", cleanup);
        res.on("error", cleanup);
      });

      // ── /api/topology — Read .clab.yml from CWD ──
      server.middlewares.use("/api/topology", (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const files = fs.readdirSync(labDir).filter((f: string) => f.endsWith(".clab.yml") || f.endsWith(".clab.yaml"));
          if (files.length === 0) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ found: false, yaml: "", filename: "" }));
            return;
          }
          const filename = files[0];
          const content = fs.readFileSync(path.join(labDir, filename), "utf8");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ found: true, yaml: content, filename }));
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // ── /api/confirm — Approve/deny destructive commands ──
      server.middlewares.use("/api/confirm", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        parseBody(req)
          .then(({ approved }) => {
            globalLogStream.respondConfirm(!!approved);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, approved: !!approved }));
          })
          .catch(() => {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request" }));
          });
      });

      // ── /api/kill — Kill running commands ──
      server.middlewares.use("/api/kill", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const killedCount = killAllProcesses();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, killed: killedCount }));
      });

      // ── /api/exec — Execute commands from terminal/frontend ──
      // spawn with ['bash', '-c', command] and { cwd } as
      // option — safe for paths containing spaces. All errors caught and
      // returned as JSON, never crash the SSE connection.
      server.middlewares.use("/api/exec", (req, res) => {
        req.setTimeout(0);
        res.setTimeout(0);

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        parseBody(req)
          .then(({ command }) => {
            if (!command || typeof command !== "string") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({
                stdout: "",
                stderr: "",
                exitCode: 1,
                error: "No command provided",
              }));
              return;
            }

            // Safety check for manual commands
            const safety = checkCommandSafety(command, labDir);
            if (safety.action === "reject") {
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[BLOCKED] ${safety.reason}\n` }));
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ stdout: "", stderr: safety.reason, exitCode: 1, error: `Blocked: ${safety.reason}` }));
              return;
            }

            let cmdToRun = command;
            if (safety.action === "auto_fix") {
              cmdToRun = safety.fixed;
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[AUTO-FIX] ${safety.reason}\n` }));
            }

            globalLogStream.log(JSON.stringify({ type: "exec", text: `$ ${cmdToRun}` }));

            // Strip ANSI escape codes for clean terminal display
            const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

            const child = spawn("bash", ["-c", cmdToRun], { cwd: labDir, detached: true });
            activeProcesses.add(child);
            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (data) => {
              const str = data.toString();
              stdout += str;
              globalLogStream.log(JSON.stringify({ type: "stdout", text: stripAnsi(str) }));
            });

            child.stderr.on("data", (data) => {
              const str = data.toString();
              stderr += str;
              globalLogStream.log(JSON.stringify({ type: "stderr", text: stripAnsi(str) }));
            });

            let responseSent = false;
            // Use 'exit' instead of 'close' to not wait for lingering daemons
            child.on("exit", (code) => {
              setTimeout(() => {
                if (responseSent) return;
                responseSent = true;
                activeProcesses.delete(child);
                globalLogStream.log(
                  JSON.stringify({ type: "done", text: `[exit ${code ?? 137}]` })
                );
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: code ?? 0,
                    error: code !== 0 ? `Process exited with code ${code}` : null,
                  })
                );
              }, 50);
            });

            child.on("error", (error) => {
              if (responseSent) return;
              responseSent = true;
              activeProcesses.delete(child);
              globalLogStream.log(
                JSON.stringify({ type: "error", text: `Error: ${error.message}` })
              );
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  exitCode: 1,
                  error: error.message,
                })
              );
            });
          })
          .catch((err) => {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              stdout: "",
              stderr: "",
              exitCode: 1,
              error: err?.message || "Invalid request body",
            }));
          });
      });
    },
  };
}
