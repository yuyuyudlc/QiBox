import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Input, Tooltip } from 'antd';
import { workspaceService } from '../../services/workspace';
import FilePreviewTab from './FilePreviewTab';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FolderIcon,
  FolderOpenIcon,
  PanelLeftIcon,
  PaperclipIcon,
  RefreshCwIcon,
} from './WorkbenchIcons';

interface FileExplorerPanelProps {
  projectId: string;
  onMentionFile?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  children?: TreeNode[];
}

const SKIP_ENTRIES = new Set(['.git', 'node_modules', 'dist', 'target']);

function toTreeNodes(
  entries: { name: string; type: 'file' | 'directory' | 'symlink' }[],
  parentPath: string,
): TreeNode[] {
  return entries
    .filter((e) => !SKIP_ENTRIES.has(e.name))
    .map((e) => {
      const fullPath = parentPath === '.' ? e.name : `${parentPath}/${e.name}`;
      return {
        name: e.name,
        path: fullPath,
        type: e.type,
        ...(e.type === 'directory' ? { children: [] } : {}),
      };
    });
}

function insertTreeChildren(
  nodes: TreeNode[],
  targetPath: string,
  children: TreeNode[],
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.children?.length) {
      return {
        ...node,
        children: insertTreeChildren(node.children, targetPath, children),
      };
    }
    return node;
  });
}

export const FileExplorerPanel: React.FC<FileExplorerPanelProps> = ({
  projectId,
  onMentionFile,
  onOpenFile,
}) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [treeDrawerOpen, setTreeDrawerOpen] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadedDirsRef = useRef<Set<string>>(new Set());

  const loadRoot = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    loadedDirsRef.current.clear();
    try {
      const res = await workspaceService.listFiles(projectId, '.');
      setTreeData(toTreeNodes(res.entries, '.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTreeData([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  const handleToggleDirectory = useCallback(
    async (dirPath: string) => {
      const isCurrentlyExpanded = Boolean(expandedDirs[dirPath]);
      setExpandedDirs((prev) => ({ ...prev, [dirPath]: !isCurrentlyExpanded }));

      if (!isCurrentlyExpanded && !loadedDirsRef.current.has(dirPath)) {
        loadedDirsRef.current.add(dirPath);
        try {
          const res = await workspaceService.listFiles(projectId, dirPath);
          const childNodes = toTreeNodes(res.entries, dirPath);
          setTreeData((prev) => insertTreeChildren(prev, dirPath, childNodes));
        } catch {
          loadedDirsRef.current.delete(dirPath);
        }
      }
    },
    [expandedDirs, projectId],
  );

  const flatVisibleNodes = useMemo(() => {
    const out: Array<{ node: TreeNode; depth: number }> = [];
    const q = searchQuery.trim().toLowerCase();

    const walk = (list: TreeNode[], depth: number) => {
      for (const item of list) {
        const matches = !q || item.path.toLowerCase().includes(q);
        if (matches) {
          out.push({ node: item, depth });
        }
        if (item.type === 'directory' && (expandedDirs[item.path] || q) && item.children) {
          walk(item.children, depth + 1);
        }
      }
    };
    walk(treeData, 0);
    return out;
  }, [treeData, expandedDirs, searchQuery]);

  // If a file is selected and the tree drawer is collapsed, show full-width FilePreviewTab with a tree toggle button
  if (selectedFile && !treeDrawerOpen) {
    return (
      <FilePreviewTab
        projectId={projectId}
        relativePath={selectedFile}
        onMentionFile={onMentionFile}
        leadingAction={
          <Tooltip title="展开目录树 (Files)">
            <button
              type="button"
              className="qibox-workbench-icon-btn"
              onClick={() => setTreeDrawerOpen(true)}
            >
              <PanelLeftIcon size={13.5} />
            </button>
          </Tooltip>
        }
      />
    );
  }

  return (
    <div className="qibox-surface-container">
      {/* Sticky Files Toolbar */}
      <div className="qibox-surface-toolbar">
        <div className="qibox-surface-toolbar-left" style={{ flex: 1 }}>
          <Input
            size="small"
            allowClear
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="筛选工作区文件..."
            style={{ maxWidth: 240, borderRadius: 7, fontSize: 12 }}
          />
          {selectedFile && (
            <button
              type="button"
              className="qibox-toolbar-ghost-btn"
              onClick={() => setTreeDrawerOpen(false)}
              title="返回当前文件预览"
            >
              <FileCodeIcon size={12.5} />
              <span className="mono">{selectedFile.split('/').pop()}</span>
            </button>
          )}
        </div>
        <div className="qibox-surface-toolbar-right">
          <Tooltip title="刷新目录树">
            <button
              type="button"
              className="qibox-workbench-icon-btn"
              onClick={() => void loadRoot()}
            >
              <RefreshCwIcon size={13.5} spin={loading} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Clean Single-Column File Tree List */}
      <div className="qibox-file-tree-list">
        {error ? (
          <div style={{ padding: 20, color: '#DC2626', fontSize: 12 }}>{error}</div>
        ) : !loading && flatVisibleNodes.length === 0 ? (
          <div style={{ padding: 40 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={searchQuery ? '无匹配文件' : '当前项目目录暂无文件'}
            />
          </div>
        ) : (
          flatVisibleNodes.map(({ node, depth }) => {
            const isDir = node.type === 'directory';
            const expanded = Boolean(expandedDirs[node.path]);
            const isSelected = node.path === selectedFile;

            return (
              <div
                key={node.path}
                className={`qibox-file-tree-row ${isSelected ? 'is-selected' : ''}`}
                style={{ paddingLeft: 10 + depth * 16 }}
                onClick={() => {
                  if (isDir) {
                    void handleToggleDirectory(node.path);
                  } else {
                    setSelectedFile(node.path);
                    setTreeDrawerOpen(false);
                  }
                }}
              >
                <div className="qibox-file-tree-main">
                  <span style={{ color: '#71717A', display: 'inline-flex', width: 14 }}>
                    {isDir ? (
                      expanded ? (
                        <ChevronDownIcon size={13} />
                      ) : (
                        <ChevronRightIcon size={13} />
                      )
                    ) : null}
                  </span>
                  <span style={{ color: isDir ? '#52525B' : '#71717A', display: 'inline-flex' }}>
                    {isDir ? (
                      expanded ? (
                        <FolderOpenIcon size={14} />
                      ) : (
                        <FolderIcon size={14} />
                      )
                    ) : (
                      <FileCodeIcon size={14} />
                    )}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12.5,
                      color: isDir ? '#18181B' : '#27272A',
                      fontWeight: isDir ? 500 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {node.name}
                  </span>
                </div>

                {!isDir && (
                  <div
                    className="qibox-file-tree-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onMentionFile && (
                      <Tooltip title="引用到对话 (@)">
                        <button
                          type="button"
                          className="qibox-workbench-icon-btn"
                          onClick={() => onMentionFile(node.path)}
                        >
                          <PaperclipIcon size={12.5} />
                        </button>
                      </Tooltip>
                    )}
                    {onOpenFile && (
                      <Tooltip title="在独立标签页中固定打开">
                        <button
                          type="button"
                          className="qibox-workbench-icon-btn"
                          onClick={() => onOpenFile(node.path)}
                        >
                          <ExternalLinkIcon size={12.5} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FileExplorerPanel;
