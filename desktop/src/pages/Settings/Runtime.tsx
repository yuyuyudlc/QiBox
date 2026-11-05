import React from 'react';
import { Space, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import Overview from '../Overview';
import RuntimeEnv from '../RuntimeEnv';
import NetworkPolicy from '../NetworkPolicy';

const Runtime: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Overview />
      <Tabs
        activeKey={tab === 'network' ? 'network' : 'resources'}
        onChange={(value) => setParams({ tab: value })}
        items={[
          { key: 'resources', label: '环境与 WSL2', children: <RuntimeEnv /> },
          { key: 'network', label: '网络与代理', children: <NetworkPolicy /> },
        ]}
      />
    </Space>
  );
};

export default Runtime;
