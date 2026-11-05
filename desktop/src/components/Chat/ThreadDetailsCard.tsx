import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dropdown, Input, Modal, Popover, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import { useAgent } from '../../contexts/AgentContext';
import { useConsole } from '../../contexts/ConsoleContext';
import { useRightPanel } from '../../contexts/RightPanelContext';
import { workspaceService, type ExternalEditorId } from '../../services/workspace';
import type { GitStatusEntry } from '../../services/types';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FileDiffIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  TerminalSquareIcon,
} from '../Workbench/WorkbenchIcons';

export const THREAD_DETAILS_CARD_WIDTH = 280;

interface DetailsVisibility {
  workspace: boolean;
  git: boolean;
  runtime: boolean;
  usage: boolean;
}

const VISIBILITY_KEY = 'qibox:thread-details-visibility:v2';
const DEFAULT_EDITOR_KEY = 'qibox:PreferredEditor:v1';

const EDITOR_OPTIONS: { id: ExternalEditorId; label: string; shortLabel: string }[] = [
  { id: 'vscode', label: '在 VS Code 中打开', shortLabel: 'VS Code' },
  { id: 'cursor', label: '在 Cursor 中打开', shortLabel: 'Cursor' },
  { id: 'antigravity', label: '在 Antigravity 中打开', shortLabel: 'Antigravity' },
  { id: 'zed', label: '在 Zed 中打开', shortLabel: 'Zed' },
  { id: 'explorer', label: '在 Windows 资源管理器中打开', shortLabel: '资源管理器' },
  { id: 'terminal', label: '在 Windows 终端中打开', shortLabel: 'Windows 终端' },
];

function loadVisibility(): DetailsVisibility {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY);
    if (!raw) return { workspace: true, git: true, runtime: true, usage: true };
    const parsed = JSON.parse(raw);
    return {
      workspace: parsed.workspace !== false,
      git: parsed.git !== false,
      runtime: parsed.runtime !== false,
      usage: parsed.usage !== false,
    };
  } catch {
    return { workspace: true, git: true, runtime: true, usage: true };
  }
}

function loadPreferredEditor(): ExternalEditorId {
  try {
    const saved = localStorage.getItem(DEFAULT_EDITOR_KEY) as ExternalEditorId | null;
    if (saved && EDITOR_OPTIONS.some((o) => o.id === saved)) return saved;
  } catch {}
  return 'vscode';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatResetAt(raw?: string | number | null): string {
  if (!raw) return '';
  const ts = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function countDiffStats(diffText: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function parseBranchList(raw: string, currentBranch: string): string[] {
  const set = new Set<string>();
  if (currentBranch && currentBranch !== '(尚无提交)') set.add(currentBranch);
  for (const line of raw.split('\n')) {
    const cleaned = line.replace(/^\*?\s+/, '').trim();
    if (cleaned && !cleaned.includes('->')) set.add(cleaned);
  }
  return Array.from(set);
}

function extractReferencedFiles(messages: { blocks?: { type: string; text: string }[] }[], draft: string): string[] {
  const found = new Set<string>();
  const regex = /@([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
  const scan = (text: string) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const candidate = match[1];
      if (!candidate.startsWith('.isolation-uploads/')) {
        found.add(candidate);
      }
    }
  };
  if (draft) scan(draft);
  for (let i = messages.length - 1; i >= 0 && found.size < 6; i--) {
    const msg = messages[i];
    for (const b of msg.blocks || []) {
      if (b.type === 'text' && b.text) scan(b.text);
    }
  }
  return Array.from(found).slice(0, 5);
}

const UsageBarRow: React.FC<{
  label: string;
  valueText: string;
  percent: number | null;
  tone?: 'normal' | 'warning' | 'danger';
  showCompactTick?: boolean;
  tooltip?: React.ReactNode;
}> = ({ label, valueText, percent, tone = 'normal', showCompactTick, tooltip }) => {
  const fill =
    tone === 'danger' ? '#EF4444' : tone === 'warning' ? '#F59E0B' : '#18181B';
  const textTone =
    tone === 'danger' ? '#DC2626' : tone === 'warning' ? '#D97706' : '#52525B';

  const content = (
    <div className="qibox-hud-usage-row">
      <span className="qibox-hud-usage-label">{label}</span>
      <div className="qibox-hud-usage-track">
        {percent !== null && (
          <div
            className="qibox-hud-usage-fill"
            style={{
              width: `${Math.max(0, Math.min(100, percent))}%`,
              background: fill,
            }}
          />
        )}
        {showCompactTick && (
          <span
            className="qibox-hud-usage-tick"
            style={{ left: '80%' }}
            title="80% 自动压缩阈值"
          />
        )}
      </div>
      <span className="qibox-hud-usage-value" style={{ color: textTone }}>
        {valueText}
      </span>
    </div>
  );

  if (!tooltip) return content;
  return (
    <Popover
      placement="left"
      mouseEnterDelay={0.12}
      overlayInnerStyle={{
        padding: '10px 12px',
        borderRadius: 12,
        background: 'rgba(24, 24, 27, 0.96)',
        color: '#F4F4F5',
        fontSize: 11.5,
        boxShadow: '0 14px 32px rgba(0, 0, 0, 0.24)',
      }}
      content={tooltip}
    >
      {content}
    </Popover>
  );
};

export const ThreadDetailsBody: React.FC<{ compact?: boolean; inline?: boolean }> = () => {
  const { snapshot } = useConsole();
  const {
    projectId,
    currentProject,
    selectedSessionId,
    activeSession,
    conversation,
    draft,
    usageMap,
    accountUsage,
    isBusy,
    setDraft,
    refreshCapabilities,
  } = useAgent();
  const { openSurface, openFile, setDetailsPopoverOpen } = useRightPanel();

  const [visibility, setVisibility] = useState<DetailsVisibility>(loadVisibility);
  const [preferredEditor, setPreferredEditor] = useState<ExternalEditorId>(loadPreferredEditor);

  // Git telemetry
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [gitEntries, setGitEntries] = useState<GitStatusEntry[]>([]);
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null);
  const [gitError, setGitError] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);

  // Runtime telemetry (Terminals & MCP)
  const [activeTerminalCount, setActiveTerminalCount] = useState(0);
  const [mcpCount, setMcpCount] = useState(0);

  // Quick commit modal / branch creation modal
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [newBranchModalOpen, setNewBranchModalOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [gitActionBusy, setGitActionBusy] = useState<string | null>(null);
  const [quotaRefreshing, setQuotaRefreshing] = useState(false);

  const wslPath = currentProject?.root || '/workspace';
  const distro = snapshot?.runtime?.distro || snapshot?.policy?.runtime?.distro || 'Ubuntu';
  const wslRunning = Boolean(snapshot?.runtime?.running);

  const loadTelemetry = useCallback(async () => {
    if (!projectId) {
      setBranch('');
      setBranches([]);
      setGitEntries([]);
      setDiffStats(null);
      setGitError(false);
      setActiveTerminalCount(0);
      setMcpCount(0);
      return;
    }
    setGitLoading(true);
    setGitError(false);

    // Load Git status + branches + diff stats
    try {
      const statusRes = await workspaceService.gitStatus(projectId);
      setBranch(statusRes.branch);
      setGitEntries(statusRes.entries);
      if (statusRes.entries.length > 0) {
        try {
          const [unstaged, staged] = await Promise.all([
            workspaceService.gitDiff(projectId, undefined, false),
            workspaceService.gitDiff(projectId, undefined, true),
          ]);
          const combined = `${unstaged.text || ''}\n${staged.text || ''}`;
          setDiffStats(countDiffStats(combined));
        } catch {
          setDiffStats(null);
        }
      } else {
        setDiffStats({ additions: 0, deletions: 0 });
      }
      try {
        const brRes = await workspaceService.gitBranches(projectId);
        setBranches(parseBranchList(brRes.text || '', statusRes.branch));
      } catch {
        setBranches(statusRes.branch ? [statusRes.branch] : []);
      }
    } catch {
      setBranch('');
      setBranches([]);
      setGitEntries([]);
      setDiffStats(null);
      setGitError(true);
    } finally {
      setGitLoading(false);
    }

    // Load active terminals & MCP count quietly
    try {
      const terms = await workspaceService.listTerminals(projectId);
      setActiveTerminalCount(terms.filter((t) => !t.exited).length);
    } catch {
      setActiveTerminalCount(0);
    }
    try {
      const mcp = await workspaceService.readMcp(projectId);
      const servers = (mcp?.config as any)?.mcpServers;
      setMcpCount(servers && typeof servers === 'object' ? Object.keys(servers).length : 0);
    } catch {
      setMcpCount(0);
    }
  }, [projectId]);

  useEffect(() => {
    void loadTelemetry();
  }, [loadTelemetry, isBusy]);

  const toggleSection = (key: keyof DetailsVisibility) => {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(VISIBILITY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleOpenInEditor = async (editorId: ExternalEditorId) => {
    try {
      setPreferredEditor(editorId);
      localStorage.setItem(DEFAULT_EDITOR_KEY, editorId);
    } catch {}
    try {
      await workspaceService.openInEditor(editorId, wslPath, distro);
    } catch (e: any) {
      message.error(e?.message || '无法启动外部程序');
    }
  };

  const handleCopyPath = async (asWindowsUnc = false) => {
    const text = asWindowsUnc
      ? `\\\\wsl.localhost\\${distro}${wslPath.replace(/\//g, '\\')}`
      : wslPath;
    try {
      await navigator.clipboard.writeText(text);
      message.success(`已复制路径：${text}`);
    } catch {
      message.error('复制失败');
    }
  };

  const handleCheckoutBranch = async (targetBranch: string, create = false) => {
    if (!projectId || !targetBranch.trim()) return;
    setGitActionBusy('checkout');
    try {
      await workspaceService.gitCheckout(projectId, targetBranch.trim(), create);
      message.success(create ? `已新建并切换到分支 ${targetBranch}` : `已切换到分支 ${targetBranch}`);
      setNewBranchModalOpen(false);
      setNewBranchName('');
      await loadTelemetry();
    } catch (e: any) {
      message.error(e?.message || '切换分支失败');
    } finally {
      setGitActionBusy(null);
    }
  };

  const handleQuickCommit = async (andPush = false) => {
    if (!projectId) return;
    if (!commitMessage.trim()) {
      message.warning('请输入提交说明 (Commit Message)');
      return;
    }
    setCommitting(true);
    try {
      const allPaths = gitEntries.map((e) => e.path);
      if (allPaths.length > 0) {
        await workspaceService.gitStage(projectId, allPaths);
      }
      await workspaceService.gitCommit(projectId, commitMessage.trim());
      if (andPush) {
        await workspaceService.gitPush(projectId, 'origin');
        message.success('已完成提交并推送到 origin');
      } else {
        message.success('提交成功');
      }
      setCommitMessage('');
      setCommitModalOpen(false);
      await loadTelemetry();
    } catch (e: any) {
      message.error(e?.message || 'Git 提交失败');
    } finally {
      setCommitting(false);
    }
  };

  const handleGitRemoteOp = async (op: 'push' | 'pull' | 'fetch') => {
    if (!projectId) return;
    setGitActionBusy(op);
    try {
      if (op === 'push') await workspaceService.gitPush(projectId, 'origin');
      else if (op === 'pull') await workspaceService.gitPull(projectId, 'origin');
      else await workspaceService.gitFetch(projectId, 'origin');
      message.success(`Git ${op} 完成`);
      await loadTelemetry();
    } catch (e: any) {
      message.error(e?.message || `Git ${op} 失败`);
    } finally {
      setGitActionBusy(null);
    }
  };

  const handleRefreshAll = async () => {
    setQuotaRefreshing(true);
    try {
      await Promise.allSettled([
        loadTelemetry(),
        selectedSessionId ? refreshCapabilities() : Promise.resolve(),
      ]);
    } finally {
      setQuotaRefreshing(false);
    }
  };

  const jumpToSurface = (kind: 'diff' | 'files' | 'terminal' | 'mcp', file?: string) => {
    setDetailsPopoverOpen(false);
    openSurface(kind, file ? { requestedFile: file } : undefined);
  };

  const referencedFiles = useMemo(
    () => extractReferencedFiles(conversation?.messages || [], draft),
    [conversation?.messages, draft],
  );

  const sessionUsage = selectedSessionId ? usageMap[selectedSessionId] : undefined;
  const modelStr = `${activeSession?.actualModel || activeSession?.model || ''}`.toLowerCase();
  const windowSize = sessionUsage
    ? sessionUsage.contextWindow > 0
      ? sessionUsage.contextWindow
      : modelStr.includes('1m')
        ? 1_000_000
        : 200_000
    : 0;
  const contextPct =
    sessionUsage && windowSize > 0
      ? Math.min(100, Math.round((sessionUsage.contextTokens / windowSize) * 100))
      : null;

  const five = accountUsage?.fiveHour;
  const seven = accountUsage?.sevenDay;
  const hasUsageBars = Boolean(visibility.usage && (five || seven || sessionUsage));

  const currentEditorOption =
    EDITOR_OPTIONS.find((o) => o.id === preferredEditor) || EDITOR_OPTIONS[0];

  const cardMenu: MenuProps = {
    items: [
      {
        key: 'refresh',
        label: '刷新工作区与额度状态',
        icon: <RefreshCwIcon size={13} spin={gitLoading || quotaRefreshing} />,
        onClick: () => void handleRefreshAll(),
      },
      {
        key: 'copy-wsl',
        label: '复制 WSL2 路径',
        icon: <CopyIcon size={13} />,
        onClick: () => void handleCopyPath(false),
      },
      {
        key: 'copy-unc',
        label: '复制 Windows 共享路径 (\\\\wsl.localhost)',
        icon: <FolderIcon size={13} />,
        onClick: () => void handleCopyPath(true),
      },
      { type: 'divider' },
      {
        type: 'group',
        label: '选择显示模块 (Choose what to show)',
        children: [
          {
            key: 'toggle:workspace',
            label: `${visibility.workspace ? '✓ ' : '   '}工作区与外部编辑器`,
            onClick: () => toggleSection('workspace'),
          },
          {
            key: 'toggle:git',
            label: `${visibility.git ? '✓ ' : '   '}版本控制 (Git 分支与提交)`,
            onClick: () => toggleSection('git'),
          },
          {
            key: 'toggle:runtime',
            label: `${visibility.runtime ? '✓ ' : '   '}来源与运行态感知`,
            onClick: () => toggleSection('runtime'),
          },
          {
            key: 'toggle:usage',
            label: `${visibility.usage ? '✓ ' : '   '}额度与上下文窗口`,
            onClick: () => toggleSection('usage'),
          },
        ],
      },
    ],
  };

  const editorMenu: MenuProps = {
    items: EDITOR_OPTIONS.map((opt) => ({
      key: opt.id,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          {opt.id === preferredEditor ? <CheckIcon size={13} /> : <span style={{ width: 13 }} />}
          <span>{opt.label}</span>
        </span>
      ),
      onClick: () => void handleOpenInEditor(opt.id),
    })),
  };

  const branchMenu: MenuProps = {
    items: [
      ...branches.map((b) => ({
        key: `branch:${b}`,
        label: (
          <span
            className="mono"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}
          >
            {b === branch ? <CheckIcon size={13} /> : <span style={{ width: 13 }} />}
            <span>{b}</span>
          </span>
        ),
        onClick: () => {
          if (b !== branch) void handleCheckoutBranch(b, false);
        },
      })),
      ...(branches.length > 0 ? [{ type: 'divider' as const }] : []),
      {
        key: 'new-branch',
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <PlusIcon size={13} />
            <span>新建并切换分支...</span>
          </span>
        ),
        onClick: () => setNewBranchModalOpen(true),
      },
    ],
  };

  const gitActionMenu: MenuProps = {
    items: [
      {
        key: 'commit',
        label: '快速提交全部变更 (Commit)...',
        disabled: gitEntries.length === 0,
        onClick: () => setCommitModalOpen(true),
      },
      {
        key: 'review',
        label: '在工作台中逐文件审查 (Review Diff)',
        onClick: () => jumpToSurface('diff'),
      },
      { type: 'divider' },
      {
        key: 'push',
        label: '推送到远端 (git push origin)',
        onClick: () => void handleGitRemoteOp('push'),
      },
      {
        key: 'pull',
        label: '拉取远端更新 (git pull --ff-only)',
        onClick: () => void handleGitRemoteOp('pull'),
      },
      {
        key: 'fetch',
        label: '同步远端引用 (git fetch)',
        onClick: () => void handleGitRemoteOp('fetch'),
      },
    ],
  };

  return (
    <>
      <Dropdown trigger={['contextMenu']} menu={cardMenu}>
        <div className="qibox-hud-card-body">
          {/* Section 1: Workspace & Environment (T3 Code BeeBox + Open in editor Split Button) */}
          {visibility.workspace && (
            <div className="qibox-hud-section">
              <div className="qibox-hud-split-row">
                <button
                  type="button"
                  className="qibox-hud-row-main"
                  onClick={() => jumpToSurface('files')}
                  title={`WSL2 工作区：${wslPath}`}
                >
                  <span className="qibox-hud-row-icon" style={{ position: 'relative' }}>
                    <MonitorIcon size={14.5} />
                    <span
                      className="qibox-hud-env-dot"
                      style={{ background: wslRunning ? '#10B981' : '#A1A1AA' }}
                    />
                  </span>
                  <span className="qibox-hud-row-label" style={{ fontWeight: 600, color: '#09090B' }}>
                    {currentProject?.name || 'WSL2 工作区'}
                  </span>
                </button>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, paddingRight: 2 }}>
                  <Tooltip title="在 Windows 资源管理器中打开目录">
                    <button
                      type="button"
                      className="qibox-hud-icon-action"
                      onClick={() => void handleOpenInEditor('explorer')}
                    >
                      <FolderIcon size={13.5} />
                    </button>
                  </Tooltip>
                  <Dropdown trigger={['click']} menu={cardMenu} placement="bottomRight">
                    <button
                      type="button"
                      className="qibox-hud-icon-action"
                      aria-label="卡片显示项与刷新"
                    >
                      <MoreHorizontalIcon size={14} />
                    </button>
                  </Dropdown>
                </div>
              </div>

              {projectId && (
                <div className="qibox-hud-split-row">
                  <button
                    type="button"
                    className="qibox-hud-row-main"
                    onClick={() => void handleOpenInEditor(preferredEditor)}
                  >
                    <span className="qibox-hud-row-icon">
                      <ExternalLinkIcon size={14} />
                    </span>
                    <span className="qibox-hud-row-label">{currentEditorOption.label}</span>
                  </button>
                  <Dropdown trigger={['click']} menu={editorMenu} placement="bottomRight">
                    <button
                      type="button"
                      className="qibox-hud-split-trigger"
                      aria-label="切换外部编辑器"
                    >
                      <ChevronDownIcon size={13} />
                    </button>
                  </Dropdown>
                </div>
              )}
            </div>
          )}

          {/* Section 2: Version Control (Branch Picker, Commit Split Action, Changes +X -Y) */}
          {visibility.git && projectId && (
            <div className="qibox-hud-section">
              {!gitError ? (
                <>
                  <Dropdown trigger={['click']} menu={branchMenu} placement="bottomLeft">
                    <button type="button" className="qibox-hud-row">
                      <span className="qibox-hud-row-left">
                        <span className="qibox-hud-row-icon">
                          <GitBranchIcon size={14} />
                        </span>
                        <span className="qibox-hud-row-label mono" style={{ fontSize: 12.5 }}>
                          {branch || 'main'}
                        </span>
                      </span>
                      <ChevronDownIcon size={13} style={{ color: '#71717A' }} />
                    </button>
                  </Dropdown>

                  <div className="qibox-hud-split-row">
                    <button
                      type="button"
                      className="qibox-hud-row-main"
                      onClick={() => {
                        if (gitEntries.length > 0) setCommitModalOpen(true);
                        else jumpToSurface('diff');
                      }}
                    >
                      <span className="qibox-hud-row-icon">
                        {gitActionBusy ? (
                          <RefreshCwIcon size={14} spin />
                        ) : (
                          <GitCommitIcon size={14} />
                        )}
                      </span>
                      <span className="qibox-hud-row-label">
                        {gitEntries.length > 0 ? '提交变更 (Commit)' : 'Git 同步与记录'}
                      </span>
                    </button>
                    <Dropdown trigger={['click']} menu={gitActionMenu} placement="bottomRight">
                      <button
                        type="button"
                        className="qibox-hud-split-trigger"
                        aria-label="更多 Git 操作"
                      >
                        <ChevronDownIcon size={13} />
                      </button>
                    </Dropdown>
                  </div>

                  <button
                    type="button"
                    className="qibox-hud-row"
                    onClick={() => jumpToSurface('diff')}
                  >
                    <span className="qibox-hud-row-left">
                      <span className="qibox-hud-row-icon">
                        <FileDiffIcon size={14} />
                      </span>
                      <span className="qibox-hud-row-label">代码变更</span>
                    </span>
                    {gitEntries.length > 0 ? (
                      <span
                        className="mono"
                        style={{
                          fontSize: 12,
                          fontVariantNumeric: 'tabular-nums',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontWeight: 500,
                        }}
                      >
                        {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) ? (
                          <>
                            <span style={{ color: '#16A34A' }}>+{diffStats.additions}</span>
                            <span style={{ color: '#DC2626' }}>-{diffStats.deletions}</span>
                          </>
                        ) : (
                          <span style={{ color: '#D97706' }}>{gitEntries.length} 文件</span>
                        )}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: '#A1A1AA' }}>干净</span>
                    )}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="qibox-hud-row"
                  onClick={async () => {
                    try {
                      await workspaceService.gitInit(projectId);
                      message.success('已初始化 Git 仓库');
                      await loadTelemetry();
                    } catch (e: any) {
                      message.error(e?.message || '初始化失败');
                    }
                  }}
                >
                  <span className="qibox-hud-row-left">
                    <span className="qibox-hud-row-icon">
                      <GitBranchIcon size={14} />
                    </span>
                    <span className="qibox-hud-row-label">初始化 Git 仓库 (git init)</span>
                  </span>
                  <PlusIcon size={13} style={{ color: '#71717A' }} />
                </button>
              )}
            </div>
          )}

          {/* Section 3: Context Sources & Live Runtime (Codex Sources + Antigravity Overview style) */}
          {visibility.runtime && projectId && (
            <div className="qibox-hud-section">
              <div className="qibox-hud-section-header">
                <span>来源与运行态</span>
                <Tooltip title="浏览并引用工作区文件">
                  <button
                    type="button"
                    className="qibox-hud-mini-plus"
                    onClick={() => jumpToSurface('files')}
                  >
                    <PlusIcon size={12} />
                  </button>
                </Tooltip>
              </div>

              {/* Recent referenced files or quick Files entry */}
              {referencedFiles.length > 0 ? (
                referencedFiles.slice(0, 3).map((relPath) => {
                  const base = relPath.split('/').pop() || relPath;
                  return (
                    <button
                      key={relPath}
                      type="button"
                      className="qibox-hud-row"
                      onClick={() => {
                        setDetailsPopoverOpen(false);
                        if (!openFile(relPath)) jumpToSurface('files');
                      }}
                      title={`预览引用文件：${relPath}`}
                    >
                      <span className="qibox-hud-row-left">
                        <span className="qibox-hud-row-icon">
                          <FileCodeIcon size={13.5} />
                        </span>
                        <span className="qibox-hud-row-label mono" style={{ fontSize: 12 }}>
                          {base}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: '#A1A1AA' }}>来源</span>
                    </button>
                  );
                })
              ) : null}

              <button
                type="button"
                className="qibox-hud-row"
                onClick={() => jumpToSurface('files')}
              >
                <span className="qibox-hud-row-left">
                  <span className="qibox-hud-row-icon">
                    {referencedFiles.length > 0 ? (
                      <PaperclipIcon size={13.5} />
                    ) : (
                      <FolderOpenIcon size={14} />
                    )}
                  </span>
                  <span className="qibox-hud-row-label">
                    {referencedFiles.length > 0 ? '查看全部工作区文件' : '文件浏览器 (Files)'}
                  </span>
                </span>
                <ChevronRightIcon size={13} style={{ color: '#A1A1AA' }} />
              </button>

              <button
                type="button"
                className="qibox-hud-row"
                onClick={() => jumpToSurface('terminal')}
              >
                <span className="qibox-hud-row-left">
                  <span className="qibox-hud-row-icon">
                    <TerminalSquareIcon size={14} />
                  </span>
                  <span className="qibox-hud-row-label">终端 (Terminal)</span>
                </span>
                {activeTerminalCount > 0 ? (
                  <span className="qibox-hud-live-pill">
                    <span className="qibox-hud-live-dot" />
                    {activeTerminalCount} 运行中
                  </span>
                ) : (
                  <ChevronRightIcon size={13} style={{ color: '#A1A1AA' }} />
                )}
              </button>

              <button
                type="button"
                className="qibox-hud-row"
                onClick={() => jumpToSurface('mcp')}
              >
                <span className="qibox-hud-row-left">
                  <span className="qibox-hud-row-icon">
                    <PlugIcon size={14} />
                  </span>
                  <span className="qibox-hud-row-label">MCP 扩展服务</span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {mcpCount > 0 && (
                    <span
                      className="mono"
                      style={{ fontSize: 11.5, color: '#71717A', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {mcpCount}
                    </span>
                  )}
                  <ChevronRightIcon size={13} style={{ color: '#A1A1AA' }} />
                </span>
              </button>
            </div>
          )}

          {/* Section 4: Quiet Usage & Context Subgrid (T3 Code ThreadDetailsUsage style) */}
          {visibility.usage && hasUsageBars && (
            <div className="qibox-hud-section qibox-hud-usage-grid">
              {five && (
                <UsageBarRow
                  label="5h 窗口"
                  percent={five.utilization}
                  tone={
                    five.utilization >= 90
                      ? 'danger'
                      : five.utilization >= 75
                        ? 'warning'
                        : 'normal'
                  }
                  valueText={`${Math.max(0, 100 - five.utilization)}% 剩余`}
                  tooltip={
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        5 小时速率窗口 · 已用 {five.utilization}%
                      </div>
                      {five.resetsAt && (
                        <div style={{ color: '#A1A1AA' }}>重置时间：{formatResetAt(five.resetsAt)}</div>
                      )}
                    </div>
                  }
                />
              )}
              {seven && (
                <UsageBarRow
                  label="7d 窗口"
                  percent={seven.utilization}
                  tone={
                    seven.utilization >= 90
                      ? 'danger'
                      : seven.utilization >= 75
                        ? 'warning'
                        : 'normal'
                  }
                  valueText={`${Math.max(0, 100 - seven.utilization)}% 剩余`}
                  tooltip={
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        7 天速率窗口 · 已用 {seven.utilization}%
                      </div>
                      {seven.resetsAt && (
                        <div style={{ color: '#A1A1AA' }}>重置时间：{formatResetAt(seven.resetsAt)}</div>
                      )}
                    </div>
                  }
                />
              )}
              {sessionUsage && (
                <UsageBarRow
                  label="上下文"
                  percent={contextPct}
                  showCompactTick
                  tone={
                    contextPct !== null && contextPct >= 90
                      ? 'danger'
                      : contextPct !== null && contextPct >= 75
                        ? 'warning'
                        : 'normal'
                  }
                  valueText={
                    contextPct !== null
                      ? `${contextPct}% 已用`
                      : formatTokens(sessionUsage.contextTokens)
                  }
                  tooltip={
                    <div style={{ minWidth: 185 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        上下文窗口 ({formatTokens(sessionUsage.contextTokens)} / {formatTokens(windowSize)})
                      </div>
                      <div style={{ color: '#D4D4D8' }}>
                        累计输入：{formatTokens(sessionUsage.inputTokens)} · 输出：
                        {formatTokens(sessionUsage.outputTokens)}
                      </div>
                      <div style={{ color: '#A1A1AA' }}>
                        缓存命中：{formatTokens(sessionUsage.cacheReadTokens)}
                      </div>
                      {contextPct !== null && contextPct >= 65 && !isBusy && (
                        <button
                          type="button"
                          onClick={() => setDraft('/compact ')}
                          style={{
                            marginTop: 6,
                            width: '100%',
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.16)',
                            background: 'rgba(255,255,255,0.08)',
                            color: '#FBBF24',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          填入 /compact 压缩上下文
                        </button>
                      )}
                    </div>
                  }
                />
              )}
            </div>
          )}
        </div>
      </Dropdown>

      {/* 快速提交变更弹窗 */}
      <Modal
        title={`快速提交变更 (${gitEntries.length} 个文件)`}
        open={commitModalOpen}
        onCancel={() => setCommitModalOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setCommitModalOpen(false);
                jumpToSurface('diff');
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#52525B',
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              在工作台中逐文件审查 ›
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={committing}
                onClick={() => void handleQuickCommit(false)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid #E4E4E7',
                  background: '#18181B',
                  color: '#FFFFFF',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {committing ? '提交中...' : '提交 (Commit)'}
              </button>
              <button
                type="button"
                disabled={committing}
                onClick={() => void handleQuickCommit(true)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid #2563EB',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                提交并推送 (Commit & Push)
              </button>
            </div>
          </div>
        }
        width={420}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
          <div style={{ fontSize: 12, color: '#71717A' }}>
            将自动暂存当前工作区全部 <strong>{gitEntries.length}</strong> 个变更文件并创建 Git Commit：
          </div>
          <Input.TextArea
            rows={3}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="输入 Commit Message（例如：feat: 优化右侧工作台交互）"
            autoFocus
            onPressEnter={(e) => {
              if ((e.metaKey || e.ctrlKey) && !committing) {
                e.preventDefault();
                void handleQuickCommit(false);
              }
            }}
          />
        </div>
      </Modal>

      {/* 新建并切换分支弹窗 */}
      <Modal
        title="新建并切换 Git 分支"
        open={newBranchModalOpen}
        onCancel={() => setNewBranchModalOpen(false)}
        onOk={() => void handleCheckoutBranch(newBranchName, true)}
        okText="创建并切换"
        cancelText="取消"
        confirmLoading={gitActionBusy === 'checkout'}
        width={380}
        destroyOnHidden
      >
        <div style={{ paddingTop: 8 }}>
          <Input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="例如：feat/right-panel-v2"
            className="mono"
            autoFocus
            onPressEnter={() => void handleCheckoutBranch(newBranchName, true)}
          />
        </div>
      </Modal>
    </>
  );
};

export const ThreadDetailsFloatingCard: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <aside aria-label="会话详情概览" className="qibox-hud-floating-card">
      <ThreadDetailsBody inline />
    </aside>
  );
};

export const ThreadDetailsPopoverButton: React.FC<{
  inlineCapable: boolean;
  inlineOpen: boolean;
  trigger: React.ReactNode;
}> = ({ inlineCapable, inlineOpen, trigger }) => {
  const { detailsPopoverOpen, setDetailsPopoverOpen } = useRightPanel();

  if (inlineCapable) {
    return <>{trigger}</>;
  }

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={detailsPopoverOpen}
      onOpenChange={setDetailsPopoverOpen}
      styles={{ content: { padding: 0, borderRadius: 16, overflow: 'hidden' } }}
      content={
        <div style={{ width: THREAD_DETAILS_CARD_WIDTH }}>
          <ThreadDetailsBody compact />
        </div>
      }
    >
      <span data-details-active={inlineOpen}>{trigger}</span>
    </Popover>
  );
};

export default ThreadDetailsFloatingCard;
