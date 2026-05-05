import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
import { classifyFix } from '../lib/api';
import type { Message } from '../types';

type MessageBubbleProps = {
  message: Message;
  onApplyYaml: (msg: Message) => void;
  onRunCommand: (msg: Message) => void;
  onDismiss: (id: string) => void;
};

export default function MessageBubble({ message, onApplyYaml, onRunCommand, onDismiss }: MessageBubbleProps) {
  const timeStr = message.timestamp.toLocaleTimeString('en-US', { hour12: false });
  const fixType = message.type === 'fix' && !message.dismissed ? classifyFix(message.content) : 'none';

  return (
    <div className="flex flex-col group min-w-0">
      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-[9px] text-clab-muted">[{timeStr}]</span>
        <span className={cn(
          "text-[10px] font-bold uppercase",
          message.role === 'model' ? "text-clab-accent" : "text-blue-400"
        )}>
          {message.role === 'model' ? "CLABFIX-AI" : "OPERATOR"}
        </span>
      </div>
      <div className={cn(
        "px-4 py-2 text-[11px] leading-relaxed border-l-2 overflow-hidden break-words",
        message.role === 'model' ? "border-clab-accent bg-clab-accent/5" : "border-blue-400 bg-blue-400/5",
        message.type === 'fix' ? "border-clab-warning bg-clab-warning/5" : ""
      )}>
        {message.role === 'model' ? (
          <div className="prose prose-invert prose-sm max-w-none min-w-0 break-words
            [&_code]:text-clab-accent [&_code]:bg-clab-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[10px] [&_code]:break-all
            [&_pre]:bg-clab-surface [&_pre]:border [&_pre]:border-clab-border [&_pre]:rounded [&_pre]:text-[10px] [&_pre]:overflow-x-auto [&_pre]:max-w-full
            [&_h1]:text-clab-text [&_h1]:text-sm [&_h1]:font-bold
            [&_h2]:text-clab-text [&_h2]:text-xs [&_h2]:font-bold
            [&_h3]:text-clab-text [&_h3]:text-xs [&_h3]:font-bold
            [&_p]:text-[11px] [&_p]:text-clab-text [&_p]:leading-relaxed
            [&_li]:text-[11px] [&_li]:text-clab-text
            [&_strong]:text-clab-accent
            [&_a]:text-clab-accent
            [&_table]:text-[10px] [&_th]:text-clab-accent [&_td]:border-clab-border [&_th]:border-clab-border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          message.content
        )}
        {fixType !== 'none' && (
          <div className="mt-2 pt-2 border-t border-clab-warning/20 flex gap-2 flex-wrap">
            {(fixType === 'yaml' || fixType === 'mixed') && (
              <button
                onClick={() => onApplyYaml(message)}
                className="text-[9px] px-2 py-0.5 bg-clab-accent text-black font-bold uppercase hover:bg-white transition-all"
              >
                Apply to YAML
              </button>
            )}
            {(fixType === 'command' || fixType === 'mixed') && (
              <button
                onClick={() => onRunCommand(message)}
                className="text-[9px] px-2 py-0.5 bg-clab-warning text-black font-bold uppercase hover:bg-white transition-all"
              >
                Run Commands
              </button>
            )}
            <button
              onClick={() => onDismiss(message.id)}
              className="text-[9px] px-2 py-0.5 border border-clab-border text-clab-muted font-bold uppercase hover:bg-clab-surface transition-all"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
