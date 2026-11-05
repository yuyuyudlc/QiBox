import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Dropdown, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useRightPanel, type RightPanelSurface } from '../../contexts/RightPanelContext';
import { useAgent } from '../../contexts/AgentContext';
import { useClipboard } from '../../hooks/useClipboard';
import GitDiffPanel from './GitDiffPanel';
import FileExplorerPanel from './FileExplorerPanel';
import FilePreviewTab from './FilePreviewTab';
import TerminalPanel from './TerminalPanel';
import McpPanel from './McpPanel';
import {
  ChevronRightIcon,
  FileCodeIcon,
  FileDiffIcon,
  FolderOpenIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlugIcon,
  PlusIcon,
  TerminalSquareIcon,
  XIcon,
} from './WorkbenchIcons';

interface RightWorkbenchPanelProps {
  projectId: string;
  projectRoot: string;
  sessionId: string;
  containerWidth: number;
  sheet: boolean;
  onMentionFile?: (path: string) => void;
}

const MIN_WIDTH = 360;
const MIN_CHAT_WIDTH = 360;

function getTabTitle(surface: RightPanelSurface): string {
  switch (surface.kind) {
    case 'diff':
      return '代码变更';
    case 'files':
      return '文件';
    case 'terminal':
      return '终端';
    case 'mcp':
      return 'MCP';
    case 'file': {
      const parts = surface.relativePath.split('/');
      return parts[parts.length - 1] || surface.relativePath;
    }
  }
}

function getTabIcon(surface: RightPanelSurface): React.ReactNode {
  switch (surface.kind) {
    case 'diff':
      return <FileDiffIcon size={13.5} />;
    case 'files':
      return <FolderOpenIcon size={13.5} />;
    case 'terminal':
      return <TerminalSquareIcon size={13.5} />;
    case 'mcp':
      return <PlugIcon size={13.5} />;
    case 'file':
      return <FileCodeIcon size={13.5} />;
  }
}

const RightPanelEmptyLauncher: React.FC<{
  hasProject: boolean;
  onAdd: (kind: 'diff' | 'files' | 'terminal' | 'mcp') => void;
}> = ({ hasProject, onAdd }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const actions: Array<{
    key: 'diff' | 'files' | 'terminal' | 'mcp';
    label: string;
    shortcut: string;
    icon: React.ReactNode;
    disabled?: boolean;
  }> = [
    {
      key: 'diff',
      label: '代码变更审查 (Review Diff)',
      shortcut: 'D',
      icon: <FileDiffIcon size={14} />,
      disabled: !hasProject,
    },
    {
      key: 'files',
      label: '工作区文件浏览器 (Files)',
      shortcut: 'F',
      icon: <FolderOpenIcon size={14} />,
      disabled: !hasProject,
    },
    {
      key: 'terminal',
      label: 'WSL2 原生终端 (Terminal)',
      shortcut: 'T',
      icon: <TerminalSquareIcon size={14} />,
      disabled: !hasProject,
    },
    {
      key: 'mcp',
      label: 'MCP 扩展服务 (Extensions)',
      shortcut: 'M',
      icon: <PlugIcon size={14} />,
      disabled: !hasProject,
    },
  ];

  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % actions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + actions.length) % actions.length);
      return;
    }
    if (e.key === 'Enter') {
      const item = actions[selectedIndex];
      if (item && !item.disabled) {
        e.preventDefault();
        onAdd(item.key);
      }
      return;
    }
    const hit = actions.find((a) => !a.disabled && a.shortcut === e.key.toUpperCase());
    if (hit) {
      e.preventDefault();
      onAdd(hit.key);
    }
  };

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="qibox-empty-surface-shell"
    >
      <div className="qibox-empty-surface-menu">
        <div className="qibox-empty-surface-title">打开工作台面板</div>
        {actions.map((item, idx) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onMouseEnter={() => setSelectedIndex(idx)}
            onClick={() => onAdd(item.key)}
            className={`qibox-empty-surface-item ${idx === selectedIndex ? 'is-selected' : ''}`}
          >
            <span className="qibox-empty-surface-left">
              <span className="qibox-empty-surface-icon">{item.icon}</span>
              <span>{item.label}</span>
            </span>
            <kbd className="qibox-kbd">{item.shortcut}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
};

export const RightWorkbenchPanel: React.FC<RightWorkbenchPanelProps> = ({
  projectId,
  projectRoot,
  sessionId,
  containerWidth,
  sheet,
  onMentionFile,
}) => {
  const { copyText } = useClipboard();
  const {
    panelState,
    setRightPanelOpen,
    setPanelWidth,
    toggleMaximized,
    openSurface,
    openFile,
    activateSurface,
    closeSurface,
    closeOtherSurfaces,
    closeSurfacesToRight,
    closeAllSurfaces,
    moveSurface,
  } = useRightPanel();
  const { isBusy } = useAgent();
  void isBusy;

  const { isOpen, maximized, width, surfaces, activeSurfaceId } = panelState;

  const shellRef = useRef<HTMLDivElement>(null);
  const focusOriginRef = useRef<HTMLElement | null>(null);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [hoverResize, setHoverResize] = useState(false);
  const [scrollOverflow, setScrollOverflow] = useState({ left: false, right: false });

  const maxWidth = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const fractionCap = Math.floor(vw * 0.72);
    const containerCap =
      containerWidth > 0 ? Math.floor(containerWidth - MIN_CHAT_WIDTH) : fractionCap;
    return Math.max(MIN_WIDTH, Math.min(fractionCap, containerCap));
  }, [containerWidth]);

  const clampedWidth = Math.min(Math.max(width, MIN_WIDTH), maxWidth);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || sheet) return;
    const collapsed = !isOpen;
    if (collapsed && el.contains(document.activeElement)) {
      const origin = focusOriginRef.current;
      if (origin && origin.isConnected && !el.contains(origin)) {
        origin.focus({ preventScroll: true });
      } else {
        const toggle = document.querySelector<HTMLElement>('[data-right-panel-toggle]');
        toggle?.focus({ preventScroll: true });
      }
    }
    if (collapsed) focusOriginRef.current = null;
    el.toggleAttribute('inert', collapsed);
  }, [isOpen, sheet]);

  const updateTabScroll = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    setScrollOverflow({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    updateTabScroll();
  }, [surfaces, clampedWidth, isOpen, maximized, updateTabScroll]);

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || maximized || sheet) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = clampedWidth;
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const next = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta));
      setPanelWidth(next);
    };
    const onEnd = () => {
      setDragging(false);
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const addMenuItems: MenuProps['items'] = [
    {
      key: 'diff',
      icon: <FileDiffIcon size={13.5} />,
      label: '代码变更 (Review)',
      disabled: !projectId,
    },
    {
      key: 'files',
      icon: <FolderOpenIcon size={13.5} />,
      label: '工作区文件 (Files)',
      disabled: !projectId,
    },
    {
      key: 'terminal',
      icon: <TerminalSquareIcon size={13.5} />,
      label: '原生终端 (Terminal)',
      disabled: !projectId,
    },
    {
      key: 'mcp',
      icon: <PlugIcon size={13.5} />,
      label: 'MCP 扩展服务',
      disabled: !projectId,
    },
  ];

  const getTabContextMenu = (surface: RightPanelSurface, index: number): MenuProps => {
    const fullPath =
      surface.kind === 'file' && projectRoot && !surface.relativePath.startsWith('/')
        ? `${projectRoot.replace(/\/+$/, '')}/${surface.relativePath}`
        : surface.kind === 'file'
          ? surface.relativePath
          : '';
    return {
      items: [
        ...(surface.kind === 'file'
          ? [{ key: 'copy-path', label: '复制文件路径' }, { type: 'divider' as const }]
          : []),
        { key: 'close', label: '关闭标签页' },
        { key: 'close-others', label: '关闭其他标签页', disabled: surfaces.length <= 1 },
        {
          key: 'close-right',
          label: '关闭右侧标签页',
          disabled: index >= surfaces.length - 1,
        },
        { key: 'close-all', label: '全部关闭', danger: true },
      ],
      onClick: ({ key }) => {
        if (key === 'copy-path' && fullPath) {
          void copyText(fullPath, `ctx-${surface.id}`, '路径已复制');
        } else if (key === 'close') {
          closeSurface(surface.id);
        } else if (key === 'close-others') {
          closeOtherSurfaces(surface.id);
        } else if (key === 'close-right') {
          closeSurfacesToRight(surface.id);
        } else if (key === 'close-all') {
          closeAllSurfaces();
        }
      },
    };
  };

  const hasTerminal = surfaces.some((s) => s.kind === 'terminal');
  const hasMcp = surfaces.some((s) => s.kind === 'mcp');
  const activeSurface = surfaces.find((s) => s.id === activeSurfaceId) ?? null;

  const workbenchInner = (
    <div className="qibox-workbench-inner">
      {/* 单层高质感胶囊 Tab 栏（对齐 T3 Code RightPanelTabs · 48px 与左栏顶栏同高贯通） */}
      <div className="qibox-workbench-tabbar">
        <div
          ref={tabScrollRef}
          onScroll={updateTabScroll}
          className="qibox-workbench-tabs-scroll no-scrollbar"
        >
          {surfaces.map((surface, idx) => {
            const active = surface.id === activeSurfaceId;
            const title = getTabTitle(surface);
            const fullTip = surface.kind === 'file' ? surface.relativePath : title;
            const isDropTarget = dropTargetId === surface.id && dragTabId !== surface.id;
            return (
              <Dropdown
                key={surface.id}
                trigger={['contextMenu']}
                menu={getTabContextMenu(surface, idx)}
              >
                <div
                  role="tab"
                  aria-selected={active}
                  draggable
                  onDragStart={(e) => {
                    setDragTabId(surface.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragTabId && dragTabId !== surface.id) setDropTargetId(surface.id);
                  }}
                  onDragLeave={() => {
                    if (dropTargetId === surface.id) setDropTargetId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragTabId && dragTabId !== surface.id) moveSurface(dragTabId, surface.id);
                    setDragTabId(null);
                    setDropTargetId(null);
                  }}
                  onDragEnd={() => {
                    setDragTabId(null);
                    setDropTargetId(null);
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeSurface(surface.id);
                    }
                  }}
                  onClick={() => activateSurface(surface.id)}
                  title={fullTip}
                  className={`qibox-workbench-tab ${active ? 'is-active' : ''} ${
                    isDropTarget ? 'is-drop-target' : ''
                  }`}
                >
                  <span className="qibox-workbench-tab-icon">{getTabIcon(surface)}</span>
                  <span className="qibox-workbench-tab-title">{title}</span>
                  <button
                    type="button"
                    aria-label={`关闭 ${title}`}
                    className="qibox-workbench-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSurface(surface.id);
                    }}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              </Dropdown>
            );
          })}

          <Dropdown
            trigger={['click']}
            menu={{
              items: addMenuItems,
              onClick: ({ key }) => openSurface(key as 'diff' | 'files' | 'terminal' | 'mcp'),
            }}
          >
            <Tooltip title="打开工作台标签页">
              <button
                type="button"
                className="qibox-workbench-icon-btn"
                aria-label="打开新标签页"
              >
                <PlusIcon size={14} />
              </button>
            </Tooltip>
          </Dropdown>
        </div>

        {(scrollOverflow.left || scrollOverflow.right) && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button
              type="button"
              disabled={!scrollOverflow.left}
              className="qibox-workbench-icon-btn"
              onClick={() => tabScrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' })}
            >
              <ChevronRightIcon size={13} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <button
              type="button"
              disabled={!scrollOverflow.right}
              className="qibox-workbench-icon-btn"
              onClick={() => tabScrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' })}
            >
              <ChevronRightIcon size={13} />
            </button>
          </div>
        )}

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {!sheet && (
            <Tooltip title={maximized ? '还原分屏宽度' : '最大化右侧工作台'}>
              <button
                type="button"
                className="qibox-workbench-icon-btn"
                aria-label={maximized ? '还原右侧分屏' : '最大化右侧工作台'}
                onClick={toggleMaximized}
              >
                {maximized ? <Minimize2Icon size={13.5} /> : <Maximize2Icon size={13.5} />}
              </button>
            </Tooltip>
          )}
          {sheet && (
            <Tooltip title="关闭抽屉">
              <button
                type="button"
                className="qibox-workbench-icon-btn"
                aria-label="收起右侧工作台"
                onClick={() => setRightPanelOpen(false)}
              >
                <XIcon size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* 全贴边沉浸式内容主体区 (Edge-to-Edge Surface Host) */}
      <div className="qibox-workbench-body">
        {!activeSurface ? (
          <RightPanelEmptyLauncher
            hasProject={Boolean(projectId)}
            onAdd={(kind) => openSurface(kind)}
          />
        ) : !projectId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography.Text type="secondary">请先在左侧选择或创建一个工作区项目。</Typography.Text>
          </div>
        ) : (
          <>
            {activeSurface.kind === 'diff' && (
              <GitDiffPanel
                projectId={projectId}
                requestedFile={activeSurface.requestedFile}
                onMentionFile={onMentionFile}
                onOpenFile={(path) => void openFile(path)}
              />
            )}
            {activeSurface.kind === 'files' && (
              <FileExplorerPanel
                projectId={projectId}
                onMentionFile={onMentionFile}
                onOpenFile={(path) => void openFile(path)}
              />
            )}
            {activeSurface.kind === 'file' && (
              <FilePreviewTab
                projectId={projectId}
                projectRoot={projectRoot}
                relativePath={activeSurface.relativePath}
                revealRequestId={activeSurface.revealRequestId}
                onMentionFile={onMentionFile}
              />
            )}
            {hasTerminal && (
              <div
                hidden={activeSurface.kind !== 'terminal'}
                style={{
                  display: activeSurface.kind === 'terminal' ? 'flex' : 'none',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 0,
                }}
              >
                <TerminalPanel
                  key={projectId}
                  active={isOpen && activeSurface.kind === 'terminal'}
                  projectId={projectId}
                  root={projectRoot}
                />
              </div>
            )}
            {hasMcp && (
              <div
                hidden={activeSurface.kind !== 'mcp'}
                style={{
                  display: activeSurface.kind === 'mcp' ? 'flex' : 'none',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 0,
                }}
              >
                <McpPanel
                  active={isOpen && activeSurface.kind === 'mcp'}
                  projectId={projectId}
                  sessionId={sessionId}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (sheet) {
    return (
      <Drawer
        placement="right"
        open={isOpen}
        onClose={() => setRightPanelOpen(false)}
        width="min(92vw, 540px)"
        closable={false}
        styles={{
          header: { display: 'none' },
          body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' },
        }}
      >
        {workbenchInner}
      </Drawer>
    );
  }

  return (
    <div
      ref={shellRef}
      onFocus={(e) => {
        const from = e.relatedTarget as HTMLElement | null;
        if (from && !shellRef.current?.contains(from)) {
          focusOriginRef.current = from;
        }
      }}
      style={{
        position: 'relative',
        flexShrink: maximized ? 1 : 0,
        flexGrow: maximized ? 1 : 0,
        width: maximized ? '100%' : isOpen ? clampedWidth : 0,
        height: '100%',
        minHeight: 0,
        borderLeft: isOpen && !maximized ? '1px solid #E4E4E7' : 'none',
        background: '#FFFFFF',
        transition: dragging ? 'none' : 'width 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {isOpen && !maximized && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调节右侧工作台宽度"
          onPointerDown={handleResizePointerDown}
          onMouseEnter={() => setHoverResize(true)}
          onMouseLeave={() => setHoverResize(false)}
          style={{
            position: 'absolute',
            left: -3,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            zIndex: 25,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 2,
              height: '100%',
              background: dragging ? '#18181B' : hoverResize ? '#A1A1AA' : 'transparent',
              transition: 'background-color 0.15s ease',
            }}
          />
        </div>
      )}

      <div
        style={{
          height: '100%',
          width: '100%',
          overflow: 'hidden',
          display: maximized ? 'block' : 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <div
          style={{
            height: '100%',
            width: maximized ? '100%' : clampedWidth - 1,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {workbenchInner}
        </div>
      </div>
    </div>
  );
};

export default RightWorkbenchPanel;
