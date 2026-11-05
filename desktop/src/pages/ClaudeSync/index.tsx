import React from 'react';
import { Alert, Button, Card, Collapse, Input, Row, Space, Typography } from 'antd';
import {
  LockOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useConsole } from '../../contexts/ConsoleContext';
import { FieldCol } from '../../components/Common';
import { formatTime } from '../../services/types';
import { consoleService } from '../../services/console';

export const ClaudeSyncPage: React.FC = () => {
  const { snapshot, dirty, busy, claudeInfo, handleClaudeSync } = useConsole();
  const runtime = snapshot?.runtime;
  const [codexBusy, setCodexBusy] = React.useState(false);
  const [codexMessage, setCodexMessage] = React.useState('');
  const [codexError, setCodexError] = React.useState(false);
  const runCodex = async (operation: 'info' | 'sync') => {
    setCodexBusy(true); setCodexMessage(''); setCodexError(false);
    try {
      const info = await consoleService.claudeSync('codex_info');
      if (operation === 'info') setCodexMessage(`已找到 OAuth 登录文件：${info.sourcePath}。凭据内容已隐藏。`);
      else {
        const result = await consoleService.claudeSync('codex_sync', info.sourceHash);
        setCodexMessage(result.changed ? `登录态已同步到 ${info.targetPath}。${result.backupCreated ? '旧登录文件已在 WSL2 内备份。' : ''}` : 'WSL2 中的登录态已与 Windows 一致。');
      }
    } catch (error) { setCodexError(true); setCodexMessage(error instanceof Error ? error.message : String(error)); }
    finally { setCodexBusy(false); }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Claude 配置同步">
        <Typography.Paragraph type="secondary">从 Windows 单向同步到 WSL2；新建会话生效，旧配置自动备份。</Typography.Paragraph>
        <Space wrap size={10} style={{ marginBottom: 12 }}>
          <Button icon={<SearchOutlined />} disabled={Boolean(busy)} onClick={() => void handleClaudeSync('info')}>
            读取 Windows 配置
          </Button>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            disabled={Boolean(busy || dirty || !runtime?.verified)}
            onClick={() => void handleClaudeSync('sync')}
          >
            同步到 WSL2
          </Button>
        </Space>

        {!runtime?.verified && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            需先启动 WSL2 环境才能执行同步。读取配置摘要不需要启动后台服务。
          </Typography.Paragraph>
        )}
        {dirty && (
          <Typography.Paragraph type="warning" style={{ fontSize: 12 }}>
            请先保存或撤销底部的隔离策略未保存更改。
          </Typography.Paragraph>
        )}

        {claudeInfo && (
          <div style={{ marginTop: 12 }}>
            <Row gutter={[16, 12]}>
              <FieldCol span={24} label="Windows 配置来源">
                <Input value={claudeInfo.sourcePath} readOnly />
              </FieldCol>
              <FieldCol md={12} label="当前 API 域名">
                <Input value={claudeInfo.endpointHost || '需要检查接口地址'} readOnly />
              </FieldCol>
              <FieldCol md={12} label="API 密钥状态">
                <Input
                  value={
                    claudeInfo.hasCredential ? '已配置 · 内容已隐藏' : '未发现 API Key / Token；登录状态不在同步范围'
                  }
                  readOnly
                />
              </FieldCol>
              <FieldCol span={24} label="WSL2 目标路径">
                <Input value={claudeInfo.targetPath} readOnly />
              </FieldCol>
            </Row>

            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
              源文件更新：{formatTime(claudeInfo.modifiedAt)} · 最近同步：{formatTime(claudeInfo.lastSync?.time)}
            </Typography.Text>

            {claudeInfo.blockedReason && (
              <Alert type="error" showIcon message={claudeInfo.blockedReason} style={{ marginTop: 10 }} />
            )}

            <Collapse
              size="small"
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'scope',
                  label: '查看同步范围（仅显示配置项键名）',
                  children: (
                    <pre style={{ margin: 0, fontSize: 12 }}>
                      {`设置：${claudeInfo.settingKeys.join(', ') || '无'}\n环境变量：${
                        claudeInfo.envKeys.join(', ') || '无'
                      }\n跳过：${claudeInfo.skipped.join(', ') || '无'}`}
                    </pre>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>

      <Collapse items={[
        {
          key: 'codex',
          label: 'Codex 登录态同步',
          children: (
            <Space direction="vertical">
              <Typography.Paragraph type="secondary">将 Windows Codex OAuth 凭据同步到 WSL2 持久用户目录，WSL2 内程序可使用该账号。登录过期后需重新同步。</Typography.Paragraph>
              <Space wrap>
                <Button disabled={codexBusy || Boolean(busy)} onClick={() => void runCodex('info')}>检查 Windows 登录态</Button>
                <Button type="primary" disabled={codexBusy || Boolean(busy) || dirty || !runtime?.verified} onClick={() => void runCodex('sync')}>同步 Codex 登录态</Button>
              </Space>
              {codexMessage && <Alert style={{ marginTop: 12 }} showIcon type={codexError ? 'error' : 'info'} message={codexMessage} />}
            </Space>
          ),
        },
      ]} />

      <Card size="small" title="重置登录">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          清除 WSL2 用户级的 API 接口、密钥和 OAuth 登录，并关闭缓存认证的空闲 Claude 进程。项目文件、对话历史及 Windows 原配置会保留。
        </Typography.Paragraph>
        <Button
          danger
          icon={<ReloadOutlined />}
          disabled={Boolean(busy || dirty || !runtime?.verified)}
          onClick={() => void handleClaudeSync('reset')}
        >
          恢复未登录
        </Button>
      </Card>
    </Space>
  );
};

export default ClaudeSyncPage;
