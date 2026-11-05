import React, { useState } from 'react';
import { Actions, Bubble } from '@ant-design/x';
import { Avatar, Button, Flex, Image, Space, Tag, Typography } from 'antd';
import {
  CheckOutlined,
  CodeOutlined,
  CopyOutlined,
  GlobalOutlined,
  ReloadOutlined,
  RobotOutlined,
  TranslationOutlined,
  UserOutlined,
} from '@ant-design/icons';
import RichMarkdown from './RichMarkdown';
import ToolBlockCard from './ToolBlockCard';
import { useConsole } from '../../contexts/ConsoleContext';
import { useClipboard } from '../../hooks/useClipboard';
import { CopyFilePath } from './CopyFilePath';
import { formatTime, type BilingualRecord, type Message, type ToolAnswerRecord } from '../../services/types';

const LANGUAGE_HINTS: Record<string, string> = {
  japanese_kana: '观察到日文假名',
  han_only: '汉字文本 · 语言待人工确认',
  other: '代码 / 其他文本',
};

interface BilingualBubbleProps {
  message: Message;
  translation?: BilingualRecord;
  showChinese: boolean;
  showTools: boolean;
  toolAnswers?: ToolAnswerRecord[];
  onRetry?: () => Promise<void>;
}

export const BilingualBubble: React.FC<BilingualBubbleProps> = ({
  message: m,
  translation,
  showChinese,
  showTools,
  toolAnswers,
  onRetry,
}) => {
  const { snapshot } = useConsole();
  const { copyText, isCopied } = useClipboard();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const outputLang = snapshot?.chatPreferences.outputLanguage || 'zh-CN';
  const outputLangLabel = outputLang === 'zh-CN' ? '中文' : (snapshot?.targetLanguages[outputLang] || outputLang);

  const originalText = m.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const toolBlocks = showTools ? m.blocks.filter((b) => b.type !== 'text') : [];

  if (m.kind === 'command' || m.kind === 'command_result') {
    const hasErr = m.blocks.some((b) => b.isError);
    return (
      <div
        className={`local-command ${m.kind}${hasErr ? ' command-error' : ''}`}
        data-message-id={m.id}
        style={{
          margin: '10px 0',
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${hasErr ? '#FECACA' : '#E4E4E7'}`,
          background: hasErr ? '#FEF2F2' : '#FAFAFA',
        }}
      >
        <Flex justify="space-between" align="center" style={{ marginBottom: 4 }}>
          <Space size={6}>
            <CodeOutlined style={{ color: '#52525B' }} />
            <Typography.Text strong style={{ fontSize: 12, color: '#09090B' }}>
              {m.kind === 'command' ? '本地命令' : '命令执行结果'}
            </Typography.Text>
          </Space>
          <Space size={8}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {formatTime(m.time, '')}
            </Typography.Text>
            <Actions.Copy text={originalText} />
          </Space>
        </Flex>
        <pre
          className="mono-text"
          style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, color: '#27272A' }}
        >
          {originalText}
        </pre>
      </div>
    );
  }

  const translationDisabled = snapshot?.chatPreferences.provider === 'none';
  const hasText = Boolean(originalText.trim());
  const useBilingual = !translationDisabled && showChinese && !m.kind && hasText && (m.role === 'user' || m.role === 'assistant');
  const chineseText = translation?.originalChinese || translation?.chinese;
  const isPending = translation?.status === 'pending' || retrying;

  const displayAuthor = useBilingual
    ? m.role === 'assistant'
      ? `Claude · ${outputLangLabel}`
      : translation?.originalChinese
        ? '你的输入'
        : `你的消息 · ${outputLangLabel}译文`
    : m.role === 'user'
      ? '发给 Claude 的原文'
      : m.role === 'tool'
        ? '工具执行记录'
        : 'Claude 回复原文';

  const displayedContent = useBilingual
    ? chineseText ||
      (isPending
        ? `正在翻译为${outputLangLabel}…`
        : translation?.status === 'failed'
          ? `${outputLangLabel}翻译失败，请点击下方重试。`
          : `这条消息尚无${outputLangLabel}译文。`)
    : originalText;

  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    setRetryError('');
    try {
      await onRetry();
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={`bilingual-message chat-entry ${m.role}`}
      data-message-id={m.id}
      style={{ marginBottom: 20, width: '100%' }}
    >
      {hasText && (
        <Bubble
          placement={m.role === 'user' ? 'end' : 'start'}
          variant={m.role === 'user' ? 'filled' : 'borderless'}
          shape="round"
          avatar={
            m.role === 'user' ? undefined : (
              <Avatar
                size={24}
                style={{
                  backgroundColor: '#F4F4F5',
                  color: '#18181B',
                  border: '1px solid #E4E4E7',
                }}
                icon={<RobotOutlined style={{ fontSize: 12 }} />}
              />
            )
          }
          header={
            <Space size={8}>
              <strong style={{ fontSize: 12, color: '#27272A', fontWeight: 600 }}>{displayAuthor}</strong>
              <time style={{ fontSize: 11, color: '#A1A1AA' }}>{formatTime(m.time, '')}</time>
              {!useBilingual && (
                <Tag style={{ fontSize: 10.5, lineHeight: '16px', paddingInline: 6, margin: 0 }}>
                  {LANGUAGE_HINTS[m.languageHint] || '原始记录'}
                </Tag>
              )}
            </Space>
          }
          content={displayedContent}
          contentRender={(content) => (
            <div>
              {m.attachments && m.attachments.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <Image.PreviewGroup>
                    <Space wrap size={8}>
                      {m.attachments.map((att) =>
                        att.dataUrl ? (
                          <div
                            key={att.uid}
                            style={{ border: '1px solid #E4E4E7', borderRadius: 8, padding: 4, background: '#FFFFFF' }}
                          >
                            <Image
                              src={att.dataUrl}
                              alt={att.name}
                              width={120}
                              height={90}
                              style={{ objectFit: 'cover', borderRadius: 4 }}
                            />
                            <div
                              style={{
                                fontSize: 11,
                                color: '#71717A',
                                maxWidth: 120,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                marginTop: 2,
                              }}
                              title={att.path}
                            >
                              {att.name}
                            </div>
                          </div>
                        ) : (
                          <CopyFilePath key={att.uid} path={att.path}>
                            {att.name}
                          </CopyFilePath>
                        ),
                      )}
                    </Space>
                  </Image.PreviewGroup>
                </div>
              )}
              <RichMarkdown text={String(content || '')} />
            </div>
          )}
          footer={
            <Flex vertical gap={6} style={{ width: '100%' }}>
              <Space wrap size={4}>
                <Actions.Copy text={displayedContent} />
                <Button
                  type="text"
                  size="small"
                  icon={isCopied(`display-${m.id}`) ? <CheckOutlined style={{ color: '#666666' }} /> : <CopyOutlined />}
                  onClick={() =>
                    void copyText(
                      displayedContent,
                      `display-${m.id}`,
                      useBilingual ? `已复制${outputLangLabel}内容（含完整 Markdown）` : '已复制消息全文',
                    )
                  }
                  style={{ fontSize: 12, color: '#71717A' }}
                >
                  {useBilingual ? `复制${outputLangLabel}` : '复制全文'}
                </Button>

                {useBilingual && originalText && (
                  <>
                    <Button
                      type="text"
                      size="small"
                      icon={isCopied(`orig-${m.id}`) ? <CheckOutlined style={{ color: '#666666' }} /> : <GlobalOutlined />}
                      onClick={() => void copyText(originalText, `orig-${m.id}`, '已复制原文')}
                      style={{ fontSize: 12, color: '#71717A' }}
                    >
                      复制原文
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<TranslationOutlined />}
                      onClick={() => setShowOriginal((v) => !v)}
                      style={{ fontSize: 12, color: showOriginal ? '#09090B' : '#71717A', fontWeight: showOriginal ? 500 : 400 }}
                    >
                      {showOriginal ? '收起原文' : m.role === 'user' ? '查看发给 Claude 的原文' : '查看 Claude 回复原文'}
                    </Button>
                  </>
                )}

                {useBilingual && (!chineseText || translation?.status === 'failed') && !isPending && onRetry && (
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={retrying}
                    onClick={() => void handleRetry()}
                    style={{ fontSize: 12 }}
                  >
                    翻译这条消息
                  </Button>
                )}
              </Space>

              {retryError && (
                <Typography.Text type="danger" role="alert" style={{ fontSize: 12 }}>
                  {retryError}
                </Typography.Text>
              )}

              {useBilingual && m.role === 'user' && !translation?.originalChinese && chineseText && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  根据历史原文补译。
                </Typography.Text>
              )}

              {useBilingual && showOriginal && (
                <div
                  style={{
                    marginTop: 4,
                    padding: '10px 14px',
                    background: '#FAFAFA',
                    border: '1px dashed #D4D4D8',
                    borderRadius: 8,
                  }}
                >
                  <Flex justify="space-between" align="center" style={{ marginBottom: 6 }}>
                    <Tag style={{ fontSize: 11 }}>{LANGUAGE_HINTS[m.languageHint] || '原始记录'}</Tag>
                    <Button
                      type="link"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => void copyText(originalText, `raw-${m.id}`, '已复制原文')}
                      style={{ padding: 0, height: 'auto', fontSize: 11, color: '#52525B' }}
                    >
                      复制此段原文
                    </Button>
                  </Flex>
                  <RichMarkdown text={originalText} />
                </div>
              )}
            </Flex>
          }
          styles={{
            content: {
              background: m.role === 'user' ? '#F4F4F4' : 'transparent',
              borderRadius: m.role === 'user' ? 16 : 8,
              padding: m.role === 'user' ? '10px 16px' : '2px 0',
              maxWidth: '100%',
            },
          }}
        />
      )}

      {showChinese &&
        m.role === 'user' &&
        toolAnswers
          ?.filter((a) => a.turnRequestId === m.id && a.translated)
          .map((a) => (
            <div
              className="bilingual-block"
              key={a.approvalId + a.question}
              style={{
                marginTop: 8,
                marginLeft: 'auto',
                maxWidth: '85%',
                padding: '10px 14px',
                background: '#FAFAFA',
                border: '1px solid #E4E4E7',
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <strong style={{ display: 'block', color: '#18181B', marginBottom: 4 }}>给工具问题的中文回答</strong>
              <div style={{ color: '#71717A' }}>{a.question}</div>
              <div style={{ marginTop: 4, fontWeight: 500, color: '#09090B' }}>{a.source}</div>
            </div>
          ))}

      {toolBlocks.length > 0 && (
        <div style={{ marginTop: 8, paddingLeft: m.role === 'user' ? 0 : 40 }}>
          <ToolBlockCard messageId={m.id} blocks={toolBlocks} />
        </div>
      )}
    </div>
  );
};

export default BilingualBubble;
