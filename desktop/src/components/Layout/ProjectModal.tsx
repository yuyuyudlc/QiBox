import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Flex, Input, List, Modal, Segmented, Space, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, FolderOpenOutlined, FolderOutlined, MessageOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { workspaceService, type WorkspaceFileEntry } from '../../services/workspace';
import type { Project } from '../../services/types';

interface ProjectModalProps {
  open: boolean;
  projects: Project[];
  currentProjectId: string;
  onClose: () => void;
  onSelectAndStart: (projectId: string) => Promise<void>;
  onCreateProject: (name: string, path: string, startSession: boolean) => Promise<void>;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  open,
  projects,
  currentProjectId,
  onClose,
  onSelectAndStart,
  onCreateProject,
}) => {
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [name, setName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 工作区目录浏览器状态（基于 legacy 根 /workspace）
  const [browsePath, setBrowsePath] = useState('.');
  const [workspaceRoot, setWorkspaceRoot] = useState('/workspace');
  const [dirs, setDirs] = useState<WorkspaceFileEntry[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(false);

  const loadDirs = useCallback(async (targetPath: string) => {
    setLoadingDirs(true);
    setError('');
    try {
      const res = await workspaceService.listFiles('legacy', targetPath);
      setWorkspaceRoot(res.root || '/workspace');
      setBrowsePath(res.path || '.');
      setDirs(res.entries.filter((e) => e.type === 'directory'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDirs([]);
    } finally {
      setLoadingDirs(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError('');
      void loadDirs('.');
    }
  }, [open, loadDirs]);

  const currentAbsPath = browsePath === '.' ? workspaceRoot : `${workspaceRoot}/${browsePath}`;
  const matchedProject = projects.find((p) => p.root === currentAbsPath);

  const handleGoUp = () => {
    if (browsePath === '.' || !browsePath) return;
    const parts = browsePath.split('/').filter(Boolean);
    parts.pop();
    void loadDirs(parts.length ? parts.join('/') : '.');
  };

  const handleEnterDir = (dirName: string) => {
    const next = browsePath === '.' ? dirName : `${browsePath}/${dirName}`;
    void loadDirs(next);
  };

  const handleUseCurrentDir = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (matchedProject) {
        await onSelectAndStart(matchedProject.id);
      } else {
        const folderName = browsePath.split('/').filter(Boolean).pop() || 'project';
        await onCreateProject(folderName, currentAbsPath, true);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (startSession: boolean) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreateProject(name.trim(), customPath.trim(), startSession);
      setName('');
      setCustomPath('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePickRegistered = async (projectId: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSelectAndStart(projectId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="项目与工作目录"
      open={open}
      onCancel={() => !busy && onClose()}
      footer={
        mode === 'create' ? (
          <Flex justify="end" gap={8}>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button disabled={busy || !name.trim()} onClick={() => void handleCreate(false)}>
              仅创建项目
            </Button>
            <Button type="primary" loading={busy} disabled={!name.trim()} onClick={() => void handleCreate(true)}>
              创建并开启对话
            </Button>
          </Flex>
        ) : (
          <Flex justify="end">
            <Button disabled={busy} onClick={onClose}>
              关闭
            </Button>
          </Flex>
        )
      }
      width={560}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Segmented
          block
          value={mode}
          onChange={(v) => {
            setError('');
            setMode(v as 'existing' | 'create');
          }}
          options={[
            { label: '选择已有项目 / 目录', value: 'existing', icon: <FolderOpenOutlined /> },
            { label: '新建项目', value: 'create', icon: <PlusOutlined /> },
          ]}
        />

        {mode === 'existing' ? (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <div>
              <Typography.Text strong style={{ fontSize: 12, color: '#52525B' }}>
                已登记项目
              </Typography.Text>
              <List
                size="small"
                bordered
                style={{ marginTop: 6, maxHeight: 168, overflow: 'auto', borderRadius: 8 }}
                dataSource={projects}
                renderItem={(p) => (
                  <List.Item
                    style={{ padding: '8px 12px' }}
                    actions={[
                      <Button
                        key="start"
                        size="small"
                        type={p.id === currentProjectId ? 'default' : 'primary'}
                        icon={<MessageOutlined />}
                        loading={busy}
                        onClick={() => void handlePickRegistered(p.id)}
                      >
                        开启对话
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
                      <Space size={6}>
                        <Typography.Text strong style={{ fontSize: 13 }}>
                          {p.name}
                        </Typography.Text>
                        {p.id === currentProjectId && <Tag style={{ margin: 0, fontSize: 11 }}>当前</Tag>}
                      </Space>
                      <Typography.Text className="mono-text" type="secondary" style={{ fontSize: 11 }}>
                        {p.root}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>

            <div>
              <Flex justify="space-between" align="center" style={{ marginBottom: 6 }}>
                <Typography.Text strong style={{ fontSize: 12, color: '#52525B' }}>
                  浏览 WSL 工作区目录
                </Typography.Text>
                <Space size={4}>
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowLeftOutlined />}
                    disabled={browsePath === '.' || loadingDirs}
                    onClick={handleGoUp}
                  >
                    上级
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined spin={loadingDirs} />}
                    onClick={() => void loadDirs(browsePath)}
                  />
                </Space>
              </Flex>

              <Flex
                justify="space-between"
                align="center"
                gap={8}
                style={{
                  padding: '6px 10px',
                  background: '#FAFAFA',
                  border: '1px solid #E4E4E7',
                  borderBottom: 'none',
                  borderRadius: '8px 8px 0 0',
                }}
              >
                <Typography.Text className="mono-text" ellipsis style={{ fontSize: 12, color: '#18181B' }}>
                  {currentAbsPath}
                </Typography.Text>
                <Button
                  size="small"
                  type="primary"
                  loading={busy}
                  onClick={() => void handleUseCurrentDir()}
                >
                  {matchedProject ? `打开“${matchedProject.name}”并对话` : '用此目录开启对话'}
                </Button>
              </Flex>

              <div
                style={{
                  border: '1px solid #E4E4E7',
                  borderRadius: '0 0 8px 8px',
                  maxHeight: 160,
                  overflow: 'auto',
                  background: '#FFFFFF',
                }}
              >
                {dirs.length > 0 ? (
                  <List
                    size="small"
                    dataSource={dirs}
                    renderItem={(d) => (
                      <List.Item
                        onClick={() => handleEnterDir(d.name)}
                        style={{ cursor: 'pointer', padding: '6px 12px' }}
                      >
                        <Space size={8}>
                          <FolderOutlined style={{ color: '#52525B' }} />
                          <Typography.Text style={{ fontSize: 12.5 }}>{d.name}</Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={loadingDirs ? '正在读取目录…' : '当前目录下没有子文件夹'}
                    style={{ margin: '16px 0' }}
                  />
                )}
              </div>
            </div>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Typography.Text strong style={{ fontSize: 12 }}>
                项目名称
              </Typography.Text>
              <Input
                aria-label="项目名称"
                placeholder="例如：my-webapp"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                style={{ marginTop: 4 }}
              />
            </div>
            <div>
              <Typography.Text strong style={{ fontSize: 12 }}>
                工作区目录（可选）
              </Typography.Text>
              <Input
                aria-label="项目目录"
                placeholder={
                  name.trim()
                    ? `留空默认使用 ${workspaceRoot.replace(/\/+$/, '')}/projects/${name.trim()}`
                    : '留空后目录名与项目名称相同'
                }
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                disabled={busy}
                style={{ marginTop: 4 }}
              />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              同一项目下的对话共享同一工作目录；也可以填入已有目录复用原文件。
            </Typography.Text>
          </Space>
        )}

        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Modal>
  );
};

export default ProjectModal;
