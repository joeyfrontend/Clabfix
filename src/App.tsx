import { useState, useMemo, useCallback, useEffect } from 'react';
import { cn } from './lib/utils';
import { chatWithAI, analyzeTopology, troubleshootLogs } from './lib/ai';
import { execCommand, extractCodeBlocks, getLabDir, setLabDir } from './lib/api';
import yaml from 'js-yaml';
import type { Message, TabType, NodeInfo, LinkInfo } from './types';
import { createMessage } from './types';

import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import TopologyEditor from './components/TopologyEditor';
import LogAnalyzer from './components/LogAnalyzer';
import ConnectivityCheck from './components/ConnectivityCheck';
import MetricsPanel from './components/MetricsPanel';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    createMessage('model', "Welcome to Clabfix. Paste or upload your topology YAML, then run analysis.", 'chat')
  ]);
  const [input, setInput] = useState('');
  const [logInput, setLogInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [topologyYaml, setTopologyYaml] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [labDir, setLabDirState] = useState('');
  const [selectedModel, setSelectedModel] = useState('google/gemini-2.0-flash-001');

  // Fetch lab directory on mount
  useEffect(() => {
    getLabDir().then(setLabDirState).catch(() => {});
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

  // ── Handlers ──────────────────────────────────────────

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;
    const userMsg = createMessage('user', text, 'chat');
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsTyping(true);
    try {
      const history = newMessages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
      const response = await chatWithAI(history, topologyYaml, selectedModel);
      setMessages([...newMessages, createMessage('model', response || "No response.", 'chat')]);
    } catch (err: any) {
      console.error('Chat error:', err);
      const detail = err?.message || String(err);
      setMessages([...newMessages, createMessage('model', `⚠️ **API Error:** ${detail}`, 'chat')]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleTopologyAnalyze = async () => {
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
      setActiveTab('chat');
    } catch (err: any) { console.error('Analysis error:', err); addMsg('model', `⚠️ Analysis failed: ${err?.message || err}`); }
    finally { setIsTyping(false); }
  };

  const handleLogAnalysis = async () => {
    if (!logInput.trim()) return;
    setIsTyping(true);
    try {
      const result = await troubleshootLogs(logInput, topologyYaml, selectedModel);
      addMsg('user', "Log Analysis", 'diagnostic');
      addMsg('model', result || "No issues.", 'fix');
      setActiveTab('chat');
    } catch (err: any) { console.error('Log error:', err); addMsg('model', `⚠️ Log analysis failed: ${err?.message || err}`); }
    finally { setIsTyping(false); }
  };

  const handleConnectivityCheck = async () => {
    if (!topologyYaml.trim()) { addMsg('model', "⚠️ Load a topology first."); return; }
    setIsTyping(true);
    try {
      const response = await troubleshootLogs("Connectivity check: which node pairs can/cannot reach each other and why.", topologyYaml);
      addMsg('user', "Connectivity Check", 'diagnostic');
      addMsg('model', response || "Check complete.", 'fix');
      setActiveTab('chat');
    } catch (err: any) { console.error('Connectivity error:', err); addMsg('model', `⚠️ Connectivity check failed: ${err?.message || err}`); }
    finally { setIsTyping(false); }
  };

  // ── Apply Fix: YAML ──────────────────────────────────

  const handleApplyYaml = (msg: Message) => {
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
  };

  // ── Apply Fix: Run Commands ──────────────────────────

  const handleRunCommand = async (msg: Message) => {
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
      } catch {
        addMsg('model', `⚠️ Failed to execute script.`, 'diagnostic');
      }
    }
  };

  const handleDismiss = (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, dismissed: true } : m));
  };

  const handleRescan = () => {
    if (topologyYaml.trim()) handleTopologyAnalyze();
    else addMsg('model', "⚠️ No topology loaded.");
  };

  const handleGlobalFix = async () => {
    if (!topologyYaml.trim()) { addMsg('model', "⚠️ No topology loaded."); return; }
    setIsTyping(true);
    try {
      const prompt = `Generate a single remediation script for ALL issues found. Include both YAML fixes and shell commands.`;
      const response = await chatWithAI([
        ...messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
        { role: 'user' as const, parts: [{ text: prompt }] }
      ], topologyYaml, selectedModel);
      addMsg('user', "Global Fix", 'diagnostic');
      addMsg('model', response || "Done.", 'fix');
    } catch (err: any) { console.error('Global fix error:', err); addMsg('model', `⚠️ Global fix failed: ${err?.message || err}`); }
    finally { setIsTyping(false); }
  };

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
                onClick={async () => {
                  const newDir = prompt("Enter the absolute path to your Containerlab working directory:", labDir);
                  if (newDir && newDir !== labDir) {
                    try {
                      // We need to import setLabDir, so I'll assume it's imported at the top
                      const updated = await import('./lib/api').then(m => m.setLabDir(newDir));
                      setLabDirState(updated);
                    } catch (e) {
                      alert("Failed to change directory. Does it exist?");
                    }
                  }
                }}
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
                messages={messages} input={input} setInput={setInput}
                onSend={() => handleSend()} isTyping={isTyping}
                onApplyYaml={handleApplyYaml} onRunCommand={handleRunCommand} onDismiss={handleDismiss}
              />
            )}
            {activeTab === 'topology' && (
              <TopologyEditor
                topologyYaml={topologyYaml} setTopologyYaml={setTopologyYaml}
                onAnalyze={handleTopologyAnalyze} isAnalyzing={isTyping}
                onFileLoaded={(fileName) => {
                  addMsg('model', `✅ Loaded topology file: **${fileName}**`);
                  // Prompt user to confirm the lab directory
                  const dir = prompt(
                    'Set the working directory for this lab (absolute path to the folder containing your .clab.yml):',
                    labDir || '/home'
                  );
                  if (dir && dir.trim()) {
                    setLabDir(dir.trim()).then((updated) => {
                      setLabDirState(updated);
                      addMsg('model', `📂 Working directory set to: **${updated}**`);
                    }).catch(() => {
                      addMsg('model', '⚠️ Failed to update working directory.');
                    });
                  }
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
          <MetricsPanel nodes={parsedNodes} links={parsedLinks} fixCount={fixCount} />
        </section>

        <footer className="h-10 bg-clab-surface border-t border-clab-border flex items-center px-4 justify-between shrink-0">
          <div className="flex space-x-3">
            <button onClick={handleRescan} disabled={isTyping}
              className="text-[10px] px-3 py-1 bg-clab-border hover:bg-gray-700/50 rounded uppercase font-bold tracking-tight transition-all disabled:opacity-50">
              Re-Scan
            </button>
            <button onClick={handleGlobalFix} disabled={isTyping}
              className="text-[10px] px-3 py-1 bg-clab-accent/10 text-clab-accent border border-clab-accent/50 hover:bg-clab-accent hover:text-black rounded uppercase font-bold tracking-tight transition-all disabled:opacity-50">
              Global Fix
            </button>
          </div>
          <div className="text-[9px] text-clab-muted tracking-widest uppercase">
            {labName ? `LAB: ${labName}` : 'NO LAB'} | CLABFIX
          </div>
        </footer>
      </main>
    </div>
  );
}
