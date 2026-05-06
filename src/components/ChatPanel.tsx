/**
 * ── src/components/ChatPanel.tsx ─────────────────────────
 * CHANGES (Live Terminal):
 *  1. Fixed SSE parsing — now correctly gets {type, text} objects since
 *     server no longer double-encodes.
 *  2. LiveTerminal has its OWN command input (separate from AI chat input).
 *     User types command → runs via /api/exec → output streams into terminal.
 *  3. Tracks running/idle state from SSE events (exec → running, done → idle).
 *  4. Blinking green cursor when running, dim blinking ▋ when idle.
 *  5. Command prompt lines shown as `$ command` in dimmer green.
 *  6. Exit code shown in red if non-zero.
 *  7. Smart auto-scroll: auto-scrolls on new output unless user scrolled up.
 *     Resumes auto-scroll when user scrolls back to bottom.
 *  8. Clear button resets to idle state with placeholder text.
 *  9. Increased buffer to 500 entries for longer sessions.
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

type TermEntry = {
  id: number;
  type: string;
  text: string;
};

/**
 * LiveTerminal — real-time SSE output viewer with its own command input.
 * Memoized to avoid re-renders from parent chat state changes.
 */
const LiveTerminal = memo(function LiveTerminal() {
  const [entries, setEntries] = useState<TermEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const entryId = useRef(0);
  const userScrolledUp = useRef(false);

  // ── SSE connection ────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data || typeof data !== 'object') return;

        // Track running state
        if (data.type === 'exec') setIsRunning(true);
        if (data.type === 'done' || data.type === 'error') setIsRunning(false);
        if (data.type === 'confirm_required') setPendingConfirm(data.text || '');

        setEntries((prev) => {
          const next = [...prev, { id: entryId.current++, type: data.type || 'stdout', text: data.text || '' }];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch { /* malformed SSE data — ignore */ }
    };
    es.onerror = () => setIsRunning(false);
    return () => es.close();
  }, []);

  // ── Smart auto-scroll ─────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    userScrolledUp.current = !atBottom;
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  // ── Manual command execution ──────────────────────────
  const handleExec = useCallback(() => {
    const cmd = inputRef.current?.value?.trim();
    if (!cmd) return;
    inputRef.current!.value = '';
    fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    }).catch(() => {});
  }, []);

  // ── Confirm/deny destructive commands ──────────────────
  const handleConfirm = useCallback((approved: boolean) => {
    setPendingConfirm(null);
    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    }).catch(() => {});
  }, []);

  // ── Clear ─────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setEntries([{ id: entryId.current++, type: 'info', text: '— Terminal cleared —' }]);
    setIsRunning(false);
    setPendingConfirm(null);
    userScrolledUp.current = false;
  }, []);

  // ── Parse exit code from done text ────────────────────
  const parseExitCode = (text: string): number | null => {
    const m = text.match(/\[exit (\d+)\]/);
    return m ? parseInt(m[1], 10) : null;
  };

  return (
    <div className="bg-black/90 border-t border-clab-border font-mono text-[11px] flex flex-col shrink-0 shadow-inner h-56">
      {/* Header */}
      <div className="text-clab-muted uppercase tracking-widest text-[9px] px-3 py-1.5 font-bold border-b border-clab-border/50 flex justify-between items-center shrink-0 bg-black/40">
        <span className="flex items-center gap-1.5">
          <Terminal size={10} />
          Live Terminal
          {isRunning && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-clab-accent animate-pulse"
              style={{ animationDuration: '0.6s' }}
            />
          )}
        </span>
        <button
          onClick={handleClear}
          className="cursor-pointer hover:text-white transition-colors text-[9px] uppercase"
        >
          Clear
        </button>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin select-text"
      >
        {entries.length === 0 && !isRunning && (
          <div className="text-clab-muted/30 italic text-[10px] flex items-center gap-1">
            Terminal ready. AI commands and manual commands appear here.
            <span className="animate-pulse text-clab-accent/30" style={{ animationDuration: '1.5s' }}>▋</span>
          </div>
        )}

        {entries.map((entry) => {
          // Done entries: parse exit code for coloring
          if (entry.type === 'done') {
            const code = parseExitCode(entry.text);
            const isError = code !== null && code !== 0;
            return (
              <div key={entry.id} className={cn(
                "text-[9px] italic mt-0.5 mb-1.5",
                isError ? "text-clab-error" : "text-clab-muted/50"
              )}>
                {entry.text}
              </div>
            );
          }

          // Exec entries: command prompt line
          if (entry.type === 'exec') {
            return (
              <div key={entry.id} className="text-clab-accent/70 font-bold mt-2.5 mb-0.5">
                {entry.text}
              </div>
            );
          }

          // Stderr / error
          if (entry.type === 'stderr' || entry.type === 'error') {
            return (
              <span key={entry.id} className="text-clab-warning whitespace-pre-wrap break-all inline-block w-full">
                {entry.text}
              </span>
            );
          }

          // Agent thinking
          if (entry.type === 'agent_thinking') {
            return (
              <span key={entry.id} className="text-clab-muted/40 italic whitespace-pre-wrap inline-block w-full text-[10px]">
                {entry.text}
              </span>
            );
          }

          // Info (e.g. terminal cleared)
          if (entry.type === 'info') {
            return (
              <div key={entry.id} className="text-clab-muted/40 italic text-[9px] text-center my-1">
                {entry.text}
              </div>
            );
          }

          // Confirm required
          if (entry.type === 'confirm_required') {
            return (
              <div key={entry.id} className="my-2 p-2 border border-clab-warning/40 bg-clab-warning/5 rounded">
                <div className="text-clab-warning text-[10px] font-bold uppercase mb-1">⚠ Confirm Destructive Command</div>
                <div className="text-gray-300 text-[10px] font-mono mb-2">$ {entry.text}</div>
                {pendingConfirm === entry.text && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConfirm(true)}
                      className="text-[9px] px-3 py-0.5 bg-clab-accent text-black font-bold uppercase hover:bg-[#3ceb9f] transition-colors"
                    >Approve</button>
                    <button
                      onClick={() => handleConfirm(false)}
                      className="text-[9px] px-3 py-0.5 bg-clab-error/80 text-white font-bold uppercase hover:bg-clab-error transition-colors"
                    >Deny</button>
                  </div>
                )}
              </div>
            );
          }

          // Stdout (default)
          return (
            <span key={entry.id} className="text-gray-300 whitespace-pre-wrap break-all inline-block w-full">
              {entry.text}
            </span>
          );
        })}

        {/* Blinking cursor — fast when running, slow when idle */}
        {entries.length > 0 && (
          isRunning ? (
            <span
              className="inline-block text-clab-accent font-bold animate-pulse"
              style={{ animationDuration: '0.4s' }}
            >▋</span>
          ) : (
            <span
              className="inline-block text-clab-accent/30 animate-pulse"
              style={{ animationDuration: '1.5s' }}
            >▋</span>
          )
        )}
      </div>

      {/* Manual command input — separate from AI chat input */}
      <div className="flex items-center border-t border-clab-border/50 px-3 py-1 shrink-0 bg-black/60">
        <span className="text-clab-accent/50 font-bold mr-2 text-[10px]">$</span>
        <input
          ref={inputRef}
          type="text"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleExec();
          }}
          placeholder="Run a command directly..."
          className="flex-1 bg-transparent border-none outline-none text-[10px] text-clab-accent placeholder:text-clab-muted/30"
        />
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // AI chat input handler — $ prefix still goes to exec for convenience
  const handleSubmit = useCallback(() => {
    const value = inputRef.current?.value?.trim();
    if (!value) return;
    if (inputRef.current) inputRef.current.value = '';

    if (value.startsWith('$')) {
      const cmd = value.slice(1).trim();
      if (cmd) onExecCommand(cmd);
    } else {
      onSend(value);
    }
  }, [onSend, onExecCommand]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
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

          {isTyping && <ThinkingIndicator />}
        </div>

        <LiveTerminal />
      </div>

      {/* AI chat input bar */}
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
