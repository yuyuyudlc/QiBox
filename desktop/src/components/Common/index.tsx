import React from 'react';
import { Alert, Card, Col, Flex, Row, Space, Switch } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';

/**
 * 通用开关配置行（标题 + 副标题 + 右侧 Switch）
 */
export const SwitchRow: React.FC<{
  title: string;
  desc: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  borderTop?: boolean;
  borderBottom?: boolean;
}> = ({ title, desc, checked, onChange, disabled, ariaLabel, borderTop, borderBottom }) => (
  <Flex
    justify="space-between"
    align="center"
    gap={16}
    style={{
      ...(borderTop ? { marginTop: 14, paddingTop: 14, borderTop: '1px solid #F4F4F5' } : {}),
      ...(borderBottom ? { marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #F4F4F5' } : {}),
    }}
  >
    <div>
      <div style={{ fontWeight: 500, color: '#09090B', fontSize: 13.5 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#71717A', marginTop: 2 }}>{desc}</div>
    </div>
    <Switch aria-label={ariaLabel || title} checked={checked} disabled={disabled} onChange={onChange} />
  </Flex>
);

/**
 * 通用表单栅格列（带 12px 紧凑标签头）
 */
export const FieldCol: React.FC<{
  label: React.ReactNode;
  md?: number;
  sm?: number;
  span?: number;
  children: React.ReactNode;
}> = ({ label, md, sm, span, children }) => (
  <Col xs={24} sm={sm} md={md} span={span}>
    <div style={{ fontSize: 12, fontWeight: 500, color: '#52525B', marginBottom: 6 }}>{label}</div>
    {children}
  </Col>
);

/**
 * 通用顶部状态横幅（Swiss Minimalist 风格，克制边框 + 状态信号点）
 */
export const BannerAlert: React.FC<{
  type?: 'info' | 'warning' | 'success' | 'error';
  icon?: React.ReactNode;
  title: React.ReactNode;
  tagText: React.ReactNode;
  tagColor?: string;
  description?: React.ReactNode;
}> = ({ type = 'info', icon, title, tagText, description }) => {
  const dotClass =
    type === 'success'
      ? 'status-dot status-dot--emerald'
      : type === 'warning'
        ? 'status-dot status-dot--amber'
        : type === 'error'
          ? 'status-dot status-dot--red'
          : 'status-dot status-dot--zinc';

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E4E4E7',
        borderRadius: 10,
        padding: '14px 18px',
        boxShadow: '0 1px 2px 0 rgba(9, 9, 11, 0.03)',
      }}
    >
      <Flex justify="space-between" align="center" gap={12}>
        <Flex align="center" gap={10}>
          <span className={dotClass} />
          {icon && <span style={{ color: '#52525B', fontSize: 14, display: 'inline-flex' }}>{icon}</span>}
          <strong style={{ fontSize: 13.5, fontWeight: 600, color: '#09090B' }}>{title}</strong>
        </Flex>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 500,
            padding: '2px 8px',
            borderRadius: 6,
            background: '#F5F5F5',
            color: '#525252',
            border: '1px solid #E0E0E0',
          }}
        >
          {tagText}
        </span>
      </Flex>
      {description && (
        <div style={{ fontSize: 12.5, color: '#71717A', marginTop: 6, paddingLeft: 18, lineHeight: 1.55 }}>
          {description}
        </div>
      )}
    </div>
  );
};

/**
 * 通用错误与成功提示条组
 */
export const NoticeAlerts: React.FC<{
  error?: string;
  note?: string;
  onClearError?: () => void;
  onClearNote?: () => void;
  style?: React.CSSProperties;
}> = ({ error, note, onClearError, onClearNote, style }) => (
  <>
    {error && (
      <Alert
        type="error"
        role="alert"
        showIcon
        closable={Boolean(onClearError)}
        onClose={onClearError}
        message={error}
        style={style || { marginBottom: 10 }}
      />
    )}
    {note && (
      <Alert
        type="success"
        role="status"
        showIcon
        closable={Boolean(onClearNote)}
        onClose={onClearNote}
        message={note}
        style={style || { marginBottom: 10 }}
      />
    )}
  </>
);
