import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Segmented, Spin, Tooltip } from 'antd';
import { workspaceService } from '../../services/workspace';
import { useClipboard } from '../../hooks/useClipboard';
import RichMarkdown from '../Chat/RichMarkdown';
import {
  CopyIcon,
  FileCodeIcon,
  PaperclipIcon,
  RefreshCwIcon,
} from './WorkbenchIcons';

interface FilePreviewTabProps {
  projectId: string;
  projectRoot?: string;
  relativePath: string;
  revealRequestId?: number;
  onMentionFile?: (path: string) => void;
  leadingAction?: React.ReactNode;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FilePreviewTab: React.FC<FilePreviewTabProps> = ({
  projectId,
  projectRoot,
  relativePath,
  revealRequestId = 0,
  onMentionFile,
  leadingAction,
}) => {
  const { copyText } = useClipboard();
  const [content, setContent] = useState<string>('');
  const [bytes, setBytes] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMarkdown = /\.(md|mdx)$/i.test(relativePath);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>(isMarkdown ? 'preview' : 'raw');
  const [lineRange, setLineRange] = useState<{ start: number; end: number } | null>(null);

  const loadFile = useCallback(async () => {
    if (!projectId || !relativePath) return;
    setLoading(true);
    setError('');
    setLineRange(null);
    try {
      const res = await workspaceService.readFile(projectId, relativePath);
      setContent(res.text);
      setBytes(res.bytes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setContent('');
    } finally {
      setLoading(false);
    }
  }, [projectId, relativePath]);

  useEffect(() => {
    setViewMode(/\.(md|mdx)$/i.test(relativePath) ? 'preview' : 'raw');
    setLineRange(null);
  }, [relativePath]);

  useEffect(() => {
    void loadFile();
  }, [loadFile, revealRequestId]);

  const lines = useMemo(() => (content ? content.split('\n') : []), [content]);
  const fullPath = useMemo(() => {
    if (!projectRoot || relativePath.startsWith('/')) return relativePath;
    return `${projectRoot.replace(/\/+$/, '')}/${relativePath.replace(/^\.\//, '')}`;
  }, [projectRoot, relativePath]);

  const handleLineClick = (lineNumber: number, shiftKey: boolean) => {
    setLineRange((prev) => {
      if (!prev || !shiftKey) {
        if (prev && prev.start === lineNumber && prev.end === lineNumber) return null;
        return { start: lineNumber, end: lineNumber };
      }
      const start = Math.min(prev.start, lineNumber);
      const end = Math.max(prev.start, lineNumber);
      return { start, end };
    });
  };

  const mentionTarget = useMemo(() => {
    if (!lineRange) return relativePath;
    if (lineRange.start === lineRange.end) return `${relativePath}:${lineRange.start}`;
    return `${relativePath}:${lineRange.start}-${lineRange.end}`;
  }, [relativePath, lineRange]);

  const breadcrumbs = useMemo(() => relativePath.split('/').filter(Boolean), [relativePath]);

  return (
    <div className="qibox-surface-container">
      {/* Sticky File Breadcrumb Toolbar */}
      <div className="qibox-surface-toolbar">
        <div className="qibox-surface-toolbar-left" style={{ minWidth: 0, flex: 1 }}>
          {leadingAction}
          <FileCodeIcon size={13.5} style={{ color: '#71717A', flexShrink: 0 }} />
          <div
            className="mono"
            style={{
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title={fullPath}
          >
            {breadcrumbs.map((part, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={`${part}-${idx}`}>
                  {idx > 0 && <span style={{ color: '#D4D4D8' }}>/</span>}
                  <span
                    style={{
                      color: isLast ? '#09090B' : '#71717A',
                      fontWeight: isLast ? 600 : 400,
                    }}
                  >
                    {part}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          {!loading && !error && (
            <span style={{ fontSize: 11, color: '#A1A1AA', flexShrink: 0 }}>
              {lines.length} 行 · {formatBytes(bytes)}
            </span>
          )}
        </div>

        <div className="qibox-surface-toolbar-right">
          {isMarkdown && (
            <Segmented
              size="small"
              value={viewMode}
              onChange={(v) => setViewMode(v as 'preview' | 'raw')}
              options={[
                { value: 'preview', label: '预览' },
                { value: 'raw', label: '源码' },
              ]}
            />
          )}

          {onMentionFile && (
            <Tooltip title="点击代码行号可精确引用行区间（Shift 多选）">
              <button
                type="button"
                className="qibox-toolbar-ghost-btn"
                onClick={() => onMentionFile(mentionTarget)}
                style={
                  lineRange
                    ? { background: '#EFF6FF', borderColor: '#BFDBFE', color: '#1D4ED8' }
                    : undefined
                }
              >
                <PaperclipIcon size={12} />
                <span>
                  {lineRange
                    ? lineRange.start === lineRange.end
                      ? `@L${lineRange.start}`
                      : `@L${lineRange.start}-${lineRange.end}`
                    : '引用 @'}
                </span>
              </button>
            </Tooltip>
          )}

          <Tooltip title="复制文件内容">
            <button
              type="button"
              className="qibox-workbench-icon-btn"
              onClick={() => void copyText(content, `file-body-${relativePath}`, '文件内容已复制')}
            >
              <CopyIcon size={13} />
            </button>
          </Tooltip>

          <Tooltip title="重新读取">
            <button
              type="button"
              className="qibox-workbench-icon-btn"
              onClick={() => void loadFile()}
            >
              <RefreshCwIcon size={13} spin={loading} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Edge-to-Edge Code / Markdown Viewport */}
      <div className="qibox-file-viewport">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Spin size="small" />
          </div>
        ) : error ? (
          <div style={{ padding: 16 }}>
            <Alert
              type="warning"
              showIcon
              message={
                error === 'BINARY_FILE'
                  ? '该文件为二进制文件，暂不支持直接文本预览'
                  : error === 'FILE_TOO_LARGE'
                    ? '文件超过直接预览体积限制（700 KB）'
                    : error
              }
            />
          </div>
        ) : isMarkdown && viewMode === 'preview' ? (
          <div style={{ padding: '16px 20px' }}>
            <RichMarkdown text={content} />
          </div>
        ) : (
          <div className="qibox-code-table mono">
            {lines.map((lineText, idx) => {
              const ln = idx + 1;
              const isSelected =
                lineRange !== null && ln >= lineRange.start && ln <= lineRange.end;
              return (
                <div
                  key={ln}
                  className={`qibox-code-row ${isSelected ? 'is-selected' : ''}`}
                >
                  <button
                    type="button"
                    className="qibox-code-gutter"
                    onClick={(e) => handleLineClick(ln, e.shiftKey)}
                    title="点击选择该行，按住 Shift 点击可选择多行范围"
                  >
                    {ln}
                  </button>
                  <pre className="qibox-code-cell">{lineText || ' '}</pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FilePreviewTab;
