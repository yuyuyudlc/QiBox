import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAgent } from './AgentContext';

export type RightPanelSurface =
  | { id: 'diff'; kind: 'diff'; requestedFile?: string }
  | { id: 'files'; kind: 'files' }
  | { id: 'terminal'; kind: 'terminal' }
  | { id: 'mcp'; kind: 'mcp' }
  | { id: `file:${string}`; kind: 'file'; relativePath: string; revealRequestId: number };

export interface ThreadRightPanelState {
  isOpen: boolean;
  maximized: boolean;
  width: number;
  activeSurfaceId: string | null;
  surfaces: RightPanelSurface[];
  detailsInlineOpen: boolean;
}

const STORAGE_KEY = 'qibox:right-panel-state:v1';
const DEFAULT_WIDTH = 500;
const MIN_WIDTH = 340;

const DEFAULT_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  maximized: false,
  width: DEFAULT_WIDTH,
  activeSurfaceId: null,
  surfaces: [],
  detailsInlineOpen: true,
};

function loadPersistedMap(): Record<string, ThreadRightPanelState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, ThreadRightPanelState> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== 'object') continue;
      const item = v as Partial<ThreadRightPanelState>;
      const surfaces = Array.isArray(item.surfaces)
        ? item.surfaces.filter(
            (s): s is RightPanelSurface =>
              Boolean(s && typeof s === 'object' && typeof s.id === 'string' && typeof s.kind === 'string'),
          )
        : [];
      const activeId =
        typeof item.activeSurfaceId === 'string' && surfaces.some((s) => s.id === item.activeSurfaceId)
          ? item.activeSurfaceId
          : surfaces[0]?.id ?? null;
      out[k] = {
        isOpen: Boolean(item.isOpen && surfaces.length > 0),
        maximized: Boolean(item.maximized && item.isOpen && surfaces.length > 0),
        width:
          typeof item.width === 'number' && Number.isFinite(item.width)
            ? Math.max(MIN_WIDTH, Math.round(item.width))
            : DEFAULT_WIDTH,
        activeSurfaceId: activeId,
        surfaces,
        detailsInlineOpen: item.detailsInlineOpen !== false,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function normalizeWorkspaceRelativePath(rawPath: string, projectRoot?: string): string | null {
  const cleaned = rawPath.trim().replace(/\\/g, '/').replace(/:\d+(?::\d+)?$/, '');
  if (!cleaned) return null;
  if (!cleaned.startsWith('/')) {
    return cleaned.replace(/^\.\//, '');
  }
  if (!projectRoot) return null;
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (cleaned === root) return '.';
  if (cleaned.startsWith(root + '/')) {
    return cleaned.slice(root.length + 1);
  }
  return null;
}

interface RightPanelContextValue {
  panelState: ThreadRightPanelState;
  detailsPopoverOpen: boolean;
  setDetailsPopoverOpen: (open: boolean) => void;
  toggleDetails: (inlineCapable: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setPanelWidth: (width: number) => void;
  toggleMaximized: () => void;
  setMaximized: (maximized: boolean) => void;
  openSurface: (kind: 'diff' | 'files' | 'terminal' | 'mcp', options?: { requestedFile?: string }) => void;
  openDiffProactive: () => void;
  openFile: (pathOrRelative: string) => boolean;
  activateSurface: (id: string) => void;
  closeSurface: (id: string) => void;
  closeOtherSurfaces: (id: string) => void;
  closeSurfacesToRight: (id: string) => void;
  closeAllSurfaces: () => void;
  moveSurface: (sourceId: string, targetId: string) => void;
}

const RightPanelContext = createContext<RightPanelContextValue | null>(null);

export const RightPanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { selectedSessionId, currentProject, isBusy } = useAgent();
  const threadKey = selectedSessionId || (currentProject?.id ? `project:${currentProject.id}` : 'default');

  const [byThread, setByThread] = useState<Record<string, ThreadRightPanelState>>(loadPersistedMap);
  const [detailsPopoverOpen, setDetailsPopoverOpen] = useState(false);

  // 防止用户在本轮已手动操作右侧面板时，Agent 完成后强行抢焦点
  const userRevisionRef = useRef<Record<string, number>>({});
  const turnStartRevisionRef = useRef<Record<string, number>>({});
  const prevBusyRef = useRef(isBusy);

  useEffect(() => {
    if (!prevBusyRef.current && isBusy) {
      turnStartRevisionRef.current[threadKey] = userRevisionRef.current[threadKey] || 0;
    }
    prevBusyRef.current = isBusy;
  }, [isBusy, threadKey]);

  useEffect(() => {
    setDetailsPopoverOpen(false);
  }, [threadKey]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(byThread));
    } catch {}
  }, [byThread]);

  const panelState = byThread[threadKey] ?? DEFAULT_THREAD_STATE;

  const markUserAction = useCallback((key: string) => {
    userRevisionRef.current[key] = (userRevisionRef.current[key] || 0) + 1;
  }, []);

  const updateThread = useCallback(
    (updater: (prev: ThreadRightPanelState) => ThreadRightPanelState, isUserAction = true) => {
      if (isUserAction) markUserAction(threadKey);
      setByThread((all) => {
        const cur = all[threadKey] ?? DEFAULT_THREAD_STATE;
        const next = updater(cur);
        return { ...all, [threadKey]: next };
      });
    },
    [threadKey, markUserAction],
  );

  const openSurface = useCallback(
    (kind: 'diff' | 'files' | 'terminal' | 'mcp', options?: { requestedFile?: string }) => {
      updateThread((cur) => {
        const existing = cur.surfaces.find((s) => s.id === kind);
        let surfaces = cur.surfaces;
        if (!existing) {
          const added: RightPanelSurface =
            kind === 'diff' && options?.requestedFile
              ? { id: 'diff', kind: 'diff', requestedFile: options.requestedFile }
              : ({ id: kind, kind } as RightPanelSurface);
          surfaces = [...cur.surfaces, added];
        } else if (kind === 'diff' && options?.requestedFile) {
          surfaces = cur.surfaces.map((s) =>
            s.id === 'diff' ? { id: 'diff', kind: 'diff', requestedFile: options.requestedFile } : s,
          );
        }
        return {
          ...cur,
          isOpen: true,
          surfaces,
          activeSurfaceId: kind,
        };
      });
    },
    [updateThread],
  );

  const openDiffProactive = useCallback(() => {
    const startRev = turnStartRevisionRef.current[threadKey] || 0;
    const curRev = userRevisionRef.current[threadKey] || 0;
    if (curRev !== startRev) return;
    updateThread((cur) => {
      if (cur.isOpen && cur.activeSurfaceId) return cur;
      const hasDiff = cur.surfaces.some((s) => s.id === 'diff');
      const surfaces: RightPanelSurface[] = hasDiff ? cur.surfaces : [...cur.surfaces, { id: 'diff', kind: 'diff' }];
      return { ...cur, isOpen: true, surfaces, activeSurfaceId: 'diff' };
    }, false);
  }, [threadKey, updateThread]);

  const openFile = useCallback(
    (pathOrRelative: string) => {
      const rel = normalizeWorkspaceRelativePath(pathOrRelative, currentProject?.root);
      if (!rel || rel === '.') return false;
      const targetId: `file:${string}` = `file:${rel}`;
      updateThread((cur) => {
        const idx = cur.surfaces.findIndex((s) => s.id === targetId);
        let surfaces: RightPanelSurface[];
        if (idx >= 0) {
          surfaces = cur.surfaces.map((s) =>
            s.id === targetId && s.kind === 'file' ? { ...s, revealRequestId: s.revealRequestId + 1 } : s,
          );
        } else {
          surfaces = [...cur.surfaces, { id: targetId, kind: 'file', relativePath: rel, revealRequestId: 1 }];
        }
        return {
          ...cur,
          isOpen: true,
          surfaces,
          activeSurfaceId: targetId,
        };
      });
      return true;
    },
    [currentProject?.root, updateThread],
  );

  const toggleRightPanel = useCallback(() => {
    updateThread((cur) => {
      if (cur.isOpen) {
        return { ...cur, isOpen: false, maximized: false };
      }
      if (cur.surfaces.length > 0) {
        return {
          ...cur,
          isOpen: true,
          activeSurfaceId: cur.activeSurfaceId ?? cur.surfaces[0]?.id ?? null,
        };
      }
      return {
        ...cur,
        isOpen: true,
        surfaces: [{ id: 'diff', kind: 'diff' }],
        activeSurfaceId: 'diff',
      };
    });
  }, [updateThread]);

  const setRightPanelOpen = useCallback(
    (open: boolean) => {
      updateThread((cur) => ({
        ...cur,
        isOpen: open,
        maximized: open ? cur.maximized : false,
        surfaces:
          open && cur.surfaces.length === 0 ? [{ id: 'diff', kind: 'diff' }] : cur.surfaces,
        activeSurfaceId:
          open && !cur.activeSurfaceId ? (cur.surfaces[0]?.id ?? 'diff') : cur.activeSurfaceId,
      }));
    },
    [updateThread],
  );

  const setPanelWidth = useCallback(
    (width: number) => {
      updateThread((cur) => ({ ...cur, width: Math.max(MIN_WIDTH, Math.round(width)) }), false);
    },
    [updateThread],
  );

  const toggleMaximized = useCallback(() => {
    updateThread((cur) => ({ ...cur, maximized: cur.isOpen ? !cur.maximized : false }));
  }, [updateThread]);

  const setMaximized = useCallback(
    (maximized: boolean) => {
      updateThread((cur) => ({ ...cur, maximized: cur.isOpen ? maximized : false }));
    },
    [updateThread],
  );

  const toggleDetails = useCallback(
    (inlineCapable: boolean) => {
      if (inlineCapable) {
        setDetailsPopoverOpen(false);
        updateThread((cur) => ({ ...cur, detailsInlineOpen: !cur.detailsInlineOpen }), false);
      } else {
        setDetailsPopoverOpen((v) => !v);
      }
    },
    [updateThread],
  );

  const activateSurface = useCallback(
    (id: string) => {
      updateThread((cur) => ({ ...cur, isOpen: true, activeSurfaceId: id }));
    },
    [updateThread],
  );

  const closeSurface = useCallback(
    (id: string) => {
      updateThread((cur) => {
        const idx = cur.surfaces.findIndex((s) => s.id === id);
        if (idx < 0) return cur;
        const nextSurfaces = cur.surfaces.filter((s) => s.id !== id);
        let nextActive = cur.activeSurfaceId;
        if (nextActive === id) {
          nextActive = nextSurfaces[idx]?.id ?? nextSurfaces[idx - 1]?.id ?? null;
        }
        return {
          ...cur,
          surfaces: nextSurfaces,
          activeSurfaceId: nextActive,
        };
      });
    },
    [updateThread],
  );

  const closeOtherSurfaces = useCallback(
    (id: string) => {
      updateThread((cur) => {
        const kept = cur.surfaces.filter((s) => s.id === id);
        return { ...cur, surfaces: kept, activeSurfaceId: kept[0]?.id ?? null };
      });
    },
    [updateThread],
  );

  const closeSurfacesToRight = useCallback(
    (id: string) => {
      updateThread((cur) => {
        const idx = cur.surfaces.findIndex((s) => s.id === id);
        if (idx < 0) return cur;
        const kept = cur.surfaces.slice(0, idx + 1);
        const stillExists = kept.some((s) => s.id === cur.activeSurfaceId);
        return {
          ...cur,
          surfaces: kept,
          activeSurfaceId: stillExists ? cur.activeSurfaceId : id,
        };
      });
    },
    [updateThread],
  );

  const closeAllSurfaces = useCallback(() => {
    updateThread((cur) => ({ ...cur, surfaces: [], activeSurfaceId: null }));
  }, [updateThread]);

  const moveSurface = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      updateThread((cur) => {
        const from = cur.surfaces.findIndex((s) => s.id === sourceId);
        const to = cur.surfaces.findIndex((s) => s.id === targetId);
        if (from < 0 || to < 0) return cur;
        const copy = [...cur.surfaces];
        const [moved] = copy.splice(from, 1);
        copy.splice(to, 0, moved);
        return { ...cur, surfaces: copy };
      });
    },
    [updateThread],
  );

  const value = useMemo<RightPanelContextValue>(
    () => ({
      panelState,
      detailsPopoverOpen,
      setDetailsPopoverOpen,
      toggleDetails,
      toggleRightPanel,
      setRightPanelOpen,
      setPanelWidth,
      toggleMaximized,
      setMaximized,
      openSurface,
      openDiffProactive,
      openFile,
      activateSurface,
      closeSurface,
      closeOtherSurfaces,
      closeSurfacesToRight,
      closeAllSurfaces,
      moveSurface,
    }),
    [
      panelState,
      detailsPopoverOpen,
      toggleDetails,
      toggleRightPanel,
      setRightPanelOpen,
      setPanelWidth,
      toggleMaximized,
      setMaximized,
      openSurface,
      openDiffProactive,
      openFile,
      activateSurface,
      closeSurface,
      closeOtherSurfaces,
      closeSurfacesToRight,
      closeAllSurfaces,
      moveSurface,
    ],
  );

  return <RightPanelContext.Provider value={value}>{children}</RightPanelContext.Provider>;
};

export function useRightPanel(): RightPanelContextValue {
  const ctx = useContext(RightPanelContext);
  if (!ctx) throw new Error('useRightPanel must be used inside RightPanelProvider');
  return ctx;
}
