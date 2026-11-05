import React, { memo, useMemo, useState } from 'react';
import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/themes/light.css';
import { CodeHighlighter, Mermaid } from '@ant-design/x';
import { Button, Flex, Image, Popover, Space, Tooltip, Typography } from 'antd';
import {
  CompassOutlined,
  CopyOutlined,
  ExpandAltOutlined,
  GlobalOutlined,
  LinkOutlined,
  PictureOutlined,
  ShrinkOutlined,
} from '@ant-design/icons';
import { useClipboard } from '../../hooks/useClipboard';
import { useConsole } from '../../contexts/ConsoleContext';
import { CopyFilePath } from './CopyFilePath';

const EnhancedCodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const isVeryLong = lineCount > 35;
  const [collapsed, setCollapsed] = useState(false);

  if (lang === 'mermaid') {
    return (
      <div style={{ margin: '10px 0' }}>
        <Mermaid>{code}</Mermaid>
      </div>
    );
  }

  const displayedCode =
    isVeryLong && collapsed ? code.split('\n').slice(0, 18).join('\n') + '\n// ... 已折叠剩余代码 ...' : code;

  return (
    <div style={{ margin: '10px 0' }}>
      {isVeryLong && (
        <Flex justify="flex-end" style={{ marginBottom: 4 }}>
          <Button
            size="small"
            type="text"
            icon={collapsed ? <ExpandAltOutlined /> : <ShrinkOutlined />}
            onClick={() => setCollapsed((c) => !c)}
            style={{ fontSize: 12, color: '#52525B' }}
          >
            {collapsed ? `展开全部 (${lineCount} 行)` : `折叠长代码 (${lineCount} 行)`}
          </Button>
        </Flex>
      )}
      <CodeHighlighter lang={lang || 'text'}>{displayedCode}</CodeHighlighter>
    </div>
  );
};

const SmartLink: React.FC<{ href?: string; children?: React.ReactNode }> = ({ href, children }) => {
  const { copyText } = useClipboard();
  const [open, setOpen] = useState(false);

  if (!href) return <span>{children}</span>;

  const isHttp = /^https?:\/\//i.test(href);
  if (!isHttp && !/^[a-z]+:/i.test(href) && /[./\\]/.test(href) && !href.startsWith('#')) {
    return (
      <CopyFilePath path={href}>{children}</CopyFilePath>
    );
  }

  if (!isHttp) {
    return (
      <Tooltip title={href}>
        <Typography.Text code>{children}</Typography.Text>
      </Tooltip>
    );
  }

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      title={
        <Space size={6}>
          <LinkOutlined style={{ color: '#18181B' }} />
          <span style={{ fontSize: 13 }}>外部链接安全打开</span>
        </Space>
      }
      content={
        <div style={{ maxWidth: 340 }}>
          <div
            className="mono"
            style={{
              fontSize: 12,
              color: '#52525B',
              wordBreak: 'break-all',
              marginBottom: 10,
              padding: '6px 8px',
              background: '#FAFAFA',
              border: '1px solid #E4E4E7',
              borderRadius: 6,
            }}
          >
            {href}
          </div>
          <Space wrap size={6}>
            <Button
              size="small"
              type="primary"
              icon={<CopyOutlined />}
              onClick={() => {
                setOpen(false);
                void copyText(href, href, '链接已复制');
              }}
            >
              复制链接
            </Button>
            <Button
              size="small"
              icon={<GlobalOutlined />}
              onClick={() => {
                setOpen(false);
                window.open(href, '_blank', 'noopener,noreferrer');
              }}
            >
              系统打开
            </Button>
          </Space>
        </div>
      }
    >
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        style={{
          color: '#09090B',
          textDecoration: 'underline',
          textDecorationColor: '#666666',
          textUnderlineOffset: 3,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {children} <LinkOutlined style={{ fontSize: 11, color: '#71717A' }} />
      </a>
    </Popover>
  );
};

const SmartImage: React.FC<{ src?: string; alt?: string }> = ({ src, alt }) => {
  const { copyText } = useClipboard();

  if (src && /^(data:image\/|blob:)/i.test(src)) {
    return (
      <div style={{ margin: '8px 0' }}>
        <Image
          src={src}
          alt={alt || '图片预览'}
          style={{
            maxWidth: 320,
            maxHeight: 240,
            borderRadius: 8,
            border: '1px solid #E4E4E7',
            objectFit: 'contain',
          }}
        />
      </div>
    );
  }

  return (
    <span
      className="markdown-image-caption"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        background: '#FAFAFA',
        border: '1px solid #E4E4E7',
        borderRadius: 6,
        fontSize: 12,
        color: '#52525B',
        margin: '4px 0',
      }}
    >
      <PictureOutlined />
      <span>[图片：{alt || '未提供说明'}]</span>
      {src && /^https?:\/\//i.test(src) && (
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto', fontSize: 12 }}
          onClick={() => void copyText(src, src, '图片链接已复制')}
        >
          复制地址
        </Button>
      )}
    </span>
  );
};

export default memo(function RichMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const components = useMemo(
    () => ({
      a: ({ href, children }: any) => <SmartLink href={href}>{children}</SmartLink>,
      img: ({ src, alt }: any) => <SmartImage src={src} alt={alt} />,
      code: ({ className, children }: any) => {
        const raw = String(children ?? '').replace(/\n$/, '');
        const langMatch = /language-([\w-]+)/.exec(className || '');
        if (!langMatch && !raw.includes('\n')) {
          return (
            <code
              className="mono-text"
              style={{
                padding: '2px 6px',
                borderRadius: 5,
                background: '#F4F4F5',
                border: '1px solid #E4E4E7',
                color: '#18181B',
                fontSize: '0.88em',
              }}
            >
              {children}
            </code>
          );
        }
        return <EnhancedCodeBlock lang={langMatch?.[1] || 'text'} code={raw} />;
      },
    }),
    [],
  );

  return (
    <div className="chat-text markdown-message" style={{ minWidth: 0, maxWidth: '100%' }}>
      <XMarkdown
        className="x-markdown-light"
        content={text}
        paragraphTag="div"
        escapeRawHtml
        streaming={{ hasNextChunk: streaming }}
        components={components}
      />
    </div>
  );
});
