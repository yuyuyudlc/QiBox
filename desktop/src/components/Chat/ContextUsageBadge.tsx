import React from 'react';
import { Button, Space, Tooltip, Typography } from 'antd';
import { CompressOutlined, DashboardOutlined } from '@ant-design/icons';
import { useAgent } from '../../contexts/AgentContext';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const ContextUsageBadge: React.FC = () => {
  const { selectedSessionId, activeSession, usageMap, setDraft, isBusy } = useAgent();
  const usage = selectedSessionId ? usageMap[selectedSessionId] : undefined;

  if (!activeSession || !usage) return null;

  const modelStr = `${activeSession.actualModel || activeSession.model || ''}`.toLowerCase();
  const windowSize = usage.contextWindow > 0 ? usage.contextWindow : modelStr.includes('1m') ? 1_000_000 : 0;
  const pct = windowSize > 0 ? Math.min(100, Math.round((usage.contextTokens / windowSize) * 100)) : 0;
  const strokeColor = pct >= 85 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#10B981';

  return (
    <Space size={6} align="center" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
      <Tooltip
        title={
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <div>
              上下文 Token：{formatTokens(usage.contextTokens)}
              {windowSize > 0 ? ` / ${formatTokens(windowSize)} (${pct}%)` : ''}
            </div>
            <div>累计输入：{formatTokens(usage.inputTokens)} · 输出：{formatTokens(usage.outputTokens)}</div>
            <div>缓存读取：{formatTokens(usage.cacheReadTokens)}</div>
          </div>
        }
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 6,
            background: '#F4F4F5',
            border: '1px solid #E4E4E7',
            cursor: 'default',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <DashboardOutlined style={{ fontSize: 11, color: '#52525B', flexShrink: 0 }} />
          {windowSize > 0 && (
            <div
              style={{
                width: 34,
                height: 5,
                borderRadius: 999,
                background: '#D4D4D8',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: strokeColor,
                  borderRadius: 999,
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          )}
          <Typography.Text
            style={{
              fontSize: 11,
              color: '#3F3F46',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {windowSize > 0
              ? `${formatTokens(usage.contextTokens)} / ${formatTokens(windowSize)}`
              : `${formatTokens(usage.contextTokens)} tokens`}
          </Typography.Text>
        </div>
      </Tooltip>
      {windowSize > 0 && pct >= 75 && !isBusy && (
        <Tooltip title="上下文接近上限，填入 /compact 压缩历史">
          <Button
            size="small"
            type="text"
            icon={<CompressOutlined />}
            onClick={() => setDraft('/compact ')}
            style={{ fontSize: 11, color: '#D97706', padding: '0 6px' }}
          >
            压缩
          </Button>
        </Tooltip>
      )}
    </Space>
  );
};

export default ContextUsageBadge;
