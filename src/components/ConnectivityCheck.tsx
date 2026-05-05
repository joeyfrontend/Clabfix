import { Activity, AlertCircle } from 'lucide-react';

type ConnectivityCheckProps = {
  hasTopology: boolean;
  onCheck: () => void;
  isChecking: boolean;
};

export default function ConnectivityCheck({ hasTopology, onCheck, isChecking }: ConnectivityCheckProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-black/40 relative">
      <div className="bg-clab-surface px-4 py-1.5 text-[10px] border-b border-clab-border flex justify-between uppercase font-bold text-clab-muted">
        <span>CONNECTIVITY_MATRIX.mrt</span>
        <button
          onClick={onCheck}
          disabled={isChecking || !hasTopology}
          className="text-clab-accent hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {isChecking ? 'RUNNING...' : 'RUN PING SWEEP'}
        </button>
      </div>
      <div className="p-8 flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-16 h-16 border-2 border-clab-accent/20 rounded-full flex items-center justify-center animate-[pulse_3s_infinite]">
          <Activity className="text-clab-accent" size={32} />
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-clab-text">Reachability Module</h3>
          <p className="text-[11px] text-clab-muted max-w-sm mt-2">
            This module generates a full-mesh ping test between all nodes defined in your topology.
            It also checks default gateway (mgmt) reachability for each node.
          </p>
        </div>
        {!hasTopology && (
          <div className="mt-4 p-4 border border-clab-error/20 bg-clab-error/5 rounded flex items-center gap-3">
            <AlertCircle className="text-clab-error" size={16} />
            <span className="text-[10px] text-clab-error uppercase font-bold">Topology YAML Required to start check.</span>
          </div>
        )}
      </div>
    </div>
  );
}
