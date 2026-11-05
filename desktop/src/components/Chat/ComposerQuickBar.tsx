import React, { useMemo, useState } from 'react';
import { Button, Flex, Select, Space } from 'antd';
import {
  ArrowUpOutlined,
  BorderOutlined,
  ClearOutlined,
  PlusOutlined,
  ReloadOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { useAgent } from '../../contexts/AgentContext';
import { useConsole } from '../../contexts/ConsoleContext';
import { PERMISSION_MODES } from '../../services/types';

interface ComposerQuickBarProps {
  commandsLoading: boolean;
  canSend: boolean;
  hasDraft: boolean;
  attachmentOpen: boolean;
  attachmentCount: number;
  onToggleAttachment: () => void;
  onLoadCommands: () => void;
  onSelectCommand: (cmd: string) => void;
  onClearDraft: () => void;
  onSend: () => void;
  onStop: () => void;
}

export const ComposerQuickBar: React.FC<ComposerQuickBarProps> = ({
  commandsLoading,
  canSend,
  hasDraft,
  attachmentOpen,
  attachmentCount,
  onToggleAttachment,
  onLoadCommands,
  onSelectCommand,
  onClearDraft,
  onSend,
  onStop,
}) => {
  const { snapshot } = useConsole();
  const translationDisabled = snapshot?.chatPreferences.provider === 'none';
  const target = snapshot?.targetLanguages[snapshot.chatPreferences.targetLanguage] || '目标语言';
  const {
    selectedSessionId,
    activeSession,
    connected,
    isBusy,
    models,
    selectedModel,
    setSelectedModel,
    applyModel,
    changePermissionMode,
    refreshCapabilities,
    translateInput,
    setTranslateInput,
    commands,
  } = useAgent();
  const [modelsLoading, setModelsLoading] = useState(false);

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({
      value: m.value,
      label: m.displayName || m.value,
    }));
    const defaultLabel = activeSession?.actualModel
      ? activeSession.actualModel.replace(/^claude-/, '')
      : '默认模型';
    if (!opts.some((o) => o.value === 'default')) {
      opts.unshift({ value: 'default', label: defaultLabel });
    }
    return opts;
  }, [models, activeSession?.actualModel]);

  const permissionOptions = useMemo(
    () => Object.entries(PERMISSION_MODES).map(([value, label]) => ({ value, label })),
    [],
  );

  const handleModelDropdownOpen = async (open: boolean) => {
    if (open && models.length === 0 && selectedSessionId && connected && !isBusy && !modelsLoading) {
      setModelsLoading(true);
      try {
        await refreshCapabilities();
      } finally {
        setModelsLoading(false);
      }
    }
  };

  return (
    <Flex justify="space-between" align="center" wrap gap={6} className="composer-actions" style={{ width: '100%' }}>
      <Space wrap size={4} align="center">
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label="添加附件"
          disabled={!selectedSessionId}
          onClick={onToggleAttachment}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            color: attachmentOpen || attachmentCount > 0 ? '#18181B' : '#71717A',
            background: attachmentOpen || attachmentCount > 0 ? '#F4F4F5' : 'transparent',
          }}
        />

        <Select
          aria-label="切换权限模式"
          size="small"
          variant="borderless"
          value={activeSession?.permissionMode || 'default'}
          disabled={!selectedSessionId || !connected || isBusy}
          onChange={(mode) => void changePermissionMode(mode)}
          style={{ minWidth: 108, fontSize: 12 }}
          popupMatchSelectWidth={false}
          options={permissionOptions}
        />

        <Button
          size="small"
          type="text"
          icon={<TranslationOutlined style={{ fontSize: 12 }} />}
          disabled={translationDisabled}
          title={translationDisabled ? '已在“设置 → 对话与翻译”中关闭翻译服务' : undefined}
          onClick={() => setTranslateInput(!translateInput)}
          style={{
            height: 24,
            padding: '0 8px',
            fontSize: 12,
            borderRadius: 6,
            background: !translationDisabled && translateInput ? '#F4F4F5' : 'transparent',
            color: !translationDisabled && translateInput ? '#18181B' : '#71717A',
            fontWeight: !translationDisabled && translateInput ? 500 : 400,
          }}
        >
          {translationDisabled ? '已关闭翻译' : translateInput ? `翻译→${target}` : '原文直发'}
        </Button>

        {commands.length > 0 ? (
          <Select
            aria-label="可用命令"
            size="small"
            variant="borderless"
            placeholder="/ 命令"
            value={undefined}
            style={{ width: 88, fontSize: 12 }}
            popupMatchSelectWidth={false}
            onChange={(val: string) => onSelectCommand(`/${val}`)}
            options={commands.map((c) => ({ value: c.name, label: `/${c.name}` }))}
          />
        ) : (
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined aria-hidden="true" style={{ fontSize: 11.5 }} />}
            loading={commandsLoading}
            disabled={!connected || !selectedSessionId || isBusy}
            onClick={onLoadCommands}
            style={{ height: 24, padding: '0 6px', fontSize: 12, color: '#71717A' }}
          >
            命令
          </Button>
        )}

        {hasDraft && (
          <Button
            size="small"
            type="text"
            icon={<ClearOutlined style={{ fontSize: 11.5 }} />}
            onClick={onClearDraft}
            style={{ height: 24, padding: '0 6px', fontSize: 12, color: '#71717A' }}
          >
            清空
          </Button>
        )}
      </Space>

      <Space size={6} align="center">
        <Select
          aria-label="切换模型"
          size="small"
          variant="borderless"
          loading={modelsLoading}
          value={selectedModel || 'default'}
          disabled={!selectedSessionId || !connected || isBusy}
          onOpenChange={(open) => void handleModelDropdownOpen(open)}
          onChange={(val) => {
            setSelectedModel(val);
            void applyModel(val);
          }}
          style={{ minWidth: 96, fontSize: 12 }}
          popupMatchSelectWidth={false}
          options={modelOptions}
        />

        {isBusy ? (
          <Button
            size="small"
            shape="circle"
            aria-label="停止"
            className="stop-button"
            icon={<BorderOutlined style={{ fontSize: 10 }} />}
            onClick={onStop}
            style={{
              width: 28,
              height: 28,
              background: '#18181B',
              color: '#FFFFFF',
              border: 'none',
            }}
          />
        ) : (
          <Button
            size="small"
            shape="circle"
            aria-label="发送"
            className="send-button"
            icon={<ArrowUpOutlined style={{ fontSize: 13 }} />}
            disabled={!canSend}
            onClick={onSend}
            style={{
              width: 28,
              height: 28,
              background: canSend ? '#18181B' : '#E4E4E7',
              color: canSend ? '#FFFFFF' : '#A1A1AA',
              border: 'none',
            }}
          />
        )}
      </Space>
    </Flex>
  );
};

export default ComposerQuickBar;
