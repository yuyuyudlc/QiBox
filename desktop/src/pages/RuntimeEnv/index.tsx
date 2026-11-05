import React from 'react';
import { AutoComplete, Card, Input, Row, Select, Space, Tag } from 'antd';
import { useConsole } from '../../contexts/ConsoleContext';
import { FieldCol, SwitchRow } from '../../components/Common';

export const RuntimeEnvPage: React.FC = () => {
  const { snapshot, policy, editPolicy } = useConsole();
  if (!policy) return null;
  const distroOptions = (snapshot?.wslDistros || []).map((d) => ({
    value: d.name,
    label: `${d.name} (WSL${d.version} · ${d.state}${d.isDefault ? ' · 默认' : ''})`,
  }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="环境设置">
        <Row gutter={16}>
          <FieldCol md={12} label="进程时区（IANA 时区名称）">
            <Input
              list="timezones"
              value={policy.environment.timezone}
              onChange={(e) => editPolicy('environment', { timezone: e.target.value })}
            />
            <datalist id="timezones">
              {['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London'].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </FieldCol>
          <FieldCol md={12} label="系统 Locale">
            <Select
              value={policy.environment.locale}
              onChange={(val) => editPolicy('environment', { locale: val })}
              style={{ width: '100%' }}
              options={[
                { value: 'C.UTF-8', label: 'C.UTF-8（通用默认）' },
                { value: 'en_US.UTF-8', label: 'en_US.UTF-8（英语 / 美国）' },
                { value: 'zh_CN.UTF-8', label: 'zh_CN.UTF-8（简体中文 / 中国）' },
                { value: 'ja_JP.UTF-8', label: 'ja_JP.UTF-8（日语 / 日本）' },
              ]}
            />
          </FieldCol>
        </Row>

        <SwitchRow
          title="禁止自动唤起 Windows 浏览器"
          desc="设置 BROWSER=/bin/false 并剥离 Windows PATH，确保登录或点链接时只在终端输出 URL，绝不拉起宿主机浏览器。"
          checked={policy.environment.blockWindowsBrowser !== false}
          onChange={(blockWindowsBrowser) => editPolicy('environment', { blockWindowsBrowser })}
          borderTop
        />

        <SwitchRow
          title="关闭非必要后台流量"
          desc="设置 Claude Code 官方 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 环境开关。"
          checked={policy.environment.disableNonessentialTraffic}
          onChange={(disableNonessentialTraffic) => editPolicy('environment', { disableNonessentialTraffic })}
          borderTop
        />
      </Card>

      <Card size="small" title="WSL2 实例配置" extra={<Tag>WSL2</Tag>}>
        <Row gutter={16}>
          <FieldCol md={8} label="WSL2 发行版">
            <AutoComplete
              value={policy.runtime.distro}
              options={distroOptions}
              placeholder="例如 Ubuntu"
              style={{ width: '100%' }}
              onChange={(val) => editPolicy('runtime', { distro: val })}
            />
          </FieldCol>
          <FieldCol md={8} label="Linux 用户名">
            <Input
              value={policy.runtime.user}
              onChange={(e) => editPolicy('runtime', { user: e.target.value })}
            />
          </FieldCol>
          <FieldCol md={8} label="默认工作目录">
            <Input
              value={policy.workspace.defaultRoot}
              onChange={(e) => editPolicy('workspace', { defaultRoot: e.target.value })}
            />
          </FieldCol>
        </Row>
      </Card>
    </Space>
  );
};

export default RuntimeEnvPage;
