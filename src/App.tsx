/**
 * ── src/App.tsx ──────────────────────────────────────────
 * CHANGES:
 *  Problem 1: topologyYaml is always passed to chatWithAI/analyzeTopology/
 *    troubleshootLogs so the backend can inject context into every request.
 *  Problem 3: Removed controlled `input` state — ChatPanel now manages its
 *    own input via useRef (uncontrolled). handleSend receives text as argument.
 *  Problem 4: Merged inputs — onExecCommand callback handles $ prefix commands.
 *    Global Fix button shows "SCANNING..." state. fixDetails passed to MetricsPanel.
 *  Problem 5: Tracks yamlFileDir (directory of loaded YAML) and passes it to
 *    DirectoryPicker as yamlFilePath.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { cn } from './lib/utils';
import { chatWithAI, analyzeTopology, troubleshootLogs } from './lib/ai';
import { execCommand, extractCodeBlocks, getLabDir, setLabDir, loadTopologyFromDisk } from './lib/api';
import yaml from 'js-yaml';
import type { Message, TabType, NodeInfo, LinkInfo } from './types';
import { createMessage } from './types';

import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import TopologyEditor from './components/TopologyEditor';
import LogAnalyzer from './components/LogAnalyzer';
import ConnectivityCheck from './components/ConnectivityCheck';
import MetricsPanel from './components/MetricsPanel';
import DirectoryPicker from './components/DirectoryPicker';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    createMessage('model', "Welcome to Clabfix. Paste or upload your topology YAML, then run analysis.", 'chat')
  ]);
  // Problem 3: Removed `input` and `setInput` state — ChatPanel is now uncontrolled.
  const [logInput, setLogInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [topologyYaml, setTopologyYaml] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [labDir, setLabDirState] = useState('');
  const [selectedModel, setSelectedModel] = useState('google/gemini-2.0-flash-001');
  const [isDirPickerOpen, setIsDirPickerOpen] = useState(false);
  // Problem 5: Track the directory of the loaded YAML file
  const [yamlFileDir, setYamlFileDir] = useState('');
  // Problem 4: Track executed commands for the clickable fixes counter
  const [fixDetails, setFixDetails] = useState<string[]>([]);
  // Problem 4: Global Fix scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [suggestedCommand, setSuggestedCommand] = useState<string | null>(null);

  // Fetch lab directory on mount and auto-load topology from disk
  useEffect(() => {
    getLabDir().then((dir) => {
      setLabDirState(dir);
      // Auto-load topology from CWD — no manual upload needed
      loadTopologyFromDisk().then(({ found, yaml: content, filename }) => {
        if (found && content) {
          setTopologyYaml(content);
          addMsg('model', `✅ Auto-loaded topology: **${filename}**`);
        }
      });
    }).catch(() => {});
  }, []);

  // Reload topology from disk (called after CWD change & AI responses)
  const reloadTopology = useCallback(async () => {
    const { found, yaml: content } = await loadTopologyFromDisk();
    if (found && content) setTopologyYaml(content);
  }, []);

  // Parse topology YAML
  const parsedTopology = useMemo(() => {
    if (!topologyYaml.trim()) return { nodes: [] as NodeInfo[], links: [] as LinkInfo[], labName: '' };
    try {
      const doc = yaml.load(topologyYaml) as any;
      const labName = doc?.name || '';
      const nodesObj = doc?.topology?.nodes;
      const nodes: NodeInfo[] = nodesObj && typeof nodesObj === 'object'
        ? Object.keys(nodesObj).map((name) => ({
            name, kind: nodesObj[name]?.kind, image: nodesObj[name]?.image, status: 'running' as const,
          }))
        : [];
      const linksArr = doc?.topology?.links;
      const links: LinkInfo[] = [];
      if (Array.isArray(linksArr)) {
        linksArr.forEach((link: any) => {
          const endpoints = link?.endpoints;
          if (Array.isArray(endpoints) && endpoints.length === 2) {
            const [a, b] = endpoints.map((ep: string) => {
              const parts = String(ep).split(':');
              return { node: parts[0] || '', iface: parts[1] || '' };
            });
            if (a.node && b.node) {
              links.push({ sourceNode: a.node, sourceInterface: a.iface, targetNode: b.node, targetInterface: b.iface });
            }
          }
        });
      }
      return { nodes, links, labName };
    } catch {
      return { nodes: [] as NodeInfo[], links: [] as LinkInfo[], labName: '' };
    }
  }, [topologyYaml]);

  const { nodes: parsedNodes, links: parsedLinks, labName } = parsedTopology;
  const fixCount = messages.filter(m => m.type === 'fix').length;

  const addMsg = useCallback((role: 'user' | 'model', text: string, type: 'chat' | 'diagnostic' | 'fix' = 'diagnostic') => {
    setMessages(prev => [...prev, createMessage(role, text, type)]);
  }, []);

  // Extract executed commands from a response text for fixDetails
  const extractCommands = useCallback((text: string) => {
    const match = text.match(/\*\*Commands executed.*?\*\*\n([\s\S]*?)$/);
    if (match) {
      const cmds = match[1].match(/`([^`]+)`/g);
      if (cmds) {
        setFixDetails(prev => [...prev, ...cmds.map(c => c.replace(/`/g, ''))]);
      }
    }
  }, []);

  // ── Handlers ──────────────────────────────────────────

  // Problem 3: handleSend now receives text as argument (from uncontrolled input)
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg = createMessage('user', text, 'chat');
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsTyping(true);
    try {
      const history = newMessages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
      let response = await chatWithAI(history, topologyYaml, selectedModel);
      
      const suggestedMatch = response.match(/\[SUGGESTED_COMMAND\]\s*(.+)/);
      if (suggestedMatch) {
        setSuggestedCommand(suggestedMatch[1].trim());
        response = response.replace(/\[SUGGESTED_COMMAND\]\s*(.+)/g, '').trim();
      } else {
        // Fallback: look for a single-line command in a markdown code block (bash/sh/no-lang)
        const blocks = extractCodeBlocks(response);
        const cmdBlock = blocks.find(b => 
          ['bash', 'sh', 'shell', ''].includes(b.lang) && 
          !['yaml', 'yml'].includes(b.lang) && 
          b.code.trim().length > 0 && 
          !b.code.trim().includes('\n')
        );
        
        let cmd = null;
        if (cmdBlock) {
          cmd = cmdBlock.code.trim();
        } else {
          // Try to find an inline code block (single backticks) that looks like a command
          const inlineMatch = response.match(/`([^`\n]+)`/);
          if (inlineMatch) {
            const potentialCmd = inlineMatch[1].trim();
            if (/^(containerlab|clab|docker|ping|ip)\b/.test(potentialCmd)) {
              cmd = potentialCmd;
            }
          }
          
          // Final fallback: just look for ANY line in the response that starts with a known command
          if (!cmd) {
            const lines = response.split('\n');
            const cmdLine = lines.find(l => /^(containerlab|clab|docker|ping|ip)\b/.test(l.trim()));
            if (cmdLine) {
              // Strip markdown formatting like list bullets or bold if the AI mixed them up
              cmd = cmdLine.replace(/^[-*0-9.]+\s*/, '').replace(/\*\*/g, '').trim();
            }
          }
        }
        setSuggestedCommand(cmd);
      }

      setMessages(prev => [...prev, createMessage('model', response || "No response.", 'chat')]);
      extractCommands(response);
      // Reload topology in case modify_topology changed the YAML
      reloadTopology();
    } catch (err: any) {
      console.error('Chat error:', err);
      const detail = err?.message || String(err);
      setMessages(prev => [...prev, createMessage('model', `⚠️ **API Error:** ${detail}`, 'chat')]);
    } finally {
      setIsTyping(false);
    }
  }, [messages, topologyYaml, selectedModel, extractCommands, reloadTopology]);

  // Problem 4: Direct exec command handler (for $ prefix in unified input)
  const handleExecCommand = useCallback(async (command: string) => {
    addMsg('user', `$ ${command}`, 'diagnostic');
    try {
      const result = await execCommand(command);
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      if (output) {
        addMsg('model', `\`\`\`\n${output}\n\`\`\``, 'diagnostic');
      } else {
        addMsg('model', "✅ Command completed (no output).", 'diagnostic');
      }
      if (result.error) {
        addMsg('model', `⚠️ ${result.error}`, 'diagnostic');
      }
    } catch {
      addMsg('model', `⚠️ Failed to execute command.`, 'diagnostic');
    }
  }, [addMsg]);

  const handleTopologyAnalyze = useCallback(async () => {
    if (!topologyYaml.trim()) return;
    try { yaml.load(topologyYaml); } catch (e: any) {
      addMsg('model', `⚠️ **YAML Error:**\n\`\`\`\n${e.message}\n\`\`\``);
      return;
    }
    setIsTyping(true);
    try {
      const analysis = await analyzeTopology(topologyYaml, selectedModel);
      addMsg('user', "Topology Analysis", 'diagnostic');
      addMsg('model', analysis || "No issues found.", 'fix');
      extractCommands(analysis);
      reloadTopology();
      setActiveTab('chat');
    } catch (err: any) {
      console.error('Analysis error:', err);
      addMsg('model', `⚠️ Analysis failed: ${err?.message || err}`);
    } finally {
      setIsTyping(false);
    }
  }, [topologyYaml, selectedModel, addMsg, extractCommands, reloadTopology]);

  const handleLogAnalysis = useCallback(async () => {
    if (!logInput.trim()) return;
    setIsTyping(true);
    try {
      const result = await troubleshootLogs(logInput, topologyYaml, selectedModel);
      addMsg('user', "Log Analysis", 'diagnostic');
      addMsg('model', result || "No issues.", 'fix');
      extractCommands(result);
      setActiveTab('chat');
    } catch (err: any) {
      console.error('Log error:', err);
      addMsg('model', `⚠️ Log analysis failed: ${err?.message || err}`);
    } finally {
      setIsTyping(false);
    }
  }, [logInput, topologyYaml, selectedModel, addMsg, extractCommands]);

  const handleConnectivityCheck = useCallback(async () => {
    if (!topologyYaml.trim()) { addMsg('model', "⚠️ Load a topology first."); return; }
    setIsTyping(true);
    try {
      const response = await troubleshootLogs(
        "Connectivity check: which node pairs can/cannot reach each other and why.",
        topologyYaml,
        selectedModel
      );
      addMsg('user', "Connectivity Check", 'diagnostic');
      addMsg('model', response || "Check complete.", 'fix');
      extractCommands(response);
      setActiveTab('chat');
    } catch (err: any) {
      console.error('Connectivity error:', err);
      addMsg('model', `⚠️ Connectivity check failed: ${err?.message || err}`);
    } finally {
      setIsTyping(false);
    }
  }, [topologyYaml, selectedModel, addMsg, extractCommands]);

  // ── Apply Fix: YAML ──────────────────────────────────

  const handleApplyYaml = useCallback((msg: Message) => {
    const blocks = extractCodeBlocks(msg.content);
    const yamlBlock = blocks.find(b => ['yaml', 'yml'].includes(b.lang));
    if (!yamlBlock) {
      addMsg('model', "⚠️ No YAML block found in this fix.");
      return;
    }
    // Validate YAML
    try { yaml.load(yamlBlock.code); } catch (e: any) {
      addMsg('model', `⚠️ Fix YAML is invalid:\n\`\`\`\n${e.message}\n\`\`\``);
      return;
    }
    setTopologyYaml(yamlBlock.code);
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, dismissed: true } : m));
    addMsg('model', "✅ YAML updated. Switch to **YAML Definition** tab to review.");
  }, [addMsg]);

  // ── Apply Fix: Run Commands ──────────────────────────

  const handleRunCommand = useCallback(async (msg: Message) => {
    const blocks = extractCodeBlocks(msg.content);
    const cmdBlocks = blocks.filter(b => ['bash', 'sh', 'shell', ''].includes(b.lang) && !['yaml', 'yml'].includes(b.lang));
    if (cmdBlocks.length === 0) {
      addMsg('model', "⚠️ No command blocks found.");
      return;
    }
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, dismissed: true } : m));

    for (const block of cmdBlocks) {
      const script = block.code.trim();
      if (!script) continue;

      addMsg('user', `Executing Script:\n\`\`\`bash\n${script}\n\`\`\``, 'diagnostic');
      try {
        const result = await execCommand(script);
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        if (output) {
          addMsg('model', `\`\`\`\n${output}\n\`\`\``, 'diagnostic');
        } else {
          addMsg('model', "✅ Script completed (no output).", 'diagnostic');
        }
        if (result.error) {
          addMsg('model', `⚠️ ${result.error}`, 'diagnostic');
        }
        setFixDetails(prev => [...prev, script]);
      } catch {
        addMsg('model', `⚠️ Failed to execute script.`, 'diagnostic');
      }
    }
  }, [addMsg]);

  const handleDismiss = useCallback((id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, dismissed: true } : m));
  }, []);

  const handleRescan = useCallback(() => {
    if (topologyYaml.trim()) handleTopologyAnalyze();
    else addMsg('model', "⚠️ No topology loaded.");
  }, [topologyYaml, handleTopologyAnalyze, addMsg]);

  // Problem 4: Global Fix with SCANNING state and streaming results
  const handleGlobalFix = useCallback(async () => {
    if (!topologyYaml.trim()) { addMsg('model', "⚠️ No topology loaded."); return; }
    setIsScanning(true);
    setIsTyping(true);
    try {
      const prompt = `Generate a single remediation script for ALL issues found. Include both YAML fixes and shell commands.`;
      const response = await chatWithAI([
        ...messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
        { role: 'user' as const, parts: [{ text: prompt }] }
      ], topologyYaml, selectedModel);
      addMsg('user', "Global Fix", 'diagnostic');
      addMsg('model', response || "Done.", 'fix');
      extractCommands(response);
    } catch (err: any) {
      console.error('Global fix error:', err);
      addMsg('model', `⚠️ Global fix failed: ${err?.message || err}`);
    } finally {
      setIsTyping(false);
      setIsScanning(false);
    }
  }, [messages, topologyYaml, selectedModel, addMsg, extractCommands]);

  // ── Render ────────────────────────────────────────────

  return (
    <div className="h-screen w-full bg-clab-bg text-clab-text font-mono flex overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        nodes={parsedNodes}
        links={parsedLinks}
        hasTopology={!!topologyYaml.trim()}
        labName={labName}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 border-b border-clab-border flex items-center px-6 justify-between bg-clab-panel shrink-0">
          <div className="flex space-x-8">
            <div className="flex flex-col">
              <span className="text-[9px] text-clab-muted uppercase leading-none mb-1">Nodes</span>
              <span className="text-sm font-bold text-clab-accent">{parsedNodes.length || '—'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-clab-muted uppercase leading-none mb-1">Links</span>
              <span className="text-sm font-bold text-clab-accent">{parsedLinks.length || '—'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-clab-muted uppercase leading-none mb-1">Engine</span>
              <span className={cn("text-sm font-bold", isTyping ? "text-clab-warning" : "text-clab-accent")}>
                {isTyping ? "Analyzing..." : "Ready"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-black/40 border border-clab-border text-clab-accent text-[10px] uppercase font-bold p-1 outline-none cursor-pointer"
            >
              <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
              <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
              <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
              <option value="qwen/qwen-2.5-coder-32b-instruct">Qwen 2.5 Coder</option>
            </select>
            {labDir && (
              <div
                className="text-[10px] text-clab-muted uppercase tracking-tight truncate max-w-[400px] cursor-pointer hover:text-white transition-colors bg-black/20 px-2 py-1 rounded"
                title="Click to change working directory"
                onClick={() => setIsDirPickerOpen(true)}
              >
                CWD: {labDir}
              </div>
            )}
          </div>
        </header>

        <section className="flex-1 min-h-0 overflow-hidden grid grid-cols-12">
          <div className="col-span-9 flex flex-col min-h-0 border-r border-clab-border">
            {activeTab === 'chat' && (
              <ChatPanel
                messages={messages}
                onSend={handleSend}
                onExecCommand={handleExecCommand}
                isTyping={isTyping}
                onApplyYaml={handleApplyYaml}
                onRunCommand={handleRunCommand}
                onDismiss={handleDismiss}
                suggestedCommand={suggestedCommand}
                onClearSuggestedCommand={() => setSuggestedCommand(null)}
              />
            )}
            {activeTab === 'topology' && (
              <TopologyEditor
                topologyYaml={topologyYaml} setTopologyYaml={setTopologyYaml}
                onAnalyze={handleTopologyAnalyze} isAnalyzing={isTyping}
                onFileLoaded={(fileName) => {
                  addMsg('model', `✅ Loaded topology file: **${fileName}**`);
                  // Problem 5: Extract directory from file name for DirectoryPicker
                  // The fileName is just the name — we'll use the current labDir
                  setYamlFileDir(labDir);
                  setIsDirPickerOpen(true);
                }}
              />
            )}
            {activeTab === 'logs' && (
              <LogAnalyzer
                logInput={logInput} setLogInput={setLogInput}
                onAnalyze={handleLogAnalysis} isAnalyzing={isTyping}
              />
            )}
            {activeTab === 'connectivity' && (
              <ConnectivityCheck
                hasTopology={!!topologyYaml.trim()} onCheck={handleConnectivityCheck} isChecking={isTyping}
              />
            )}
          </div>
          {/* Problem 4: fixDetails passed to MetricsPanel */}
          <MetricsPanel nodes={parsedNodes} links={parsedLinks} fixCount={fixCount} fixDetails={fixDetails} />
        </section>

        <footer className="h-10 bg-clab-surface border-t border-clab-border flex items-center px-4 justify-between shrink-0">
          <div className="flex space-x-3">
            <button onClick={handleRescan} disabled={isTyping}
              className="text-[10px] px-3 py-1 bg-clab-border hover:bg-gray-700/50 rounded uppercase font-bold tracking-tight transition-all disabled:opacity-50">
              Re-Scan
            </button>
            {/* Problem 4: Global Fix with SCANNING state */}
            <button onClick={handleGlobalFix} disabled={isTyping || isScanning}
              className="text-[10px] px-3 py-1 bg-clab-accent/10 text-clab-accent border border-clab-accent/50 hover:bg-clab-accent hover:text-black rounded uppercase font-bold tracking-tight transition-all disabled:opacity-50 flex items-center gap-2">
              {isScanning ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-clab-accent border-t-transparent rounded-full animate-spin" />
                  SCANNING...
                </>
              ) : (
                'Global Fix'
              )}
            </button>
          </div>
          <div className="text-[9px] text-clab-muted tracking-widest uppercase">
            {labName ? `LAB: ${labName}` : 'NO LAB'} | CLABFIX
          </div>
        </footer>
      </main>

      {/* Problem 5: DirectoryPicker gets yamlFileDir */}
      <DirectoryPicker
        isOpen={isDirPickerOpen}
        onClose={() => setIsDirPickerOpen(false)}
        initialPath={labDir || '/'}
        yamlFilePath={yamlFileDir}
        onSelect={async (newDir) => {
          try {
            const updated = await setLabDir(newDir);
            setLabDirState(updated);
            // Auto-load topology from new CWD
            const { found, yaml: content, filename } = await loadTopologyFromDisk();
            if (found && content) {
              setTopologyYaml(content);
              addMsg('model', `✅ Auto-loaded topology: **${filename}**`);
            }
          } catch {
            addMsg('model', "⚠️ Failed to change directory.");
          }
        }}
      />
    </div>
  );
}
