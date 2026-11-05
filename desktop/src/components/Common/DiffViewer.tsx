import React, { useMemo } from 'react';
import { Button, Empty, Flex, Tag, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useClipboard } from '../../hooks/useClipboard';

interface DiffViewerProps {
  diffText?: string;
  oldText?: string;
  newText?: string;
  filePath?: string;
  maxHeight?: number | string;
}

interface DiffLine {
  type: 'add' | 'del' | 'hunk' | 'meta' | 'ctx';
  text: string;
}

function parseUnifiedDiff(diffText: string): DiffLine[] {
  return diffText.split('\n').map((line) => {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      return { type: 'meta', text: line };
    }
    if (line.startsWith('@@')) return { type: 'hunk', text: line };
    if (line.startsWith('+')) return { type: 'add', text: line };
    if (line.startsWith('-')) return { type: 'del', text: line };
    return { type: 'ctx', text: line };
  });
}

function buildInlineDiffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lines: DiffLine[] = [];

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const ctxBefore = oldLines.slice(Math.max(0, start - 2), start);
  const ctxAfter = oldLines.slice(oldEnd + 1, Math.min(oldLines.length, oldEnd + 3));

  for (const l of ctxBefore) lines.push({ type: 'ctx', text: ` ${l}` });
  for (let i = start; i <= oldEnd; i++) lines.push({ type: 'del', text: `-${oldLines[i]}` });
  for (let i = start; i <= newEnd; i++) lines.push({ type: 'add', text: `+${newLines[i]}` });
  for (const l of ctxAfter) lines.push({ type: 'ctx', text: ` ${l}` });

  return lines;
}

const LINE_STYLE: Record<DiffLine['type'], React.CSSProperties> = {
  add: { background: '#ECFDF5', color: '#065F46' },
  del: { background: '#FEF2F2', color: '#991B1B' },
  hunk: { background: '#EFF6FF', color: '#1D4ED8', fontWeight: 500 },
  meta: { background: '#F4F4F5', color: '#71717A', fontWeight: 500 },
  ctx: { background: '#FFFFFF', color: '#27272A' },
};

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diffText,
  oldText,
  newText,
  filePath,
  maxHeight = 420,
}) => {
  const { copyText } = useClipboard();

  const lines = useMemo(() => {
    if (diffText !== undefined) {
      return diffText.trim() ? parseUnifiedDiff(diffText) : [];
    }
    if (oldText !== undefined || newText !== undefined) {
      return buildInlineDiffLines(oldText || '', newText || '');
    }
    return [];
  }, [diffText, oldText, newText]);

  const rawCopyText = useMemo(() => {
    if (diffText !== undefined) return diffText;
    return lines.map((l) => l.text).join('\n');
  }, [diffText, lines]);

  if (!lines.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无代码差异" />;
  }

  return (
    <div
      style={{
        border: '1px solid #E4E4E7',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#FFFFFF',
      }}
    >
      {filePath && (
        <Flex
          justify="space-between"
          align="center"
          style={{
            padding: '6px 10px',
            background: '#FAFAFA',
            borderBottom: '1px solid #E4E4E7',
          }}
        >
          <Tag className="mono-text" style={{ margin: 0, fontSize: 11.5 }}>
            {filePath}
          </Tag>
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => void copyText(rawCopyText, `diff-${filePath}`, 'Diff 已复制')}
            style={{ fontSize: 11, color: '#71717A' }}
          >
            复制
          </Button>
        </Flex>
      )}
      <div
        className="mono-text"
        style={{
          maxHeight,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        {lines.map((line, idx) => (
          <div
            key={idx}
            style={{
              ...LINE_STYLE[line.type],
              padding: '1px 10px',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              borderBottom: line.type === 'meta' ? '1px solid #E4E4E7' : undefined,
            }}
          >
            <Typography.Text style={{ color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit' }}>
              {line.text || ' '}
            </Typography.Text>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DiffViewer;
