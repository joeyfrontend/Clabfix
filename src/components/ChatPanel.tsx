import { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MessageBubble from './MessageBubble';
import type { Message } from '../types';

type ChatPanelProps = {
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  isTyping: boolean;
  onApplyYaml: (msg: Message) => void;
  onRunCommand: (msg: Message) => void;
  onDismiss: (id: string) => void;
};

export default function ChatPanel({ messages, input, setInput, onSend, isTyping, onApplyYaml, onRunCommand, onDismiss }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="bg-clab-surface px-4 py-1.5 text-[10px] border-b border-clab-border flex justify-between uppercase font-bold tracking-widest text-clab-muted shrink-0">
        <span>AGENT_OUTPUT.log</span>
        <span>{messages.length} messages</span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-w-0 p-4 space-y-4 scrollbar-thin bg-black/40"
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
        {isTyping && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-[9px] text-clab-muted">[{new Date().toLocaleTimeString('en-US', { hour12: false })}]</span>
            <span className="text-clab-warning text-[10px] font-bold">ANALYZING</span>
            <span className="flex gap-0.5">
              <span className="w-1 h-1 bg-clab-warning rounded-full animate-bounce" style={{ animationDuration: '0.4s' }} />
              <span className="w-1 h-1 bg-clab-warning rounded-full animate-bounce" style={{ animationDuration: '0.4s', animationDelay: '0.1s' }} />
              <span className="w-1 h-1 bg-clab-warning rounded-full animate-bounce" style={{ animationDuration: '0.4s', animationDelay: '0.2s' }} />
            </span>
          </div>
        )}
      </div>
      <div className="h-12 bg-clab-panel border-t border-clab-border flex items-center px-4 shrink-0">
        <span className="text-clab-accent font-bold mr-3">{'>'}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend()}
          placeholder="Enter command or discuss network state..."
          className="flex-1 bg-transparent border-none outline-none text-xs text-clab-accent placeholder:text-clab-muted/50"
        />
        <button
          onClick={onSend}
          disabled={isTyping}
          className="ml-2 text-clab-muted hover:text-clab-accent transition-colors disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
