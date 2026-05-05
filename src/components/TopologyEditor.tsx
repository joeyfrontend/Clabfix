import { useRef } from 'react';
import { Upload } from 'lucide-react';

type TopologyEditorProps = {
  topologyYaml: string;
  setTopologyYaml: (v: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  onFileLoaded?: (fileName: string) => void;
};

export default function TopologyEditor({ topologyYaml, setTopologyYaml, onAnalyze, isAnalyzing, onFileLoaded }: TopologyEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setTopologyYaml(ev.target?.result as string);
      onFileLoaded?.(file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-black/40">
      <div className="bg-clab-surface px-4 py-1.5 text-[10px] border-b border-clab-border flex items-center justify-between uppercase font-bold text-clab-muted">
        <span>TOPOLOGY_CONFIG.yml</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 text-clab-accent hover:underline"
          >
            <Upload size={12} /> UPLOAD
          </button>
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing || !topologyYaml.trim()}
            className="text-clab-accent hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {isAnalyzing ? 'ANALYZING...' : 'RUN ANALYSIS'}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml,.clab.yml"
        onChange={handleFile}
        className="hidden"
      />
      <textarea
        value={topologyYaml}
        onChange={(e) => setTopologyYaml(e.target.value)}
        placeholder={"name: lab1\ntopology:\n  kinds: ...\n  nodes: ...\n  links: ..."}
        className="flex-1 bg-transparent p-4 text-xs font-mono resize-none outline-none text-clab-text scrollbar-thin"
      />
    </div>
  );
}
