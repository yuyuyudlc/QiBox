import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Empty, Flex, Layout, Menu, Space, Spin, Typography } from 'antd';
import { ArrowLeftOutlined, CloudServerOutlined, MessageOutlined, ReloadOutlined, SaveOutlined, SettingOutlined, SyncOutlined, UndoOutlined } from '@ant-design/icons';
import { useConsole } from '../../contexts/ConsoleContext';
import { NoticeAlerts } from '../Common';
import WindowTitlebar from './WindowTitlebar';

const SETTINGS_ITEMS = [
  { key: '/settings/chat', label: '对话与翻译', icon: <MessageOutlined aria-hidden="true" /> },
  { key: '/settings/connections', label: '账号与连接', icon: <SyncOutlined aria-hidden="true" /> },
  { key: '/settings/runtime', label: '运行环境', icon: <CloudServerOutlined aria-hidden="true" /> },
];

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { snapshot, policy, dirty, busy, error, notice, clearError, clearNotice, refreshSnapshot, resetPolicyDraft, saveCurrentPolicy } = useConsole();
  const isWorkspacePage = location.pathname === '/history';
  const activeSetting = SETTINGS_ITEMS.find((item) => item.key === location.pathname);

  return (
    <div className="desktop-shell">
      <WindowTitlebar />
      <Layout className="app-shell">
      {!isWorkspacePage && (
        <Layout.Sider width={224} className="settings-sidebar" theme="light">
          <Button type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={() => navigate('/history')} className="back-to-chat">返回对话</Button>
          <div className="settings-label"><SettingOutlined aria-hidden="true" /> 设置</div>
          <Menu mode="inline" selectedKeys={[location.pathname]} items={SETTINGS_ITEMS} onClick={({ key }) => navigate(key)} />
        </Layout.Sider>
      )}
      <Layout className="main-layout">
        <Layout.Content className={isWorkspacePage ? 'content history-page' : 'content settings-content'}>
          {!isWorkspacePage && (
            <Flex justify="space-between" align="center" className="settings-heading">
              <Typography.Title level={4}>{activeSetting?.label || '设置'}</Typography.Title>
              <Button type="text" icon={<ReloadOutlined aria-hidden="true" spin={Boolean(busy)} />} disabled={Boolean(busy)} onClick={() => void refreshSnapshot(false)}>刷新状态</Button>
            </Flex>
          )}
          {(error || (notice && !(isWorkspacePage && notice === 'WSL2 工作环境已启动。')) || busy) && (
            <div className="console-notices">
              <NoticeAlerts
                error={error}
                note={isWorkspacePage && notice === 'WSL2 工作环境已启动。' ? '' : notice}
                onClearError={clearError}
                onClearNote={clearNotice}
                style={{ marginBottom: 8 }}
              />
              {busy && <Alert type="info" role="status" showIcon icon={<Spin size="small" />} message={busy} />}
            </div>
          )}
          {!policy || !snapshot ? (
            <Flex flex={1} align="center" justify="center" style={{ minHeight: 280 }}>
              <Empty description={busy ? '正在连接…' : '无法连接本地环境，请在桌面应用中重试。'}>
                <Button type="primary" icon={<ReloadOutlined aria-hidden="true" />} disabled={Boolean(busy)} onClick={() => void refreshSnapshot(true)}>重新连接</Button>
              </Empty>
            </Flex>
          ) : isWorkspacePage && !snapshot.runtime.verified ? (
            <Empty description={snapshot.runtime.exists ? '连接工作环境后即可使用对话。' : '先创建工作环境，再开始对话。'}>
              <Button type="primary" onClick={() => navigate('/settings/runtime')}>打开运行环境</Button>
            </Empty>
          ) : <Outlet />}
        </Layout.Content>
        {policy && snapshot && dirty && (
          <Layout.Footer className="save-bar">
            <div>
              <strong>配置尚未保存</strong>
              <div className="save-hint">{snapshot.runtime.running ? '请先停止运行环境，再保存配置更改。' : '保存后，启动环境以应用配置。'}</div>
            </div>
            <Space>
              <Button icon={<UndoOutlined aria-hidden="true" />} disabled={Boolean(busy)} onClick={resetPolicyDraft}>撤销</Button>
              <Button type="primary" icon={<SaveOutlined aria-hidden="true" />} disabled={Boolean(busy || snapshot.runtime.running)} onClick={() => void saveCurrentPolicy()}>保存配置</Button>
            </Space>
          </Layout.Footer>
        )}
      </Layout>
      </Layout>
    </div>
  );
};

export default AppLayout;
