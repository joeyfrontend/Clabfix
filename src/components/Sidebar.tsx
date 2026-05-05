import { Activity, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { TabType, NodeInfo, LinkInfo } from '../types';

type SidebarProps = {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  nodes: NodeInfo[];
  links: LinkInfo[];
  hasTopology: boolean;
  labName: string;
};

const NAV_ITEMS: { tab: TabType; icon: typeof Activity; label: string }[] = [
  { tab: 'chat', icon: Activity, label: 'Diagnostic Chat' },
  { tab: 'topology', icon: Upload, label: 'YAML Definition' },
  { tab: 'logs', icon: AlertCircle, label: 'Stream Logs' },
  { tab: 'connectivity', icon: CheckCircle2, label: 'Connectivity' },
];

export default function Sidebar({ activeTab, setActiveTab, nodes, links, hasTopology, labName }: SidebarProps) {
  return (
    <aside className="w-64 border-r border-clab-border flex flex-col shrink-0">
      <div className="p-4 border-b border-clab-border bg-clab-surface">
        <h1 className="text-clab-accent text-xs font-bold tracking-widest uppercase">CLABFIX v1.0.0</h1>
        <div className="text-[10px] text-clab-muted mt-1 italic tracking-tighter overflow-hidden text-ellipsis whitespace-nowrap">
          {hasTopology ? `lab: ${labName || 'unnamed'}` : "no topology loaded"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        <div className="text-[10px] uppercase text-clab-muted px-2 mb-2 tracking-tighter font-bold">
          Nodes ({nodes.length})
        </div>
        <ul className="space-y-1 mb-4">
          {nodes.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-clab-muted italic">No nodes detected</li>
          )}
          {nodes.map((node) => (
            <li key={node.name} className={cn(
              "flex items-center justify-between px-3 py-1.5 transition-colors text-xs",
              node.status === 'error'
                ? "bg-clab-surface border-l-2 border-clab-error"
                : "hover:bg-clab-surface border-l-2 border-transparent"
            )}>
              <div className="flex flex-col min-w-0">
                <span className="truncate">{node.name}</span>
                {node.kind && (
                  <span className="text-[9px] text-clab-muted truncate">{node.kind}</span>
                )}
              </div>
              <span className={cn(
                "text-[9px] px-1 rounded font-bold uppercase shrink-0 ml-2",
                node.status === 'error'
                  ? "bg-red-900/30 text-clab-error"
                  : "bg-emerald-900/30 text-clab-accent"
              )}>
                {node.status === 'error' ? 'ERR' : 'OK'}
              </span>
            </li>
          ))}
        </ul>

        <div className="text-[10px] uppercase text-clab-muted px-2 mb-2 tracking-tighter font-bold">
          Links ({links.length})
        </div>
        <ul className="space-y-1 mb-4 px-2">
          {links.length === 0 && (
            <li className="text-xs text-clab-muted italic">No links defined</li>
          )}
          {links.slice(0, 12).map((link, i) => (
            <li key={i} className="text-[9px] text-clab-muted flex items-center gap-1 py-0.5">
              <span className="text-clab-accent">{link.sourceNode}</span>
              <span className="text-clab-border">:</span>
              <span>{link.sourceInterface}</span>
              <span className="text-clab-accent mx-0.5">↔</span>
              <span className="text-clab-accent">{link.targetNode}</span>
              <span className="text-clab-border">:</span>
              <span>{link.targetInterface}</span>
            </li>
          ))}
          {links.length > 12 && (
            <li className="text-[9px] text-clab-muted italic">+{links.length - 12} more</li>
          )}
        </ul>

        <nav className="flex flex-col gap-1 px-2 border-t border-clab-border/30 pt-4">
          {NAV_ITEMS.map(({ tab, icon: Icon, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded text-[11px] transition-all uppercase tracking-tighter font-bold",
                activeTab === tab
                  ? "bg-clab-accent/10 text-clab-accent border border-clab-accent/20"
                  : "text-clab-muted hover:text-clab-text"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-3 bg-black text-[9px] text-clab-muted border-t border-clab-border">
        {nodes.length} nodes | {links.length} links
      </div>
    </aside>
  );
}
