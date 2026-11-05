import React, { useState } from 'react';
import { CodeHighlighter } from '@ant-design/x';
import { Alert, Button, Card, Checkbox, Flex, Input, Radio, Space, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, CopyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useClipboard } from '../../hooks/useClipboard';
import type { ApprovalQuestion, ApprovalRequest } from '../../services/types';

interface ApprovalCardProps {
  request: ApprovalRequest;
  onRespond: (allow: boolean, answers?: Record<string, string>) => Promise<void>;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ request, onRespond }) => {
  const { copyText } = useClipboard();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleRespond = async (allow: boolean) => {
    setBusy(true);
    setError('');
    try {
      await onRespond(allow, request.kind === 'question' ? answers : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePickOption = (q: ApprovalQuestion, label: string, checked: boolean) => {
    setAnswers((prev) => {
      if (!q.multiSelect) return { ...prev, [q.question]: label };
      const list = (prev[q.question] || '').split(', ').filter(Boolean);
      return { ...prev, [q.question]: (checked ? [...list, label] : list.filter((v) => v !== label)).join(', ') };
    });
  };

  const formattedInput = JSON.stringify(request.input, null, 2);
  const commandPreview =
    typeof request.input?.command === 'string'
      ? request.input.command
      : typeof request.input?.file_path === 'string'
        ? request.input.file_path
        : null;
  const incomplete = request.kind === 'question' && request.input.questions?.some((q) => !answers[q.question]?.trim());

  return (
    <Card
      className="approval-card"
      size="small"
      style={{ border: '1px solid #DEDEDE', background: '#FAFAFA', borderRadius: 10, margin: '14px 0' }}
      title={
        <Space>
          <SafetyCertificateOutlined style={{ color: '#666666', fontSize: 15 }} />
          <strong style={{ color: '#262626', fontSize: 13 }}>
            {request.kind === 'question' ? 'Claude 需要你的回答' : `请求使用工具：${request.toolName}`}
          </strong>
          {commandPreview && (
            <Tag className="mono-text" style={{ background: '#EFEFEF', borderColor: '#DEDEDE', color: '#525252' }}>
              {commandPreview.slice(0, 60)}
              {commandPreview.length > 60 ? '…' : ''}
            </Tag>
          )}
        </Space>
      }
      extra={
        request.kind !== 'question' && (
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => void copyText(formattedInput, request.requestId, '审批参数已复制')}
          >
            复制参数
          </Button>
        )
      }
    >
      {request.kind === 'question' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={14}>
          {request.input.questions?.map((q) => (
            <div key={q.question} className="approval-question">
              <Typography.Paragraph strong style={{ marginBottom: 8, color: '#09090B' }}>
                {q.question}
              </Typography.Paragraph>
              <div className="question-options" style={{ display: 'grid', gap: 8 }}>
                {q.options.map((o) => {
                  const isChecked = q.multiSelect
                    ? (answers[q.question] || '').split(', ').includes(o.label)
                    : answers[q.question] === o.label;
                  const ChoiceControl = q.multiSelect ? Checkbox : Radio;
                  return (
                    <label
                      key={o.label}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: `1px solid ${isChecked ? '#B3B3B3' : '#E4E4E7'}`,
                        background: isChecked ? '#EBEBEB' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                    >
                      <ChoiceControl checked={isChecked} onChange={(e) => handlePickOption(q, o.label, e.target.checked)} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 12.5, color: '#09090B' }}>{o.label}</div>
                        {o.description && (
                          <div style={{ fontSize: 11.5, color: '#71717A', marginTop: 2 }}>{o.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              <Input
                className="question-free"
                aria-label="补充回答"
                placeholder="或直接填写回答（跟随本轮输入语言设置）"
                value={answers[q.question] || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.question]: e.target.value }))}
                style={{ marginTop: 10 }}
              />
            </div>
          ))}
        </Space>
      ) : (
        <div style={{ maxHeight: 280, overflow: 'auto' }}>
          <CodeHighlighter lang="json">{formattedInput}</CodeHighlighter>
        </div>
      )}

      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 10 }} />}

      <Flex justify="flex-end" gap={10} className="approval-actions" style={{ marginTop: 14 }}>
        <Button danger icon={<CloseOutlined />} disabled={busy} onClick={() => void handleRespond(false)}>
          拒绝
        </Button>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={busy}
          disabled={busy || incomplete}
          onClick={() => void handleRespond(true)}
        >
          {busy ? '提交中…' : request.kind === 'question' ? '提交答案' : '允许这一次'}
        </Button>
      </Flex>
    </Card>
  );
};

export default ApprovalCard;
