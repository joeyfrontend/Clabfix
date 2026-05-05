import { useRef } from 'react';
import { Upload } from 'lucide-react';

type LogAnalyzerProps = {
  logInput: string;
  setLogInput: (v: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
};

export default function LogAnalyzer({ logInput, setLogInput, onAnalyze, isAnalyzing }: LogAnalyzerProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogInput(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-black/40">
      <div className="bg-clab-surface px-4 py-1.5 text-[10px] border-b border-clab-border flex items-center justify-between uppercase font-bold text-clab-muted">
        <span>DIAGNOSTICS</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 text-clab-accent hover:underline"
          >
            <Upload size={12} /> UPLOAD
          </button>
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing || !logInput.trim()}
            className="text-clab-warning hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {isAnalyzing ? 'SCANNING...' : 'SCAN FOR ERRORS'}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".log,.txt,.json,.out"
        onChange={handleFile}
        className="hidden"
      />
      <textarea
        value={logInput}
        onChange={(e) => setLogInput(e.target.value)}
        placeholder="Paste or upload log output (dmesg, docker logs, clab deploy output)..."
        className="flex-1 bg-transparent p-4 text-xs font-mono resize-none outline-none text-clab-text scrollbar-thin"
      />
    </div>
  );
}
