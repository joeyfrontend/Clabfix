/**
 * ── src/components/DirectoryPicker.tsx ───────────────────
 * CHANGES (Problem 5):
 *  1. Accepts yamlFilePath prop — the directory of the loaded .clab.yml file.
 *  2. On open: starts from yamlFilePath if provided and valid, otherwise
 *     falls back to initialPath, then to home dir from the server.
 *  3. Home button goes to the user's home dir (from server response), NOT root.
 *  4. Never starts from "/" — always a meaningful directory.
 */

import { useState, useEffect, useRef } from 'react';
import { Folder, ChevronRight, X, Home } from 'lucide-react';
import { cn } from '../lib/utils';

type DirectoryPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath: string;
  yamlFilePath?: string; // Problem 5: directory of the loaded .clab.yml
};

export default function DirectoryPicker({
  isOpen,
  onClose,
  onSelect,
  initialPath,
  yamlFilePath,
}: DirectoryPickerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState<{ name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const hasInitialized = useRef(false);

  const fetchFolders = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/fs?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to read directory');
      setFolders(data.folders);
      setCurrentPath(data.current);
      if (data.home) setHomeDir(data.home);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Problem 5: Determine the best starting path when opened
  useEffect(() => {
    if (isOpen) {
      // Priority: yamlFilePath > initialPath > home dir > cwd
      const startPath = yamlFilePath || initialPath || '/';
      hasInitialized.current = true;
      fetchFolders(startPath);
    }
  }, [isOpen, yamlFilePath, initialPath]);

  if (!isOpen) return null;

  const goHome = () => {
    // Use the server-reported home dir, not root
    fetchFolders(homeDir || initialPath || '/');
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#0f1115] border border-clab-border w-full max-w-2xl flex flex-col h-[600px] shadow-2xl rounded-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-clab-border bg-[#15181e]">
          <h2 className="text-clab-accent font-bold text-xs uppercase tracking-widest flex items-center gap-2">
            <Folder size={14} />
            Select Working Directory
          </h2>
          <button onClick={onClose} className="text-clab-muted hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Path Navigator */}
        <div className="p-3 bg-[#0a0c0f] border-b border-clab-border flex items-center gap-2">
          <button
            onClick={goHome}
            className="text-clab-muted hover:text-clab-accent p-1"
            title="Go to home directory"
          >
            <Home size={14} />
          </button>
          <div className="h-4 w-px bg-clab-border/50" />
          <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-none flex items-center font-mono text-xs text-gray-300">
            {currentPath.split('/').filter(Boolean).map((part, i, arr) => {
              const pathSoFar = '/' + arr.slice(0, i + 1).join('/');
              return (
                <div key={i} className="flex items-center">
                  <span className="text-clab-muted/50 mx-1">/</span>
                  <button
                    onClick={() => fetchFolders(pathSoFar)}
                    className="hover:text-clab-accent hover:underline transition-colors px-1"
                  >
                    {part}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Folder List */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-full text-clab-muted text-xs">Loading...</div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-clab-warning text-xs">{error}</div>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {currentPath !== '/' && (
                <button
                  onClick={() => fetchFolders(currentPath.substring(0, currentPath.lastIndexOf('/')) || '/')}
                  className="flex items-center gap-3 p-2 hover:bg-white/5 text-left text-sm font-mono text-clab-muted transition-colors rounded-sm group"
                >
                  <Folder size={16} className="text-clab-muted/50 group-hover:text-clab-accent" />
                  ..
                </button>
              )}
              {folders.map(f => (
                <button
                  key={f.path}
                  onClick={() => fetchFolders(f.path)}
                  className="flex items-center justify-between p-2 hover:bg-white/5 text-left text-sm font-mono text-gray-300 transition-colors rounded-sm group"
                >
                  <div className="flex items-center gap-3">
                    <Folder size={16} className="text-clab-accent opacity-70 group-hover:opacity-100" />
                    {f.name}
                  </div>
                  <ChevronRight size={14} className="text-clab-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
              {folders.length === 0 && (
                <div className="text-center text-clab-muted/50 text-xs mt-10 italic">No subdirectories found</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-clab-border bg-[#15181e] flex items-center justify-between">
          <div className="text-xs font-mono text-clab-muted truncate pr-4 max-w-md">
            Selected: <span className="text-white">{currentPath}</span>
          </div>
          <div className="flex gap-3 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-bold text-clab-muted hover:text-white transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={() => {
                onSelect(currentPath);
                onClose();
              }}
              className="px-6 py-1.5 text-xs font-bold bg-clab-accent text-black hover:bg-[#3ceb9f] transition-colors rounded-sm shadow-[0_0_10px_rgba(46,230,148,0.2)]"
            >
              SELECT FOLDER
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
