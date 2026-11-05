import { useCallback, useRef, useState } from 'react';
import { workspaceService } from '../services/workspace';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.runtime', '.next', '__pycache__']);
const MAX_FILES = 350;
const MAX_DIRS = 40;

export function useWorkspaceFiles(projectId: string) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedProjectRef = useRef<string>('');
  const loadingRef = useRef(false);

  const loadFiles = useCallback(async (force = false) => {
    if (!projectId || loadingRef.current) return;
    if (!force && loadedProjectRef.current === projectId) return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const queue: string[] = ['.'];
      const collected: string[] = [];
      let dirsVisited = 0;

      while (queue.length > 0 && collected.length < MAX_FILES && dirsVisited < MAX_DIRS) {
        const dir = queue.shift()!;
        dirsVisited++;
        const res = await workspaceService.listFiles(projectId, dir);
        const prefix = dir === '.' ? '' : `${dir}/`;
        for (const entry of res.entries) {
          if (entry.name.startsWith('.') && entry.name !== '.env.example') {
            if (IGNORED_DIRS.has(entry.name)) continue;
          }
          const rel = `${prefix}${entry.name}`;
          if (entry.type === 'directory') {
            if (!IGNORED_DIRS.has(entry.name)) queue.push(rel);
          } else {
            collected.push(rel);
            if (collected.length >= MAX_FILES) break;
          }
        }
      }

      loadedProjectRef.current = projectId;
      setFiles(collected);
    } catch {
      // Ignore transient list errors during typing
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [projectId]);

  return { files, loading, loadFiles };
}
