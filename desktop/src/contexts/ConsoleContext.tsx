import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { App } from 'antd';
import { consoleService } from '../services/console';
import { agentRpc } from '../services/api';
import type { ChatPreferences, ClaudeSyncInfo, Policy, Snapshot } from '../services/types';

interface ConsoleContextValue {
  snapshot: Snapshot | null;
  policy: Policy | null;
  dirty: boolean;
  busy: string | null;
  error: string;
  notice: string;
  updatedAt?: string;
  claudeInfo: ClaudeSyncInfo | null;
  clearError: () => void;
  clearNotice: () => void;
  setError: (msg: string) => void;
  setNotice: (msg: string) => void;
  refreshSnapshot: (replacePolicy?: boolean) => Promise<Snapshot | null>;
  editPolicy: <K extends keyof Policy>(section: K, value: Partial<Policy[K]>) => void;
  resetPolicyDraft: () => void;
  validateCurrentPolicy: () => Promise<void>;
  saveCurrentPolicy: () => Promise<void>;
  chatDraft: ChatPreferences | null;
  setChatDraft: (prefs: ChatPreferences) => void;
  saveChatDraft: () => Promise<void>;
  setupWsl: () => Promise<void>;
  runOperation: (op: 'up' | 'stop') => Promise<void>;
  handleClaudeSync: (operation: 'info' | 'sync' | 'reset') => Promise<void>;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

const OP_LABELS = {
  up: '正在启动 WSL2 工作环境…',
  stop: '正在停止 WSL2 后台服务…',
};

export const ConsoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { message } = App.useApp();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [chatDraft, setChatDraft] = useState<ChatPreferences | null>(null);
  const [busy, setBusy] = useState<string | null>('正在连接本地 WSL2 控制器…');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [claudeInfo, setClaudeInfo] = useState<ClaudeSyncInfo | null>(null);

  const dirty = !!(snapshot && policy && JSON.stringify(policy) !== JSON.stringify(snapshot.policy));

  const notify = useCallback(
    (tip: string, toast = true) => {
      setNotice(tip);
      if (toast) message.success(tip);
    },
    [message],
  );

  const refreshSnapshot = useCallback(async (replacePolicy = false) => {
    const result = await consoleService.getSnapshot();
    setSnapshot(result);
    setChatDraft((current) => current ?? result.chatPreferences);
    setUpdatedAt(new Date().toISOString());
    if (replacePolicy) setPolicy(structuredClone(result.policy));
    return result;
  }, []);

  useEffect(() => {
    refreshSnapshot(true)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }, [refreshSnapshot]);

  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty || busy || (chatDraft && JSON.stringify(chatDraft) !== JSON.stringify(snapshot?.chatPreferences))) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, busy, chatDraft, snapshot]);

  const runTask = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(label);
      setError('');
      setNotice('');
      try {
        await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        message.error(msg);
      } finally {
        setBusy(null);
      }
    },
    [busy, message],
  );

  const editPolicy = useCallback(<K extends keyof Policy>(section: K, value: Partial<Policy[K]>) => {
    setPolicy((prev) => (prev ? { ...prev, [section]: { ...(prev[section] as object), ...value } } : prev));
    setNotice('');
  }, []);

  const resetPolicyDraft = useCallback(() => {
    if (!snapshot) return;
    setPolicy(structuredClone(snapshot.policy));
    setError('');
    setNotice('已恢复上次保存的策略配置。');
  }, [snapshot]);

  const validateCurrentPolicy = useCallback(async () => {
    if (!policy) return;
    await runTask('正在校验配置…', async () => {
      await consoleService.validatePolicy(policy);
      notify('配置校验通过。' + (dirty ? '（更改尚未保存）' : ''));
    });
  }, [policy, dirty, runTask, notify]);

  const saveCurrentPolicy = useCallback(async () => {
    if (!policy || !snapshot) return;
    await runTask('正在保存配置…', async () => {
      await consoleService.savePolicy(policy, snapshot.policyHash);
      await refreshSnapshot(true);
      notify('配置已保存。启动或重启环境后生效。');
    });
  }, [policy, snapshot, refreshSnapshot, runTask, notify]);

  const setupWsl = useCallback(async () => {
    await runTask('请在配置终端中按提示操作，结束后按任意键返回。', async () => {
      const completed = await consoleService.setupWsl();
      const updated = await refreshSnapshot();
      if (!completed) {
        throw new Error('WSL 配置未完成。请根据配置终端的提示重试。sudo 权限问题可参考 README。');
      }
      if (!updated?.runtime.dependenciesReady) {
        throw new Error(updated?.runtime.reason || 'WSL2 依赖检查未通过。');
      }
      notify('WSL2 配置完成，可以启动环境。');
    });
  }, [refreshSnapshot, runTask, notify]);

  const runOperation = useCallback(
    async (op: 'up' | 'stop') => {
      await runTask(OP_LABELS[op], async () => {
        const result = await consoleService.runOperation(op);
        if (!result.ok) {
          const detail = result.error || result.output.trim().split(/\r?\n/).pop();
          throw new Error(detail || (op === 'up' ? '启动 WSL2 环境失败，请检查 WSL2 状态。' : '停止环境失败，请刷新状态。'));
        }
        await refreshSnapshot(false);
        notify(op === 'stop' ? 'WSL2 后台服务已停止。' : 'WSL2 工作环境已启动。');
      });
    },
    [refreshSnapshot, runTask, notify],
  );

  const saveChatDraft = async () => {
    if (!chatDraft) return;
    await runTask('正在保存对话偏好…', async () => {
      const saved = await agentRpc<ChatPreferences>('preferences.save', {
        ...chatDraft,
        model: chatDraft.model.trim(),
        allowedTools: chatDraft.allowedTools.map((rule) => rule.trim()).filter(Boolean),
      });
      setChatDraft(saved);
      setSnapshot((current) => current && { ...current, chatPreferences: saved });
      notify('对话偏好已保存。');
    });
  };

  const handleClaudeSync = useCallback(
    async (operation: 'info' | 'sync' | 'reset') => {
      if (operation === 'reset') {
        await runTask('正在恢复 WSL2 未登录状态…', async () => {
          await consoleService.claudeSync('reset', null);
          notify('已恢复未登录状态，API 配置与 OAuth 登录已清除。项目与对话历史已保留。');
        });
        return;
      }
      await runTask(
        operation === 'info' ? '正在读取 Windows Claude 配置…' : '正在备份并同步 Claude 配置到 WSL2…',
        async () => {
          const info = await consoleService.getClaudeSyncInfo();
          setClaudeInfo(info);
          if (operation === 'info') return notify('已读取 Windows 当前配置摘要（密钥内容已隐藏）。', false);
          const result = await consoleService.claudeSync('sync', info.sourceHash);
          setClaudeInfo(await consoleService.getClaudeSyncInfo());
          const tip =
            (result.changed
              ? '已同步到 WSL2。' + (result.backupCreated ? '旧配置已在 WSL2 内备份。' : '')
              : 'WSL2 配置已经一致。') + '请重新启动 Claude 会话以使用新接口与模型。';
          setNotice(tip);
          message.success('Claude 配置同步完成');
        },
      );
    },
    [runTask, notify, message],
  );

  return (
    <ConsoleContext.Provider
      value={{
        snapshot,
        policy,
        dirty,
        busy,
        error,
        notice,
        updatedAt,
        claudeInfo,
        clearError: () => setError(''),
        clearNotice: () => setNotice(''),
        setError,
        setNotice,
        refreshSnapshot,
        editPolicy,
        resetPolicyDraft,
        validateCurrentPolicy,
        saveCurrentPolicy,
        chatDraft,
        setChatDraft,
        saveChatDraft,
        setupWsl,
        runOperation,
        handleClaudeSync,
      }}
    >
      {children}
    </ConsoleContext.Provider>
  );
};

export function useConsole() {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole must be used inside ConsoleProvider');
  return ctx;
}
