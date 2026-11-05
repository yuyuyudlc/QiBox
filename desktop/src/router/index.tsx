import React, { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Flex, Spin } from 'antd';
import AppLayout from '../components/Layout/AppLayout';

const ROUTES: { path: string; Component: React.LazyExoticComponent<React.FC> }[] = [
  { path: 'history', Component: lazy(() => import('../pages/AgentWorkspace')) },
  { path: 'settings/chat', Component: lazy(() => import('../pages/Settings/ChatSettings')) },
  { path: 'settings/connections', Component: lazy(() => import('../pages/Settings/Connections')) },
  { path: 'settings/runtime', Component: lazy(() => import('../pages/Settings/Runtime')) },
];

const LEGACY_ROUTES: Record<string, string> = {
  overview: '/settings/runtime',
  network: '/settings/runtime?tab=network',
  environment: '/settings/runtime',
  claude: '/settings/connections',
  'settings/diagnostics': '/settings/runtime',
};

const Fallback = (
  <Flex flex={1} align="center" justify="center" style={{ minHeight: 280 }}>
    <Spin description="正在加载页面模块…" />
  </Flex>
);

export const AppRouter: React.FC = () => (
  <HashRouter>
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/history" replace />} />
        <Route path="settings" element={<Navigate to="/settings/chat" replace />} />
        {Object.entries(LEGACY_ROUTES).map(([path, to]) => <Route key={path} path={path} element={<Navigate to={to} replace />} />)}
        {ROUTES.map(({ path, Component }) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={Fallback}>
                <Component />
              </Suspense>
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/history" replace />} />
      </Route>
    </Routes>
  </HashRouter>
);

export default AppRouter;
