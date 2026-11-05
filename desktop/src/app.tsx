import React from 'react';
import { XProvider } from '@ant-design/x';
import zhCN from 'antd/locale/zh_CN';
import zhCN_X from '@ant-design/x/locale/zh_CN';
import { App as AntdApp } from 'antd';
import { appTheme } from './theme';
import { ConsoleProvider } from './contexts/ConsoleContext';
import { AgentProvider } from './contexts/AgentContext';
import { RightPanelProvider } from './contexts/RightPanelContext';
import AppRouter from './router';
import './style.css';

const mergedLocale = { ...zhCN, ...zhCN_X };

/**
 * 应用顶层包裹器：
 * 1. XProvider（统一替代 ConfigProvider，注入 Ant Design v6 & Ant Design X v2 主题与中文语言包）
 * 2. AntdApp（提供全局 message / modal / notification 上下文）
 * 3. ConsoleProvider & AgentProvider & RightPanelProvider（隔离环境、对话与右侧工作台状态中心）
 * 4. AppRouter（页面路由树）
 */
export const App: React.FC = () => {
  return (
    <XProvider locale={mergedLocale} theme={appTheme}>
      <AntdApp>
        <ConsoleProvider>
          <AgentProvider>
            <RightPanelProvider>
              <AppRouter />
            </RightPanelProvider>
          </AgentProvider>
        </ConsoleProvider>
      </AntdApp>
    </XProvider>
  );
};

export default App;
