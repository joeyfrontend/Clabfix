/**
 * ── src/components/ChatPanel.tsx ─────────────────────────
 * CHANGES (Problems 3 & 4):
 *  1. Problem 3: Chat input is now an uncontrolled component with its own
 *     useRef — its state is fully independent from the message list. Streaming
 *     updates to messages do NOT cause the input to re-render.
 *  2. Problem 3: Send button and Enter key are always enabled, even during
 *     streaming. Users can type and send at any time.
 *  3. Problem 4: Renamed "AGENT_OUTPUT.LOG" → "DIAGNOSTIC CHAT".
 *  4. Problem 4: Merged terminal input into the main input. Messages starting
 *     with $ or / are piped to /api/exec as terminal commands.
 *  5. Problem 4: "CLABFIX-AI is thinking..." animated indicator with blinking
 *     cursor, consistent with monospace green aesthetic.
 *  6. LiveTerminal now only shows SSE output (no separate input — merged below).
 */

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Send, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MessageBubble from './MessageBubble';
import type { Message } from '../types';
import { cn } from '../lib/utils';

type ChatPanelProps = {
  messages: Message[];
  onSend: (text: string) => void;
  onExecCommand: (command: string) => void;
  isTyping: boolean;
  onApplyYaml: (msg: Message) => void;
  onRunCommand: (msg: Message) => void;
  onDismiss: (id: string) => void;
};

/**
 * LiveTerminal: SSE log viewer only (no input — merged into main input).
 * Memoized to avoid re-renders from parent state changes.
 */
const LiveTerminal = memo(function LiveTerminal() {
  const [logs, setLogs] = useState<{ id: number; type: string; text: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logId = useRef(0);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setLogs((prev) => {
          const next = [...prev, { id: logId.current++, ...data }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      } catch {}
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="bg-black/80 border-t border-b border-clab-border font-mono text-[10px] p-2 mt-4 flex flex-col shrink-0 shadow-inner h-48">
      <div className="text-clab-muted uppercase tracking-widest text-[9px] mb-2 font-bold border-b border-clab-border/50 pb-1 flex justify-between shrink-0">
        <span className="flex items-center gap-1.5">
          <Terminal size={10} />
          Live Terminal
        </span>
        <span className="cursor-pointer hover:text-white" onClick={() => setLogs([])}>
          Clear
        </span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin" ref={scrollRef}>
        {logs.map((l) => (
          <span
            key={l.id}
            className={cn(
              'whitespace-pre-wrap break-all inline-block w-full',
              l.type === 'exec' ? 'text-clab-accent font-bold mt-2' : '',
              l.type === 'stderr' || l.type === 'error' ? 'text-clab-warning' : '',
              l.type === 'done' ? 'text-clab-muted italic mt-1 mb-2' : 'text-gray-300',
              l.type === 'agent_thinking' ? 'text-clab-muted/60 italic' : ''
            )}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
});

/**
 * Thinking indicator — blinking cursor style, monospace green aesthetic.
 */
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1 pb-4">
      <span className="text-[9px] text-clab-muted">
        [{new Date().toLocaleTimeString('en-US', { hour12: false })}]
      </span>
      <span className="text-clab-accent text-[10px] font-bold flex items-center gap-1.5">
        CLABFIX-AI is thinking
        <span className="inline-flex items-center gap-[2px]">
          <span
            className="inline-block w-[6px] h-[12px] bg-clab-accent animate-pulse"
            style={{ animationDuration: '0.8s' }}
          />
        </span>
      </span>
    </div>
  );
}

export default function ChatPanel({
  messages,
  onSend,
  onExecCommand,
  isTyping,
  onApplyYaml,
  onRunCommand,
  onDismiss,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Problem 3: Uncontrolled input — its state is fully independent from
  // the message list so streaming updates don't cause input re-renders.
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Problem 4: Unified input handler. $ or / prefix → exec, otherwise → AI chat.
  const handleSubmit = useCallback(() => {
    const value = inputRef.current?.value?.trim();
    if (!value) return;
    if (inputRef.current) inputRef.current.value = '';

    if (value.startsWith('$') || value.startsWith('/')) {
      // Strip the $ prefix if present, keep / commands as-is
      const cmd = value.startsWith('$') ? value.slice(1).trim() : value;
      if (cmd) onExecCommand(cmd);
    } else {
      onSend(value);
    }
  }, [onSend, onExecCommand]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {/* Problem 4: Renamed from AGENT_OUTPUT.LOG → DIAGNOSTIC CHAT */}
      <div className="bg-clab-surface px-4 py-1.5 text-[10px] border-b border-clab-border flex justify-between uppercase font-bold tracking-widest text-clab-muted shrink-0">
        <span>Diagnostic Chat</span>
        <span>{messages.length} messages</span>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-black/40">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-w-0 p-4 space-y-4 scrollbar-thin"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <MessageBubble
                  message={msg}
                  onApplyYaml={onApplyYaml}
                  onRunCommand={onRunCommand}
                  onDismiss={onDismiss}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Problem 4: Animated thinking indicator */}
          {isTyping && <ThinkingIndicator />}
        </div>

        <LiveTerminal />
      </div>

      {/* Problem 3 & 4: Unified input bar — uncontrolled, always enabled */}
      <div className="h-12 bg-clab-panel border-t border-clab-border flex items-center px-4 shrink-0">
        <span className="text-clab-accent font-bold mr-3">{'>'}</span>
        <input
          ref={inputRef}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Message AI or type $ command to exec directly..."
          className="flex-1 bg-transparent border-none outline-none text-xs text-clab-accent placeholder:text-clab-muted/50"
        />
        <button
          onClick={handleSubmit}
          className="ml-2 text-clab-muted hover:text-clab-accent transition-colors"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
