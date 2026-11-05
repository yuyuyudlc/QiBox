import React from 'react';
import { Conversations } from '@ant-design/x';
import { Button, Empty, Flex, Input, Select, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  LoadingOutlined,
  MessageOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { SESSION_STATE_LABELS, type Project, type Session } from '../../services/types';
import { useAgent } from '../../contexts/AgentContext';

interface WorkspaceSidebarProps {
  projects: Project[];
  projectId: string;
  currentProject?: Project;
  sessions: Session[];
  selectedSessionId: string;
  searchQuery: string;
  connected: boolean;
  creating: boolean;
  deleting: boolean;
  onSearchChange: (value: string) => void;
  onSelectProject: (id: string) => void;
  onOpenNewProject: () => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRequestDeleteSession: (session: Session) => void;
  onOpenSettings: () => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  projects,
  projectId,
  currentProject,
  sessions,
  selectedSessionId,
  searchQuery,
  connected,
  creating,
  deleting,
  onSearchChange,
  onSelectProject,
  onOpenNewProject,
  onCreateSession,
  onSelectSession,
  onRequestDeleteSession,
  onOpenSettings,
}) => {
  return (
    <aside
      className="history-sessions"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#F9F9F9',
      }}
    >
      {/* 顶部：项目选择与快捷新建（Codex 风格轻量布局） */}
      <div style={{ padding: '10px 10px 6px' }}>
        <Flex align="center" justify="space-between" gap={4} style={{ marginBottom: 4 }}>
          <Select
            id="current-project"
            aria-label="当前项目"
            size="small"
            variant="borderless"
            value={projectId || undefined}
            placeholder="选择项目"
            disabled={!connected || deleting || creating}
            onChange={onSelectProject}
            style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
            popupMatchSelectWidth={false}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Tooltip title="新建项目">
            <Button
              size="small"
              type="text"
              icon={<FolderAddOutlined aria-hidden="true" />}
              aria-label="新建项目"
              disabled={!connected || deleting || creating}
              onClick={onOpenNewProject}
              style={{ color: '#52525B' }}
            />
          </Tooltip>
        </Flex>

        {currentProject?.root && (
          <Typography.Text
            className="mono-text"
            ellipsis={{ tooltip: currentProject.root }}
            style={{ display: 'block', padding: '0 8px 6px', fontSize: 11, color: '#8E8E93' }}
          >
            {currentProject.root}
          </Typography.Text>
        )}

        <Button
          block
          type="text"
          icon={<EditOutlined aria-hidden="true" />}
          disabled={!connected || !projectId || creating || deleting}
          loading={creating}
          onClick={onCreateSession}
          style={{
            justifyContent: 'flex-start',
            height: 34,
            borderRadius: 8,
            fontWeight: 500,
            color: '#18181B',
            marginBottom: 4,
          }}
        >
          新聊天
        </Button>

        <Input
          size="small"
          variant="filled"
          prefix={<SearchOutlined aria-hidden="true" style={{ color: '#A1A1AA' }} />}
          aria-label="搜索会话"
          placeholder="搜索对话…"
          allowClear
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ borderRadius: 8 }}
        />
      </div>

      {/* 会话列表 */}
      <div className="history-session-list" style={{ flex: 1, overflow: 'auto', padding: '4px 8px 8px', minHeight: 0 }}>
        {sessions.length > 0 ? (
          <Conversations
            activeKey={selectedSessionId}
            onActiveChange={onSelectSession}
            items={sessions.map((s) => {
              const running = ['running', 'starting', 'waiting_permission'].includes(s.status);
              const active = s.id === selectedSessionId;
              return {
                key: s.id,
                icon: running ? (
                  <LoadingOutlined aria-hidden="true" style={{ color: '#52525B', fontSize: 13 }} />
                ) : (
                  <MessageOutlined
                    aria-hidden="true"
                    style={{ color: active ? '#18181B' : '#A1A1AA', fontSize: 13 }}
                  />
                ),
                label: (
                  <div data-session-id={s.id} style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: active ? 600 : 400,
                        fontSize: 12.5,
                        color: active ? '#09090B' : '#27272A',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={s.title}
                    >
                      {s.title}
                    </div>
                    <Flex justify="space-between" style={{ fontSize: 10.5, color: '#8E8E93', marginTop: 1 }}>
                      <span>{SESSION_STATE_LABELS[s.status] || s.status}</span>
                      <span>
                        {new Date(s.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </Flex>
                  </div>
                ),
              };
            })}
            menu={(conv) => {
              const target = sessions.find((s) => s.id === conv.key);
              const active = target && ['running', 'starting', 'waiting_permission'].includes(target.status);
              return {
                items: [
                  {
                    key: 'delete',
                    label: active ? '请先停止任务再删除' : '删除对话',
                    icon: <DeleteOutlined aria-hidden="true" />,
                    danger: true,
                    disabled: Boolean(!connected || deleting || active),
                  },
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (key === 'delete' && target && !active) onRequestDeleteSession(target);
                },
              };
            }}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={searchQuery ? '未找到匹配的会话' : '暂无对话'}
            style={{ marginTop: 40 }}
          />
        )}
      </div>

      {/* 底部设置与账号额度 */}
      <WorkspaceSidebarFooter onOpenSettings={onOpenSettings} />
    </aside>
  );
};

function formatResetAt(raw?: string | number | null): string {
  if (!raw) return '';
  const ts = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const WorkspaceSidebarFooter: React.FC<{ onOpenSettings: () => void }> = ({ onOpenSettings }) => {
  const { accountUsage, selectedSessionId, refreshCapabilities } = useAgent();
  const [refreshing, setRefreshing] = React.useState(false);
  const five = accountUsage?.fiveHour;
  const seven = accountUsage?.sevenDay;
  const hasLimits = Boolean(five || seven);
  const maxPct = Math.max(five?.utilization ?? 0, seven?.utilization ?? 0);
  const badgeColor = maxPct >= 90 ? '#EF4444' : maxPct >= 75 ? '#D97706' : '#52525B';

  const handleRefresh = async () => {
    if (!selectedSessionId || refreshing) return;
    setRefreshing(true);
    try {
      await refreshCapabilities();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className="workspace-sidebar-footer"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
    >
      <Button
        type="text"
        icon={<SettingOutlined aria-hidden="true" />}
        onClick={onOpenSettings}
        style={{ paddingInline: 8 }}
      >
        设置
      </Button>
      {selectedSessionId && (
        <Tooltip
          title={
            hasLimits ? (
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                {accountUsage?.subscriptionType && (
                  <div>订阅类型：{accountUsage.subscriptionType.toUpperCase()}</div>
                )}
                {five && (
                  <div>
                    5 小时额度：已用 {five.utilization}%
                    {five.resetsAt ? `（重置：${formatResetAt(five.resetsAt)}）` : ''}
                  </div>
                )}
                {seven && (
                  <div>
                    7 天额度：已用 {seven.utilization}%
                    {seven.resetsAt ? `（重置：${formatResetAt(seven.resetsAt)}）` : ''}
                  </div>
                )}
                <div style={{ opacity: 0.75, marginTop: 2 }}>点击刷新额度</div>
              </div>
            ) : accountUsage?.rateLimitsAvailable === false ? (
              '当前非订阅 OAuth 登录，无 5h/7d 额度窗口'
            ) : (
              '点击查询当前账号 5h / 7d 额度'
            )
          }
        >
          <Button
            type="text"
            size="small"
            loading={refreshing}
            onClick={() => void handleRefresh()}
            style={{
              fontSize: 11,
              color: hasLimits ? badgeColor : '#71717A',
              fontVariantNumeric: 'tabular-nums',
              paddingInline: 6,
              height: 26,
              background: '#F4F4F5',
              borderRadius: 6,
              whiteSpace: 'nowrap',
            }}
          >
            {hasLimits
              ? [five ? `5h ${five.utilization}%` : null, seven ? `7d ${seven.utilization}%` : null]
                  .filter(Boolean)
                  .join(' · ')
              : accountUsage?.rateLimitsAvailable === false
                ? 'API 模式'
                : '额度 --'}
          </Button>
        </Tooltip>
      )}
    </div>
  );
};

export default WorkspaceSidebar;
