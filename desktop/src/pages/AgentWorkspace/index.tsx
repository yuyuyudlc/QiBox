import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bubble } from '@ant-design/x';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Modal,
  Space,
  Splitter,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  LoadingOutlined,
  SlidersOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import {
  MoreHorizontalIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SquareMenuIcon,
  TerminalSquareIcon,
} from '../../components/Workbench/WorkbenchIcons';
import { useAgent } from '../../contexts/AgentContext';
import { useRightPanel } from '../../contexts/RightPanelContext';
import { workspaceService } from '../../services/workspace';
import BilingualBubble from '../../components/Chat/BilingualBubble';
import ApprovalCard from '../../components/Chat/ApprovalCard';
import ChatComposer from '../../components/Chat/ChatComposer';
import RichMarkdown from '../../components/Chat/RichMarkdown';
import ThreadDetailsFloatingCard, {
  THREAD_DETAILS_CARD_WIDTH,
  ThreadDetailsPopoverButton,
} from '../../components/Chat/ThreadDetailsCard';
import WorkspaceSidebar from '../../components/Layout/WorkspaceSidebar';
import ProjectModal from '../../components/Layout/ProjectModal';
import RightWorkbenchPanel from '../../components/Workbench/RightWorkbenchPanel';
import SessionSettings from '../../components/Chat/SessionSettings';
import { type Session } from '../../services/types';

export const AgentWorkspacePage: React.FC = () => {
  const {
    projects,
    projectId,
    currentProject,
    combinedSessions,
    selectedSessionId,
    activeSession,
    conversation,
    draft,
    setDraft,
    searchQuery,
    setSearchQuery,
    connected,
    loading,
    creating,
    paging,
    error,
    clearError,
    pendingApprovals,
    streamMap,
    isBusy,
    showTools,
    showChinese,
    refreshAgent,
    selectProject,
    createProject,
    selectSession,
    createSession,
    deleteSession,
    loadOlderMessages,
    retryMessageTranslation,
    respondToApproval,
  } = useAgent();

  const {
    panelState,
    detailsPopoverOpen,
    toggleDetails,
    toggleRightPanel,
    openSurface,
    openDiffProactive,
  } = useRightPanel();

  const navigate = useNavigate();
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSize, setSidebarSize] = useState(252);
  const [workspaceWidth, setWorkspaceWidth] = useState(1120);
  const workspaceRowRef = useRef<HTMLDivElement>(null);
  const chatColRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const prevBusyRef = useRef(isBusy);
  const preTurnGitSigRef = useRef<string | null>(null);

  const [projectModalOpen, setProjectModalOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredSessions = useMemo(
    () => combinedSessions.filter((s) => `${s.title} ${s.id}`.toLowerCase().includes(searchQuery.toLowerCase())),
    [combinedSessions, searchQuery],
  );

  const scrollToBottom = (smooth = false) => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    followRef.current = true;
    setShowScrollBottom(false);
  };

  useEffect(() => {
    if (followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation, streamMap, selectedSessionId, pendingApprovals]);

  // 实时观测聊天与右侧工作台共享的行容器宽度，用于响应式切换 Drawer / 内联分屏 / 悬浮概览卡
  useEffect(() => {
    const el = workspaceRowRef.current;
    if (!el) return;
    const measure = () => setWorkspaceWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sidebarWidth = sidebarCollapsed ? 0 : sidebarSize;
  const canAutoWidenInline =
    typeof window !== 'undefined' && (window.screen?.availWidth ?? 1920) >= 1060;
  const useSheet = workspaceWidth > 0 && workspaceWidth < 900;
  const isMaximized = !useSheet && panelState.isOpen && panelState.maximized;
  const inlineDetailsCapable =
    !panelState.isOpen && (workspaceWidth >= 780 || canAutoWidenInline);
  const showInlineDetails =
    !panelState.isOpen &&
    workspaceWidth >= 780 &&
    panelState.detailsInlineOpen &&
    Boolean(selectedSessionId || projectId);
  const detailsControlActive = panelState.isOpen ? detailsPopoverOpen : showInlineDetails;

  // 若开启了内联悬浮概览卡，精确计算需要为居中对话流留出的右侧避让边距，避免卡片遮挡消息内容
  const cardFootprint = THREAD_DETAILS_CARD_WIDTH + 38;
  const idealReserve = Math.round(780 + cardFootprint * 2 - workspaceWidth);
  const chatRightReserve = showInlineDetails ? Math.max(0, Math.min(cardFootprint - 24, idealReserve)) : 0;

  // 打开右侧浮卡或右侧工作台时，若当前窗口宽度不足，自动向右扩展桌面窗口而不是挤压左侧聊天与边栏
  const autoWindowRef = useRef<{ baseWidth: number; lastTargetWidth: number } | null>(null);
  const prevPanelNeedRef = useRef<{ panel: boolean; details: boolean } | null>(null);
  const resizeSeqRef = useRef(0);

  const panelNeedsSpace = panelState.isOpen && !panelState.maximized;
  const detailsNeedsSpace =
    !panelState.isOpen && panelState.detailsInlineOpen && Boolean(selectedSessionId || projectId);

  useEffect(() => {
    const prev = prevPanelNeedRef.current;
    prevPanelNeedRef.current = { panel: panelNeedsSpace, details: detailsNeedsSpace };

    const desiredInnerWidth = panelNeedsSpace
      ? Math.round(sidebarWidth + 836 + panelState.width)
      : detailsNeedsSpace
        ? Math.round(sidebarWidth + 780 + 200 + THREAD_DETAILS_CARD_WIDTH)
        : null;

    const seq = ++resizeSeqRef.current;

    const isOpeningPanel = prev === null ? panelNeedsSpace : !prev.panel && panelNeedsSpace;
    const isOpeningDetails =
      prev === null
        ? detailsNeedsSpace && !panelNeedsSpace
        : !prev.panel && !panelNeedsSpace && !prev.details && detailsNeedsSpace;
    const closedSomething =
      prev !== null &&
      ((prev.panel && !panelNeedsSpace) || (prev.details && !detailsNeedsSpace));

    const run = async () => {
      try {
        if (desiredInnerWidth !== null && (isOpeningPanel || isOpeningDetails)) {
          const res = await workspaceService.ensureWindowWidth(desiredInnerWidth, false);
          if (seq !== resizeSeqRef.current) return;
          if (res.resized && res.previousInnerWidth && res.innerWidth) {
            if (!autoWindowRef.current) {
              autoWindowRef.current = {
                baseWidth: res.previousInnerWidth,
                lastTargetWidth: res.innerWidth,
              };
            } else {
              autoWindowRef.current.lastTargetWidth = res.innerWidth;
            }
          }
          return;
        }

        if (closedSomething && autoWindowRef.current) {
          const tracked = autoWindowRef.current;
          if (Math.abs(window.innerWidth - tracked.lastTargetWidth) > 36) {
            autoWindowRef.current = null;
            return;
          }
          const restoreTarget = desiredInnerWidth ?? tracked.baseWidth;
          const res = await workspaceService.ensureWindowWidth(restoreTarget, true);
          if (seq !== resizeSeqRef.current) return;
          if (desiredInnerWidth === null) {
            autoWindowRef.current = null;
          } else if (res.innerWidth) {
            autoWindowRef.current.lastTargetWidth = res.innerWidth;
          }
        }
      } catch {
        // 非 Tauri 环境或浏览器预览模式忽略窗口缩放
      }
    };

    void run();
    // 仅在右侧浮卡/面板的开关状态变化时同步窗口尺寸，避免拖拽边栏或面板分隔线时干扰用户
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelNeedsSpace, detailsNeedsSpace]);

  useEffect(() => {
    const el = chatColRef.current;
    if (!el) return;
    el.toggleAttribute('inert', isMaximized);
  }, [isMaximized]);

  // 回合产生实际 Git 文件改动且本轮用户未手动操作工作台时，主动展开代码变更 Tab
  useEffect(() => {
    let cancelled = false;
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = isBusy;
    if (!projectId) {
      preTurnGitSigRef.current = null;
      return;
    }
    if (!wasBusy && isBusy) {
      void workspaceService
        .gitStatus(projectId)
        .then((res) => {
          if (!cancelled) {
            preTurnGitSigRef.current = res.entries.map((e) => `${e.status}:${e.path}`).join('|');
          }
        })
        .catch(() => {
          if (!cancelled) preTurnGitSigRef.current = null;
        });
    } else if (wasBusy && !isBusy && preTurnGitSigRef.current !== null) {
      const beforeSig = preTurnGitSigRef.current;
      preTurnGitSigRef.current = null;
      void workspaceService
        .gitStatus(projectId)
        .then((res) => {
          if (cancelled || res.entries.length === 0) return;
          const afterSig = res.entries.map((e) => `${e.status}:${e.path}`).join('|');
          if (afterSig !== beforeSig) openDiffProactive();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [isBusy, projectId, openDiffProactive]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteSession(deleteTarget.id);
    } catch {
      // 错误已在 Context 设置
    } finally {
      setDeleteTarget(null);
      setDeleting(false);
    }
  };

  const currentTitle =
    activeSession?.title ||
    combinedSessions.find((s) => s.id === selectedSessionId)?.title ||
    '新对话';
  const currentStreamText = streamMap[selectedSessionId] || '';

  return (
    <section
      className="agent-chat"
      aria-label="Claude Code 对话工作区"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        height: '100%',
        background: '#FFFFFF',
        overflow: 'hidden',
      }}
    >
      <Modal
        title="删除对话？"
        open={Boolean(deleteTarget)}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onOk={() => void handleConfirmDelete()}
        okText={deleting ? '正在删除…' : '确认删除'}
        cancelText="取消"
        okButtonProps={{ danger: true, loading: deleting }}
      >
        <div
          style={{
            padding: '10px 12px',
            background: '#FAFAFA',
            border: '1px solid #E4E4E7',
            borderRadius: 6,
            fontWeight: 600,
            color: '#09090B',
            marginBottom: 10,
          }}
        >
          {deleteTarget?.title}
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
          将删除这段对话的原文历史、本机中文输入记录和译文，删除后不可恢复。WSL2 内的项目文件会保留。
        </Typography.Paragraph>
      </Modal>

      <ProjectModal
        open={projectModalOpen}
        projects={projects}
        currentProjectId={projectId}
        onClose={() => setProjectModalOpen(false)}
        onSelectAndStart={async (pid) => {
          selectProject(pid);
          await createSession(pid);
        }}
        onCreateProject={async (name, dir, startSession) => {
          const project = await createProject(name, dir);
          if (startSession) await createSession(project.id);
        }}
      />

      <Drawer title="会话设置" open={sessionSettingsOpen} onClose={() => setSessionSettingsOpen(false)} destroyOnHidden>
        <SessionSettings />
      </Drawer>

      <Splitter
        style={{ flex: 1, minHeight: 0, height: '100%' }}
        onResize={(sizes) => {
          if (!sidebarCollapsed && typeof sizes[0] === 'number' && sizes[0] >= 180) {
            setSidebarSize(sizes[0]);
          }
        }}
      >
        <Splitter.Panel
          size={sidebarCollapsed ? 0 : sidebarSize}
          min={sidebarCollapsed ? 0 : 200}
          max={sidebarCollapsed ? 0 : 380}
          resizable={!sidebarCollapsed}
        >
          <WorkspaceSidebar
            projects={projects}
            projectId={projectId}
            currentProject={currentProject}
            sessions={filteredSessions}
            selectedSessionId={selectedSessionId}
            searchQuery={searchQuery}
            connected={connected}
            creating={creating}
            deleting={deleting}
            onSearchChange={setSearchQuery}
            onSelectProject={selectProject}
            onOpenNewProject={() => setProjectModalOpen(true)}
            onCreateSession={() => void createSession()}
            onSelectSession={(key) => void selectSession(key)}
            onRequestDeleteSession={setDeleteTarget}
            onOpenSettings={() => navigate('/settings/chat')}
          />
        </Splitter.Panel>

        <Splitter.Panel min="40%">
          {/* 右侧主区域 */}
          <Flex vertical className="history-conversation" style={{ height: '100%', minHeight: 0, minWidth: 0, background: '#FFFFFF' }}>
        {/* 顶栏：左侧项目/会话面包屑，右侧 T3 Code / Antigravity 风格面板控制簇 */}
        <Flex
          justify="space-between"
          align="center"
          gap={16}
          className="conversation-heading"
          style={{
            height: 44,
            padding: '0 14px',
            borderBottom: '1px solid #E4E4E7',
            background: '#FFFFFF',
            flexShrink: 0,
          }}
        >
          <Flex align="center" gap={8} style={{ minWidth: 0, flex: 1 }}>
            <Tooltip title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}>
              <button
                type="button"
                aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
                className={`qibox-header-control-btn ${sidebarCollapsed ? '' : 'is-subtle'}`}
                onClick={() => setSidebarCollapsed((v) => !v)}
              >
                <PanelLeftIcon size={15} />
              </button>
            </Tooltip>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {currentProject && (
                <>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#71717A',
                      flexShrink: 0,
                    }}
                  >
                    {currentProject.name}
                  </span>
                  <span style={{ color: '#D4D4D8', fontSize: 13, flexShrink: 0 }}>/</span>
                </>
              )}
              <strong
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#09090B',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentTitle}
              </strong>
            </div>
          </Flex>

          {/* 右上角统一面板控制簇（对标 T3 Code PanelLayoutControls & Google Antigravity） */}
          <div className="qibox-header-control-cluster">
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'settings',
                    label: '会话与模型权限设置',
                    icon: <SlidersOutlined aria-hidden="true" />,
                  },
                  {
                    key: 'refresh',
                    label: '同步刷新当前会话',
                    icon: <ReloadOutlined aria-hidden="true" spin={loading} />,
                    disabled: loading,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'settings') {
                    setSessionSettingsOpen(true);
                  } else {
                    void refreshAgent();
                  }
                },
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <button
                type="button"
                className="qibox-header-control-btn"
                aria-label="会话选项"
                title="会话设置与刷新"
              >
                <MoreHorizontalIcon size={15} />
              </button>
            </Dropdown>

            {(selectedSessionId || projectId) && (
              <ThreadDetailsPopoverButton
                inlineCapable={inlineDetailsCapable}
                inlineOpen={showInlineDetails}
                trigger={
                  <Tooltip title={detailsControlActive ? '隐藏概览卡片 (Overview)' : '显示概览卡片 (Overview)'}>
                    <button
                      type="button"
                      className={`qibox-header-control-btn ${detailsControlActive ? 'is-active' : ''}`}
                      aria-label="会话详情概览"
                      onClick={
                        inlineDetailsCapable
                          ? () => {
                              if (workspaceWidth < 780 && panelState.detailsInlineOpen) {
                                void workspaceService
                                  .ensureWindowWidth(
                                    Math.round(sidebarWidth + 780 + 200 + THREAD_DETAILS_CARD_WIDTH),
                                    false,
                                  )
                                  .catch(() => {});
                                return;
                              }
                              toggleDetails(true);
                            }
                          : undefined
                      }
                    >
                      <SquareMenuIcon size={15} />
                    </button>
                  </Tooltip>
                }
              />
            )}

            {projectId && (
              <Tooltip title="打开 / 聚焦 WSL2 终端">
                <button
                  type="button"
                  className={`qibox-header-control-btn ${
                    panelState.isOpen && panelState.activeSurfaceId === 'terminal' ? 'is-active' : ''
                  }`}
                  aria-label="打开终端标签"
                  onClick={() => openSurface('terminal')}
                >
                  <TerminalSquareIcon size={15} />
                </button>
              </Tooltip>
            )}

            <Tooltip title={panelState.isOpen ? '收起右侧工作台' : '展开右侧工作台'}>
              <button
                type="button"
                data-right-panel-toggle
                className={`qibox-header-control-btn ${panelState.isOpen ? 'is-active' : ''}`}
                aria-label={panelState.isOpen ? '收起右侧工作台' : '展开右侧工作台'}
                onClick={toggleRightPanel}
              >
                <PanelRightIcon size={15} filled={panelState.isOpen} />
              </button>
            </Tooltip>
          </div>
        </Flex>

        {error && (
          <Alert
            type="error"
            role="alert"
            showIcon
            closable
            onClose={clearError}
            message={error}
            style={{ margin: '10px 20px 0' }}
          />
        )}

        <div
          ref={workspaceRowRef}
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            ref={chatColRef}
            className="chat-pane"
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: isMaximized ? 'none' : 1,
              width: isMaximized ? 0 : undefined,
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              position: 'relative',
              background: '#FFFFFF',
              overflow: isMaximized ? 'hidden' : undefined,
            }}
          >
            <ThreadDetailsFloatingCard visible={showInlineDetails} />

            <div
              className="chat-scroll"
              ref={scrollRef}
              aria-live="polite"
              onScroll={() => {
                const el = scrollRef.current;
                if (el) {
                  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                  followRef.current = nearBottom;
                  setShowScrollBottom(!nearBottom);
                }
              }}
              style={{
                flex: 1,
                overflow: 'auto',
                paddingTop: 24,
                paddingBottom: 24,
                paddingLeft: 24,
                paddingRight: 24 + chatRightReserve,
                minHeight: 0,
                transition: 'padding-right 0.2s ease',
              }}
            >
            <div style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>
              {conversation?.nextBefore != null && (
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <Button size="small" shape="round" loading={paging} onClick={() => void loadOlderMessages()}>
                    加载更早消息
                  </Button>
                </div>
              )}

              {!conversation?.messages.length && !currentStreamText && (
                <div className="conversation-empty">
                  <Typography.Title level={3}>{selectedSessionId ? '开始新对话' : '选择或新建对话'}</Typography.Title>
                  <Typography.Text type="secondary">{selectedSessionId ? '在下方输入你的需求。' : '从左侧选择项目和对话。'}</Typography.Text>
                </div>
              )}

              {conversation?.messages.map((m) => (
                <BilingualBubble
                  key={m.id}
                  message={m}
                  translation={conversation.bilingual?.[m.id]}
                  showChinese={showChinese}
                  showTools={showTools}
                  toolAnswers={conversation.answers}
                  onRetry={() => retryMessageTranslation(m.id)}
                />
              ))}

              {currentStreamText && (
                <div style={{ marginBottom: 18 }}>
                  <Bubble
                    placement="start"
                    variant="borderless"
                    shape="round"
                    streaming
                    avatar={
                      <Avatar
                        size={24}
                        style={{ backgroundColor: '#F4F4F5', color: '#18181B', border: '1px solid #E4E4E7' }}
                        icon={<RobotOutlined aria-hidden="true" style={{ fontSize: 12 }} />}
                      />
                    }
                    header={
                      <Space size={6}>
                        <strong style={{ fontSize: 12, color: '#09090B' }}>Claude 正在回复</strong>
                        <LoadingOutlined aria-hidden="true" style={{ fontSize: 12, color: '#666666' }} />
                      </Space>
                    }
                    content={currentStreamText}
                    contentRender={(content) => <RichMarkdown text={String(content || '')} streaming />}
                    styles={{ content: { background: 'transparent', padding: '2px 0' } }}
                  />
                </div>
              )}

              {pendingApprovals.map((p) => (
                <ApprovalCard
                  key={p.requestId}
                  request={p}
                  onRespond={(allow, answers) => respondToApproval(p.requestId, allow, answers)}
                />
              ))}
            </div>
          </div>

          {showScrollBottom && (
            <Button
              shape={pendingApprovals.length > 0 ? 'round' : 'circle'}
              size="small"
              icon={<ArrowDownOutlined aria-hidden="true" />}
              onClick={() => scrollToBottom(true)}
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: 138,
                zIndex: 10,
                background: '#FFFFFF',
                borderColor: '#E4E4E7',
                color: '#18181B',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)',
              }}
            >
              {pendingApprovals.length > 0 ? '有待审批请求' : null}
            </Button>
          )}

                <ChatComposer key={selectedSessionId} />
              </div>

              <RightWorkbenchPanel
                projectId={projectId}
                projectRoot={currentProject?.root || ''}
                sessionId={selectedSessionId}
                containerWidth={workspaceWidth}
                sheet={useSheet}
                onMentionFile={(filePath) => {
                  setDraft(draft ? `${draft.trimEnd()} @${filePath} ` : `@${filePath} `);
                }}
              />
            </div>
          </Flex>
        </Splitter.Panel>
      </Splitter>
    </section>
  );
};

export default AgentWorkspacePage;
