import { cn } from '../lib/utils';
import type { NodeInfo, LinkInfo } from '../types';

type MetricsPanelProps = {
  nodes: NodeInfo[];
  links: LinkInfo[];
  fixCount: number;
};

export default function MetricsPanel({ nodes, links, fixCount }: MetricsPanelProps) {
  const connectionCount = new Map<string, number>();
  links.forEach(l => {
    connectionCount.set(l.sourceNode, (connectionCount.get(l.sourceNode) || 0) + 1);
    connectionCount.set(l.targetNode, (connectionCount.get(l.targetNode) || 0) + 1);
  });

  return (
    <aside className="col-span-3 h-full overflow-y-auto p-3 space-y-3 bg-clab-bg flex flex-col scrollbar-thin">

      {/* Summary */}
      <div className="border border-clab-border bg-clab-panel p-3 rounded shadow-sm shrink-0">
        <div className="text-[9px] uppercase font-bold text-clab-muted mb-2 tracking-widest">Lab Summary</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold text-clab-accent">{nodes.length}</div>
            <div className="text-[9px] text-clab-muted uppercase">Nodes</div>
          </div>
          <div>
            <div className="text-lg font-bold text-clab-accent">{links.length}</div>
            <div className="text-[9px] text-clab-muted uppercase">Links</div>
          </div>
          <div>
            <div className="text-lg font-bold text-clab-warning">{fixCount}</div>
            <div className="text-[9px] text-clab-muted uppercase">Fixes</div>
          </div>
        </div>
      </div>

      {/* Connection Density */}
      {nodes.length > 0 && (
        <div className="border border-clab-border bg-clab-panel p-3 rounded shrink-0">
          <div className="text-[9px] uppercase font-bold text-clab-muted mb-2 tracking-widest">Connection Density</div>
          <div className="space-y-1.5">
            {nodes.slice(0, 6).map(node => {
              const count = connectionCount.get(node.name) || 0;
              const maxConn = Math.max(...Array.from(connectionCount.values()), 1);
              const pct = Math.round((count / maxConn) * 100);
              return (
                <div key={node.name}>
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-clab-muted truncate mr-2">{node.name}</span>
                    <span className={cn("shrink-0", count > 0 ? "text-clab-accent" : "text-clab-muted")}>
                      {count}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-clab-border rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", count > 0 ? "bg-clab-accent shadow-[0_0_4px_#00FF9C]" : "bg-clab-border")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {nodes.length > 6 && (
              <div className="text-[9px] text-clab-muted italic">+{nodes.length - 6} more</div>
            )}
          </div>
        </div>
      )}

      {/* Topology Map — scrollable, fills remaining space */}
      <div className="flex-1 min-h-0 border border-clab-border bg-black/60 rounded p-3 flex flex-col overflow-hidden">
        <div className="text-[9px] font-bold text-clab-muted uppercase tracking-tighter mb-2 shrink-0">
          Topology Map ({links.length})
        </div>
        {links.length > 0 ? (
          <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin min-h-0">
            {links.map((link, i) => (
              <div key={i} className="flex items-center text-[9px] gap-1 min-w-0">
                <span className="px-1 py-0.5 bg-clab-accent/10 border border-clab-accent/30 text-clab-accent font-bold rounded truncate shrink-0 max-w-[55px]" title={link.sourceNode}>
                  {link.sourceNode}
                </span>
                <span className="text-clab-muted truncate shrink-0">{link.sourceInterface}</span>
                <span className="text-clab-accent shrink-0">↔</span>
                <span className="text-clab-muted truncate shrink-0">{link.targetInterface}</span>
                <span className="px-1 py-0.5 bg-clab-accent/10 border border-clab-accent/30 text-clab-accent font-bold rounded truncate shrink-0 max-w-[55px]" title={link.targetNode}>
                  {link.targetNode}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] text-clab-muted italic">
            Load a topology to see connections
          </div>
        )}
      </div>
    </aside>
  );
}
