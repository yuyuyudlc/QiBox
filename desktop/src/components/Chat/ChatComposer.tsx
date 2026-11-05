import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Attachments, Sender, Suggestion } from '@ant-design/x';
import type { GetRef } from 'antd';
import { Alert, Button, Flex, Space, Typography } from 'antd';
import {
  CodeOutlined,
  FileImageOutlined,
  PaperClipOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAgent } from '../../contexts/AgentContext';
import { analyzePastedText } from '../../hooks/useClipboard';
import { useDraftState, useUnsavedChanges } from '../../hooks/useDraftState';
import { useWorkspaceFiles } from '../../hooks/useWorkspaceFiles';
import ComposerQuickBar from './ComposerQuickBar';
import ContextUsageBadge from './ContextUsageBadge';

const PHASE_TEXT: Record<string, string> = {
  translating: '正在翻译输入',
  submitting: '正在提交',
  output: '正在回译',
};

export const ChatComposer: React.FC = () => {
  const {
    projectId,
    selectedSessionId,
    activeSession,
    draft,
    setDraft,
    connected,
    isBusy,
    pendingApprovals,
    phaseMap,
    translateInput,
    commands,
    refreshCapabilities,
    sendMessage,
    interruptCurrentTask,
  } = useAgent();
  const { files: workspaceFiles, loadFiles: loadWorkspaceFiles } = useWorkspaceFiles(projectId);

  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null);
  const senderRef = useRef<GetRef<typeof Sender>>(null);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [fileList, setFileList, attachmentsReady] = useDraftState<any[]>(`attachments:${selectedSessionId}`, []);
  const [savedText, , textReady] = useDraftState(`text:${selectedSessionId}`, '');
  useEffect(() => { if (textReady && !draft && savedText) setDraft(savedText); }, [textReady, draft, savedText, setDraft]);
  useUnsavedChanges(Boolean(draft.trim() || fileList.length), `chat:${selectedSessionId}`);
  const displayFiles = useMemo(() => fileList.map(item => {
    const url = item.originFileObj?.type.startsWith('image/') ? URL.createObjectURL(item.originFileObj) : undefined;
    return { ...item, thumbUrl: url, url };
  }), [fileList]);
  useEffect(() => () => { displayFiles.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); }); }, [displayFiles]);
  const [longPasteNotice, setLongPasteNotice] = useState<{ lineCount: number } | null>(null);

  const byteCount = useMemo(() => new TextEncoder().encode(draft).length, [draft]);
  const commandQuery = draft.match(/^\/([^\s]*)$/)?.[1];
  const fileMatch = draft.match(/(?:^|\s)@([^\s]*)$/);
  const fileQuery = commandQuery === undefined ? fileMatch?.[1] : undefined;

  const suggestionItems = useMemo(() => {
    if (commandQuery !== undefined) {
      return commands
        .filter((c) => c.name.toLowerCase().startsWith(commandQuery.toLowerCase()))
        .map((c) => ({ value: `/${c.name}`, label: `/${c.name}`, extra: c.description || 'Claude 命令' }));
    }
    if (fileQuery !== undefined) {
      const q = fileQuery.toLowerCase();
      return workspaceFiles
        .filter((f) => !q || f.toLowerCase().includes(q))
        .slice(0, 30)
        .map((f) => ({ value: `@${f}`, label: `@${f}`, extra: '工作区文件' }));
    }
    return [];
  }, [commands, commandQuery, fileQuery, workspaceFiles]);

  const loadCommands = async () => {
    if (!selectedSessionId || !connected || isBusy || commandsLoading) return;
    setCommandsLoading(true);
    try {
      await refreshCapabilities();
    } finally {
      setCommandsLoading(false);
    }
  };

  const selectSuggestion = (value: string) => {
    if (value.startsWith('/')) {
      setDraft(value + ' ');
    } else if (value.startsWith('@')) {
      setDraft(draft.replace(/(^|\s)@[^\s]*$/, `$1${value} `));
    }
    setSuggestionsOpen(false);
    senderRef.current?.focus();
  };

  const handlePasteFile = (files: FileList) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setHeaderOpen(true);
    setFileList((prev) => [
      ...prev,
      ...arr.map((file) => {
        return {
          uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || `paste-${Date.now()}.png`,
          size: file.size,
          type: file.type,
          originFileObj: file,
          status: 'done' as const,
        };
      }),
    ]);
  };

  const handlePasteText: React.ClipboardEventHandler<HTMLElement> = (e) => {
    const pasted = e.clipboardData?.getData('text/plain') || '';
    if (!pasted) return;
    const analysis = analyzePastedText(pasted);
    if (analysis.isLongSnippet) setLongPasteNotice({ lineCount: analysis.lineCount });
  };

  const handleSubmit = async (skipTranslate = false) => {
    const files = fileList.map((i) => i.originFileObj as File | undefined).filter((f): f is File => Boolean(f));
    if (!attachmentsReady || !textReady || (!draft.trim() && files.length === 0) || isBusy || !selectedSessionId) return;
    setLongPasteNotice(null);
    await sendMessage(draft, files, skipTranslate);
  };

  const statusText = pendingApprovals.length
    ? '等待你的决定'
    : PHASE_TEXT[phaseMap[selectedSessionId]] ||
      (activeSession?.status === 'running'
        ? '执行中'
        : activeSession?.status === 'waiting_permission'
          ? '等待你的决定'
          : '');

  return (
    <div
      className="chat-composer"
      style={{
        padding: '6px 24px 18px',
        background: '#FFFFFF',
        flexShrink: 0,
      }}
    >
      <div style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>
        <Flex justify="space-between" align="center" className="composer-status" style={{ marginBottom: 6, padding: '0 6px', fontSize: 12, minHeight: 0 }}>
          <Space size={10}>
            {statusText && (
              <Flex align="center" gap={6}>
                <span className="status-dot status-dot--amber" />
                <span style={{ fontSize: 12, fontWeight: 500, color: '#3F3F46' }}>{statusText}</span>
              </Flex>
            )}
            {fileList.length > 0 && (
              <span
                style={{
                  fontSize: 11.5,
                  padding: '1px 8px',
                  borderRadius: 6,
                  background: '#F4F4F5',
                  border: '1px solid #E4E4E7',
                  color: '#18181B',
                }}
              >
                已附加 {fileList.length} 个文件/图片
              </span>
            )}
            {byteCount > 4000 && (
              <Typography.Text type={byteCount > 235000 ? 'danger' : 'secondary'} style={{ fontSize: 11 }}>
                {(byteCount / 1024).toFixed(1)} KB / 256 KB
              </Typography.Text>
            )}
          </Space>
          <ContextUsageBadge />
        </Flex>

        {longPasteNotice && (
          <Alert
            type="info"
            showIcon
            closable
            onClose={() => setLongPasteNotice(null)}
            style={{ marginBottom: 8, padding: '6px 12px' }}
            message={
              <Flex justify="space-between" align="center" wrap gap={8}>
                <span style={{ fontSize: 12 }}>
                  检测到粘贴了长段内容（约 {longPasteNotice.lineCount} 行）。若是报错日志或代码片段，建议包裹代码块或免翻译直接发送：
                </span>
                <Space size={6}>
                  <Button
                    size="small"
                    icon={<CodeOutlined />}
                    onClick={() => {
                      if (draft.trim() && !draft.trim().startsWith('```')) {
                        setDraft(`\`\`\`text\n${draft.trim()}\n\`\`\`\n`);
                      }
                      setLongPasteNotice(null);
                    }}
                  >
                    包裹为代码块
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    disabled={!connected || !selectedSessionId || isBusy}
                    onClick={() => void handleSubmit(true)}
                  >
                    免翻译直发
                  </Button>
                </Space>
              </Flex>
            }
          />
        )}

        {commandQuery !== undefined && commands.length === 0 && (
          <div role="status" style={{ marginBottom: 8, color: '#71717A', fontSize: 12 }}>
            {commandsLoading ? '正在加载当前会话命令…' : '尚未获取命令，可点击“加载命令”重试。'}
          </div>
        )}
        <Suggestion
          items={suggestionItems}
          open={suggestionsOpen && (commandQuery !== undefined || fileQuery !== undefined) && suggestionItems.length > 0}
          onOpenChange={setSuggestionsOpen}
          onSelect={selectSuggestion}
        >
          {({ onKeyDown, open }) => (
            <Sender
              ref={senderRef}
              aria-label="发送给 Claude 的需求"
              value={draft}
              disabled={!selectedSessionId}
              loading={isBusy}
              suffix={false}
              submitType="enter"
              autoSize={{ minRows: 2, maxRows: 8 }}
              style={{
                borderRadius: 16,
                border: '1px solid #E5E5E5',
                boxShadow: '0 2px 12px rgba(0, 0, 0, 0.04)',
                background: '#FFFFFF',
              }}
              placeholder={
                !selectedSessionId
                  ? '请先在左侧选择或新建会话…'
                  : translateInput
                    ? '输入需求，输入 / 查看命令，@ 引用工作区文件'
                    : '输入要直接发送的原文（/ 命令，@ 引用文件）'
              }
              onChange={(val) => {
                setDraft(val);
                if (!val.trim()) setLongPasteNotice(null);
                const isCmd = /^\/\S*$/.test(val);
                const isAtFile = /(?:^|\s)@[^\s]*$/.test(val);
                setSuggestionsOpen(isCmd || isAtFile);
                if (val === '/' && !draft.startsWith('/') && commands.length === 0) void loadCommands();
                if (isAtFile) void loadWorkspaceFiles();
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) {
                  e.stopPropagation();
                  return;
                }
                if (open && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  // Cascader commits the selection on Enter; Sender must not submit it as a message.
                  onKeyDown(e);
                  return false;
                }
                // The outer Cascader treats Space as a selection shortcut, even when closed.
                e.stopPropagation();
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void handleSubmit(false);
                  return false;
                }
                if (open && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) onKeyDown(e);
              }}
              onPaste={handlePasteText}
              onPasteFile={handlePasteFile}
              onSubmit={() => void handleSubmit(false)}
              onCancel={() => void interruptCurrentTask()}
              header={
                <Sender.Header
                  title={
                    <Space size={6}>
                      <FileImageOutlined />
                      <span>待发送附件</span>
                    </Space>
                  }
                  open={headerOpen}
                  onOpenChange={setHeaderOpen}
                >
                  <Attachments
                    ref={attachmentsRef}
                    beforeUpload={() => false}
                    items={displayFiles}
                    onChange={({ fileList: nextList }) =>
                      setFileList(
                        nextList.map((item) => {
                          return { ...item, thumbUrl: undefined, url: undefined, status: 'done' as const };
                        }),
                      )
                    }
                    placeholder={(type) =>
                      type === 'drop'
                        ? { title: '松开鼠标添加图片或文件' }
                        : {
                            icon: <PaperClipOutlined />,
                            title: '选择文件，或粘贴截图',
                          }
                    }
                  />
                </Sender.Header>
              }
              footer={
                <ComposerQuickBar
                  commandsLoading={commandsLoading}
                  canSend={Boolean(attachmentsReady && textReady && connected && selectedSessionId && (draft.trim() || fileList.length > 0) && !isBusy)}
                  hasDraft={draft.length > 0}
                  attachmentOpen={headerOpen}
                  attachmentCount={fileList.length}
                  onToggleAttachment={() => setHeaderOpen((o) => !o)}
                  onLoadCommands={() => void loadCommands()}
                  onSelectCommand={selectSuggestion}
                  onClearDraft={() => {
                    setDraft('');
                    setLongPasteNotice(null);
                  }}
                  onSend={() => void handleSubmit(false)}
                  onStop={() => void interruptCurrentTask()}
                />
              }
            />
          )}
        </Suggestion>
      </div>
    </div>
  );
};

export default ChatComposer;
