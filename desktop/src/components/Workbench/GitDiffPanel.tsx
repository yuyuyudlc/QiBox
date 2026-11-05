import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown, Empty, Input, Modal, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import { workspaceService } from '../../services/workspace';
import { useAgent } from '../../contexts/AgentContext';
import type { GitStatusEntry } from '../../services/types';
import DiffViewer from '../Common/DiffViewer';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitIcon,
  PaperclipIcon,
  RefreshCwIcon,
} from './WorkbenchIcons';

interface GitDiffPanelProps {
  projectId: string;
  requestedFile?: string;
  onMentionFile?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}

interface FileDiffStats {
  additions: number;
  deletions: number;
  diffText: string;
}

const STATUS_BADGE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  M: { bg: '#FEF3C7', color: '#B45309', label: 'M' },
  A: { bg: '#DCFCE7', color: '#15803D', label: 'A' },
  D: { bg: '#FEE2E2', color: '#DC2626', label: 'D' },
  R: { bg: '#DBEAFE', color: '#1D4ED8', label: 'R' },
  '??': { bg: '#F4F4F5', color: '#52525B', label: 'U' },
};

function getStatusBadge(status: string) {
  const s = status.trim();
  return STATUS_BADGE_STYLE[s] || STATUS_BADGE_STYLE[s[0]] || STATUS_BADGE_STYLE['M'];
}

function parseEntryState(status: string) {
  const isUntracked = status === '??';
  const indexChar = status[0] ?? ' ';
  const worktreeChar = status[1] ?? ' ';
  return {
    isUntracked,
    isStaged: !isUntracked && indexChar !== ' ' && indexChar !== '?',
    hasUnstaged: isUntracked || (worktreeChar !== ' ' && worktreeChar !== undefined),
  };
}

function splitMultiFileDiff(rawDiff: string): Record<string, FileDiffStats> {
  const map: Record<string, FileDiffStats> = {};
  if (!rawDiff.trim()) return map;

  const chunks = rawDiff.split(/(?=^diff --git )/m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const headerMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const filePath = headerMatch ? headerMatch[2].trim() : '';
    if (!filePath) continue;

    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    if (map[filePath]) {
      map[filePath] = {
        additions: map[filePath].additions + additions,
        deletions: map[filePath].deletions + deletions,
        diffText: `${map[filePath].diffText}\n${chunk.trim()}`,
      };
    } else {
      map[filePath] = { additions, deletions, diffText: chunk.trim() };
    }
  }
  return map;
}

export const GitDiffPanel: React.FC<GitDiffPanelProps> = ({
  projectId,
  requestedFile,
  onMentionFile,
  onOpenFile,
}) => {
  const { isBusy } = useAgent();
  const [branch, setBranch] = useState('');
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [diffByFile, setDiffByFile] = useState<Record<string, FileDiffStats>>({});
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState('');

  const fileCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevBusyRef = useRef(isBusy);

  const loadAllDiffs = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const res = await workspaceService.gitStatus(projectId);
      setBranch(res.branch);
      setEntries(res.entries);

      if (res.entries.length === 0) {
        setDiffByFile({});
        return;
      }

      const [unstagedRes, stagedRes] = await Promise.all([
        workspaceService.gitDiff(projectId, undefined, false).catch(() => ({ text: '' })),
        workspaceService.gitDiff(projectId, undefined, true).catch(() => ({ text: '' })),
      ]);

      const combined = [unstagedRes.text, stagedRes.text].filter(Boolean).join('\n');
      const parsedMap = splitMultiFileDiff(combined);

      // Load untracked files preview (up to first 8 untracked files to keep RPC fast)
      const untracked = res.entries.filter((e) => e.status === '??').slice(0, 8);
      await Promise.allSettled(
        untracked.map(async (entry) => {
          if (parsedMap[entry.path]) return;
          const fileRes = await workspaceService.readFile(projectId, entry.path);
          const rawLines = fileRes.text.split('\n');
          const diffLines = rawLines.map((l) => `+${l}`).join('\n');
          parsedMap[entry.path] = {
            additions: rawLines.length,
            deletions: 0,
            diffText: `@@ -0,0 +1,${rawLines.length} @@\n${diffLines}`,
          };
        }),
      );

      setDiffByFile(parsedMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
      setDiffByFile({});
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadAllDiffs();
  }, [loadAllDiffs]);

  useEffect(() => {
    if (prevBusyRef.current && !isBusy) {
      void loadAllDiffs();
    }
    prevBusyRef.current = isBusy;
  }, [isBusy, loadAllDiffs]);

  useEffect(() => {
    if (requestedFile && entries.some((e) => e.path === requestedFile)) {
      setCollapsedMap((prev) => ({ ...prev, [requestedFile]: false }));
      const el = fileCardRefs.current[requestedFile];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [requestedFile, entries]);

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const v of Object.values(diffByFile)) {
      additions += v.additions;
      deletions += v.deletions;
    }
    return { additions, deletions };
  }, [diffByFile]);

  const { stagedPaths, unstagedPaths } = useMemo(() => {
    const staged: string[] = [];
    const unstaged: string[] = [];
    for (const entry of entries) {
      const state = parseEntryState(entry.status);
      if (state.isStaged) staged.push(entry.path);
      if (state.hasUnstaged) unstaged.push(entry.path);
    }
    return { stagedPaths: staged, unstagedPaths: unstaged };
  }, [entries]);

  const allCollapsed = useMemo(
    () => entries.length > 0 && entries.every((e) => collapsedMap[e.path]),
    [entries, collapsedMap],
  );

  const handleToggleAllCollapse = () => {
    const nextState = !allCollapsed;
    const next: Record<string, boolean> = {};
    for (const e of entries) {
      next[e.path] = nextState;
    }
    setCollapsedMap(next);
  };

  const handleStageToggle = async (entry: GitStatusEntry) => {
    if (!projectId) return;
    const state = parseEntryState(entry.status);
    setGitBusy(true);
    try {
      if (state.isStaged && !state.hasUnstaged) {
        await workspaceService.gitUnstage(projectId, [entry.path]);
      } else {
        await workspaceService.gitStage(projectId, [entry.path]);
      }
      await loadAllDiffs();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setGitBusy(false);
    }
  };

  const handleCommit = async (andPush = false) => {
    const msg = commitMessage.trim();
    if (!projectId || !msg) {
      message.warning('请输入提交说明');
      return;
    }
    setGitBusy(true);
    try {
      if (stagedPaths.length === 0 && unstagedPaths.length > 0) {
        await workspaceService.gitStage(projectId, unstagedPaths);
      }
      await workspaceService.gitCommit(projectId, msg);
      if (andPush) {
        await workspaceService.gitPush(projectId, 'origin');
        message.success('已提交并推送到 origin');
      } else {
        message.success('已提交代码变更');
      }
      setCommitMessage('');
      setCommitModalOpen(false);
      await loadAllDiffs();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '提交失败');
    } finally {
      setGitBusy(false);
    }
  };

  const fileJumpMenu: MenuProps = {
    items: entries.map((e) => {
      const fStats = diffByFile[e.path];
      return {
        key: e.path,
        label: (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              minWidth: 220,
              fontSize: 12,
            }}
          >
            <span
              className="mono"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {e.path}
            </span>
            {fStats && (
              <span className="mono" style={{ fontSize: 11, flexShrink: 0 }}>
                <span style={{ color: '#16A34A' }}>+{fStats.additions}</span>{' '}
                <span style={{ color: '#DC2626' }}>-{fStats.deletions}</span>
              </span>
            )}
          </div>
        ),
        onClick: () => {
          setCollapsedMap((prev) => ({ ...prev, [e.path]: false }));
          fileCardRefs.current[e.path]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      };
    }),
  };

  return (
    <div className="qibox-surface-container">
      {/* Sticky Sub-Toolbar (T3 Code DiffPanel Header) */}
      <div className="qibox-surface-toolbar">
        <div className="qibox-surface-toolbar-left">
          <span className="qibox-branch-pill mono">
            <GitBranchIcon size={12.5} />
            <span>{branch || 'HEAD'}</span>
          </span>
          {entries.length > 0 && (
            <Dropdown trigger={['click']} menu={fileJumpMenu} placement="bottomLeft">
              <button type="button" className="qibox-toolbar-ghost-btn">
                <span>{entries.length} 个文件</span>
                {(totalStats.additions > 0 || totalStats.deletions > 0) && (
                  <span className="mono" style={{ fontSize: 11.5, display: 'inline-flex', gap: 4 }}>
                    <span style={{ color: '#16A34A' }}>+{totalStats.additions}</span>
                    <span style={{ color: '#DC2626' }}>-{totalStats.deletions}</span>
                  </span>
                )}
                <ChevronDownIcon size={12} />
              </button>
            </Dropdown>
          )}
        </div>

        <div className="qibox-surface-toolbar-right">
          {entries.length > 0 && (
            <Tooltip title={allCollapsed ? '展开全部文件 Diff' : '折叠全部文件 Diff'}>
              <button
                type="button"
                className="qibox-workbench-icon-btn"
                onClick={handleToggleAllCollapse}
              >
                <ChevronsUpDownIcon size={13.5} />
              </button>
            </Tooltip>
          )}
          <Tooltip title="刷新 Git 状态">
            <button
              type="button"
              className="qibox-workbench-icon-btn"
              onClick={() => void loadAllDiffs()}
            >
              <RefreshCwIcon size={13.5} spin={loading} />
            </button>
          </Tooltip>
          {entries.length > 0 && (
            <button
              type="button"
              className="qibox-toolbar-primary-btn"
              onClick={() => setCommitModalOpen(true)}
            >
              <GitCommitIcon size={13} />
              <span>提交 ({stagedPaths.length > 0 ? stagedPaths.length : entries.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Stacked Diff Stream */}
      <div className="qibox-diff-stream">
        {error ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#71717A', fontSize: 12.5 }}>
            {error === 'NOT_A_GIT_REPOSITORY' || error === 'GIT_OPERATION_FAILED' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <span>当前项目目录尚未初始化 Git 仓库</span>
                <button
                  type="button"
                  className="qibox-toolbar-primary-btn"
                  onClick={async () => {
                    try {
                      await workspaceService.gitInit(projectId);
                      message.success('已初始化 Git 仓库');
                      await loadAllDiffs();
                    } catch (e: any) {
                      message.error(e?.message || '初始化失败');
                    }
                  }}
                >
                  初始化 Git 仓库 (git init)
                </button>
              </div>
            ) : (
              error
            )}
          </div>
        ) : entries.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="工作区干净，暂无未提交变更" />
          </div>
        ) : (
          entries.map((entry) => {
            const collapsed = Boolean(collapsedMap[entry.path]);
            const badge = getStatusBadge(entry.status);
            const state = parseEntryState(entry.status);
            const fStats = diffByFile[entry.path];
            const parts = entry.path.split('/');
            const fileName = parts.pop() || entry.path;
            const dirPrefix = parts.length > 0 ? `${parts.join('/')}/` : '';

            return (
              <div
                key={entry.path}
                ref={(el) => {
                  fileCardRefs.current[entry.path] = el;
                }}
                className="qibox-diff-file-card"
              >
                <div
                  className="qibox-diff-file-header"
                  onClick={() =>
                    setCollapsedMap((prev) => ({ ...prev, [entry.path]: !prev[entry.path] }))
                  }
                >
                  <div className="qibox-diff-file-title">
                    <span style={{ color: '#71717A', display: 'inline-flex' }}>
                      {collapsed ? <ChevronRightIcon size={13.5} /> : <ChevronDownIcon size={13.5} />}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: badge.bg,
                        color: badge.color,
                        flexShrink: 0,
                      }}
                    >
                      {badge.label}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.path}
                    >
                      {dirPrefix && <span style={{ color: '#71717A' }}>{dirPrefix}</span>}
                      <span style={{ fontWeight: 600, color: '#09090B' }}>{fileName}</span>
                    </span>
                  </div>

                  <div
                    className="qibox-diff-file-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {fStats && (fStats.additions > 0 || fStats.deletions > 0) && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontVariantNumeric: 'tabular-nums',
                          display: 'inline-flex',
                          gap: 4,
                          marginRight: 4,
                        }}
                      >
                        <span style={{ color: '#16A34A' }}>+{fStats.additions}</span>
                        <span style={{ color: '#DC2626' }}>-{fStats.deletions}</span>
                      </span>
                    )}

                    <Tooltip title={state.isStaged ? '已暂存（点击取消暂存）' : '点击暂存此文件'}>
                      <button
                        type="button"
                        disabled={gitBusy}
                        onClick={() => void handleStageToggle(entry)}
                        className={`qibox-stage-pill ${state.isStaged ? 'is-staged' : ''}`}
                      >
                        {state.isStaged && <CheckIcon size={11} />}
                        <span>{state.isStaged ? '已暂存' : '暂存'}</span>
                      </button>
                    </Tooltip>

                    {onOpenFile && (
                      <Tooltip title="打开完整源文件">
                        <button
                          type="button"
                          className="qibox-workbench-icon-btn"
                          onClick={() => onOpenFile(entry.path)}
                        >
                          <ExternalLinkIcon size={12.5} />
                        </button>
                      </Tooltip>
                    )}

                    {onMentionFile && (
                      <Tooltip title="引用此文件到对话 (@)">
                        <button
                          type="button"
                          className="qibox-workbench-icon-btn"
                          onClick={() => onMentionFile(entry.path)}
                        >
                          <PaperclipIcon size={12.5} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {!collapsed && (
                  <div className="qibox-diff-file-body">
                    <DiffViewer
                      diffText={fStats?.diffText || ''}
                      maxHeight={420}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Commit Modal */}
      <Modal
        title={`提交代码变更 (${stagedPaths.length > 0 ? `已暂存 ${stagedPaths.length} 个文件` : `将自动暂存全部 ${entries.length} 个文件`})`}
        open={commitModalOpen}
        onCancel={() => setCommitModalOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {unstagedPaths.length > 0 && (
                <button
                  type="button"
                  disabled={gitBusy}
                  className="qibox-toolbar-ghost-btn"
                  onClick={async () => {
                    await workspaceService.gitStage(projectId, unstagedPaths);
                    await loadAllDiffs();
                  }}
                >
                  全部暂存 ({unstagedPaths.length})
                </button>
              )}
              {stagedPaths.length > 0 && (
                <button
                  type="button"
                  disabled={gitBusy}
                  className="qibox-toolbar-ghost-btn"
                  onClick={async () => {
                    await workspaceService.gitUnstage(projectId, stagedPaths);
                    await loadAllDiffs();
                  }}
                >
                  全部取消暂存
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={gitBusy || !commitMessage.trim()}
                className="qibox-toolbar-primary-btn"
                onClick={() => void handleCommit(false)}
              >
                {gitBusy ? '提交中...' : '提交 (Commit)'}
              </button>
              <button
                type="button"
                disabled={gitBusy || !commitMessage.trim()}
                className="qibox-toolbar-primary-btn"
                style={{ background: '#2563EB', borderColor: '#2563EB' }}
                onClick={() => void handleCommit(true)}
              >
                提交并推送 (Push)
              </button>
            </div>
          </div>
        }
        width={420}
        destroyOnHidden
      >
        <div style={{ paddingTop: 8 }}>
          <Input.TextArea
            rows={3}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="输入提交信息 (Ctrl/Cmd + Enter 立即提交)..."
            autoFocus
            onPressEnter={(e) => {
              if ((e.metaKey || e.ctrlKey) && commitMessage.trim() && !gitBusy) {
                e.preventDefault();
                void handleCommit(false);
              }
            }}
          />
        </div>
      </Modal>
    </div>
  );
};

export default GitDiffPanel;
