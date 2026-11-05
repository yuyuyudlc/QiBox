import React from 'react';
import { Button, Tooltip } from 'antd';
import { CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import { useAgent } from '../../contexts/AgentContext';
import { normalizeWorkspaceRelativePath, useRightPanel } from '../../contexts/RightPanelContext';
import { useClipboard } from '../../hooks/useClipboard';

export const CopyFilePath: React.FC<{ path: string; children?: React.ReactNode }> = ({ path, children }) => {
  const { projectId, currentProject } = useAgent();
  const { openFile } = useRightPanel();
  const { copyText } = useClipboard();
  const relPath = projectId ? normalizeWorkspaceRelativePath(path, currentProject?.root) : null;
  const fullPath = path.startsWith('/') || !currentProject?.root
    ? path
    : `${currentProject.root.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%', verticalAlign: 'middle' }}>
      <Tooltip title={relPath && relPath !== '.' ? `在右侧工作台打开：${relPath}` : `复制路径：${fullPath}`}>
        <Button
          size="small"
          icon={<FileTextOutlined />}
          aria-label={relPath && relPath !== '.' ? `在右侧打开文件：${relPath}` : `复制文件路径：${fullPath}`}
          onClick={() => {
            if (relPath && relPath !== '.' && openFile(relPath)) return;
            void copyText(fullPath, fullPath, '路径已复制');
          }}
          style={{ marginInlineStart: 2, fontFamily: 'var(--font-mono)', fontSize: 12, maxWidth: '100%' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children || path}</span>
        </Button>
      </Tooltip>
      {relPath && relPath !== '.' && (
        <Tooltip title={`复制完整路径：${fullPath}`}>
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined style={{ fontSize: 11 }} />}
            aria-label={`复制路径：${fullPath}`}
            onClick={() => void copyText(fullPath, fullPath, '路径已复制')}
            style={{ width: 22, height: 22, padding: 0, color: '#71717A', flexShrink: 0 }}
          />
        </Tooltip>
      )}
    </span>
  );
};
