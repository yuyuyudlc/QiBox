import React from 'react';
import { Card, Input, Space, Tag, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useConsole } from '../../contexts/ConsoleContext';
import { BannerAlert } from '../../components/Common';

export const NetworkPolicyPage: React.FC = () => {
  const { policy, editPolicy } = useConsole();
  if (!policy) return null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <BannerAlert
        type="info"
        icon={<GlobalOutlined />}
        title="WSL2 NAT 模式网络"
        tagColor="processing"
        tagText="WSL2"
        description="Windows 可直接通过 localhost 访问 WSL2 中启动的开发服务端口（如 3000），无需额外端口映射；WSL2 内部默认无法扫描 Windows 宿主机端口。"
      />

      <Card size="small" title="独立代理配置（可选）" extra={<Tag>HTTP / HTTPS / SOCKS5</Tag>}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          填写后将在启动 WSL2 后台服务时注入 <code>HTTP_PROXY</code> / <code>HTTPS_PROXY</code> 与 <code>NODE_USE_ENV_PROXY=1</code>；留空则直连外网（或使用 WSL 系统默认网络）。
        </Typography.Paragraph>
        <Input
          allowClear
          spellCheck={false}
          className="mono"
          placeholder="例如 http://192.168.x.x:7890（WSL2 NAT 下宿主机 IP，非 127.0.0.1）"
          value={policy.network.proxyUrl ?? ''}
          onChange={(e) => editPolicy('network', { proxyUrl: e.target.value.trim() || null })}
        />
      </Card>
    </Space>
  );
};

export default NetworkPolicyPage;
