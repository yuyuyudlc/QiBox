import React from 'react';
import { Button, Card, Flex, Typography } from 'antd';
import { PlayCircleOutlined, StopOutlined, ToolOutlined } from '@ant-design/icons';
import { useConsole } from '../../contexts/ConsoleContext';

export const OverviewPage: React.FC = () => {
  const { snapshot, dirty, busy, setupWsl, runOperation } = useConsole();
  if (!snapshot) return null;
  const runtime = snapshot.runtime;
  const runtimeLabel = !runtime.engineAvailable ? 'WSL2 不可用'
    : runtime.running ? 'WSL2 环境运行中'
    : runtime.dependenciesReady ? 'WSL2 环境已停止' : 'WSL2 依赖待配置';
  const actionsDisabled = Boolean(busy || dirty || !runtime.engineAvailable);

  return (
    <Card size="small">
      <Flex justify="space-between" align="center" wrap gap={16}>
        <div>
          <strong>{runtimeLabel}</strong>
          <div>
            <Typography.Text type="secondary">
              {snapshot.policy.runtime.distro} · 用户 {snapshot.policy.runtime.user}
              {runtime.claudeVersion ? ` · Claude ${runtime.claudeVersion}` : ''}
            </Typography.Text>
          </div>
          {!runtime.engineAvailable && (
            <Typography.Text type="warning">
              {runtime.reason || '请检查 WSL2 发行版是否已安装，然后刷新状态。'}
            </Typography.Text>
          )}
          {runtime.engineAvailable && runtime.reason && (
            <Typography.Text type="warning">{runtime.reason}</Typography.Text>
          )}
        </div>
        {runtime.running ? (
          <Button icon={<StopOutlined />} disabled={Boolean(busy)} onClick={() => void runOperation('stop')}>
            停止环境
          </Button>
        ) : (
          <Flex gap={8} wrap>
            <Button
              type={runtime.dependenciesReady ? 'default' : 'primary'}
              icon={<ToolOutlined aria-hidden="true" />}
              disabled={actionsDisabled}
              onClick={() => void setupWsl()}
            >
              配置 WSL
            </Button>
            <Button
              type={runtime.dependenciesReady ? 'primary' : 'default'}
              icon={<PlayCircleOutlined aria-hidden="true" />}
              disabled={actionsDisabled || !runtime.dependenciesReady}
              onClick={() => void runOperation('up')}
            >
              启动环境
            </Button>
          </Flex>
        )}
      </Flex>
    </Card>
  );
};

export default OverviewPage;
