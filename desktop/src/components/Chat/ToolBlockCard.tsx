import React, { useMemo, useState } from 'react';
import { CodeHighlighter } from '@ant-design/x';
import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, ExportOutlined, RightOutlined, WarningOutlined } from '@ant-design/icons';
import DiffViewer from '../Common/DiffViewer';
import { useClipboard } from '../../hooks/useClipboard';
import { useAgent } from '../../contexts/AgentContext';
import { normalizeWorkspaceRelativePath, useRightPanel } from '../../contexts/RightPanelContext';
import type { MessageBlock } from '../../services/types';

interface ToolBlockCardProps {
  messageId: string;
  blocks: MessageBlock[];
}

function inferLang(filePath?: string): string {
  const ext = filePath?.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    json: 'json',
    md: 'markdown',
    sh: 'bash',
    css: 'css',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return map[ext] || 'text';
}

function parseJsonSafe(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getTargetLabel(block: MessageBlock, parsed: Record<string, any> | null): string | null {
  if (block.type !== 'tool_use') return null;
  if (typeof parsed?.file_path === 'string') return parsed.file_path;
  if (typeof parsed?.pattern === 'string') return parsed.pattern;
  if (typeof parsed?.query === 'string') return parsed.query;
  if (typeof parsed?.command === 'string') {
    return parsed.command.slice(0, 48) + (parsed.command.length > 48 ? '…' : '');
  }
  return null;
}

function summarizeBlocks(blocks: MessageBlock[]): { label: string; hasError: boolean } {
  const hasError = blocks.some((b) => b.isError);
  const calls = blocks.filter((b) => b.type === 'tool_use');
  if (calls.length === 1) {
    const b = calls[0];
    const target = getTargetLabel(b, parseJsonSafe(b.text));
    return {
      label: target ? `已调用 ${b.name || 'Tool'} · ${target}` : `已调用 ${b.name || 'Tool'}`,
      hasError,
    };
  }
  if (calls.length > 1) {
    const names = [...new Set(calls.map((c) => c.name || 'Tool'))];
    const preview = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${calls.length} 项` : '');
    return {
      label: `已执行 ${calls.length} 次工具调用（${preview}）`,
      hasError,
    };
  }
  return {
    label: hasError ? `工具返回 ${blocks.length} 条错误` : `工具输出（${blocks.length} 条）`,
    hasError,
  };
}

const ToolBlockBody: React.FC<{ block: MessageBlock }> = ({ block }) => {
  const parsed = useMemo(() => (block.type === 'tool_use' ? parseJsonSafe(block.text) : null), [block]);

  if (block.type === 'tool_use' && parsed) {
    if (block.name === 'Edit' && typeof parsed.file_path === 'string') {
      return (
        <DiffViewer
          filePath={parsed.file_path}
          oldText={typeof parsed.old_string === 'string' ? parsed.old_string : ''}
          newText={typeof parsed.new_string === 'string' ? parsed.new_string : ''}
          maxHeight={300}
        />
      );
    }
    if (block.name === 'MultiEdit' && typeof parsed.file_path === 'string' && Array.isArray(parsed.edits)) {
      return (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {parsed.edits.map((edit: any, idx: number) => (
            <DiffViewer
              key={idx}
              filePath={`${parsed.file_path} (#${idx + 1})`}
              oldText={typeof edit?.old_string === 'string' ? edit.old_string : ''}
              newText={typeof edit?.new_string === 'string' ? edit.new_string : ''}
              maxHeight={240}
            />
          ))}
        </Space>
      );
    }
    if (block.name === 'Write' && typeof parsed.file_path === 'string' && typeof parsed.content === 'string') {
      return (
        <div>
          <Tag className="mono-text" style={{ marginBottom: 6 }}>
            {parsed.file_path}
          </Tag>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <CodeHighlighter lang={inferLang(parsed.file_path)}>{parsed.content}</CodeHighlighter>
          </div>
        </div>
      );
    }
    if (block.name === 'Bash' && typeof parsed.command === 'string') {
      return (
        <div>
          {typeof parsed.description === 'string' && parsed.description && (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
              {parsed.description}
            </Typography.Text>
          )}
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <CodeHighlighter lang="bash">{parsed.command}</CodeHighlighter>
          </div>
        </div>
      );
    }
  }

  return (
    <div style={{ maxHeight: 260, overflow: 'auto' }}>
      <CodeHighlighter lang={block.type === 'tool_use' ? 'json' : 'text'}>{block.text}</CodeHighlighter>
    </div>
  );
};

export const ToolBlockCard: React.FC<ToolBlockCardProps> = ({ messageId, blocks }) => {
  const { copyText } = useClipboard();
  const { projectId, currentProject } = useAgent();
  const { openFile } = useRightPanel();
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => summarizeBlocks(blocks), [blocks]);

  if (!blocks.length) return null;

  return (
    <div style={{ margin: '2px 0' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 4px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: summary.hasError ? '#DC2626' : '#8C8C8C',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {summary.hasError && <WarningOutlined style={{ fontSize: 11.5 }} />}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 520,
          }}
        >
          {summary.label}
        </span>
        <RightOutlined
          style={{
            fontSize: 10,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 6,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#FAFAFA',
            border: '1px solid #EFEFEF',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {blocks.map((b, i) => {
            const parsed = b.type === 'tool_use' ? parseJsonSafe(b.text) : null;
            const target = getTargetLabel(b, parsed);
            return (
              <div key={`${messageId}-tool-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Space size={6} wrap>
                    <Typography.Text
                      style={{
                        fontSize: 11.5,
                        color: b.isError ? '#DC2626' : '#52525B',
                        fontWeight: 500,
                      }}
                    >
                      {b.type === 'tool_use' ? b.name || 'Tool' : b.isError ? '错误输出' : '执行结果'}
                    </Typography.Text>
                    {target && (
                      <Typography.Text className="mono-text" type="secondary" style={{ fontSize: 11 }}>
                        {target}
                      </Typography.Text>
                    )}
                  </Space>
                  <Space size={2}>
                    {b.type === 'tool_use' && typeof parsed?.file_path === 'string' && projectId && (() => {
                      const rel = normalizeWorkspaceRelativePath(parsed.file_path, currentProject?.root);
                      if (!rel || rel === '.') return null;
                      return (
                        <Tooltip title={`在右侧标签页打开 ${rel}`}>
                          <Button
                            type="text"
                            size="small"
                            icon={<ExportOutlined />}
                            onClick={() => openFile(rel)}
                            style={{ fontSize: 11, color: '#52525B', height: 22, padding: '0 6px' }}
                          >
                            打开
                          </Button>
                        </Tooltip>
                      );
                    })()}
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => void copyText(b.text, `tool-${messageId}-${i}`, '已复制')}
                      style={{ fontSize: 11, color: '#8C8C8C', height: 22, padding: '0 4px' }}
                    />
                  </Space>
                </div>
                <ToolBlockBody block={b} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ToolBlockCard;
