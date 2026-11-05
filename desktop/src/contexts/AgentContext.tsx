import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { useConsole } from './ConsoleContext';
import { subscribeAgentEvents } from '../services/api';
import { agentService } from '../services/agent';
import { workspaceService } from '../services/workspace';
import { readFileAsBase64 } from '../hooks/useClipboard';
import { clearDraftValue, getDraftValue, setDraftValue } from '../hooks/useDraftState';
import type {
  AccountUsage,
  AgentEvent,
  ApprovalRequest,
  Conversation,
  HistoryListing,
  Message,
  ModelOption,
  Project,
  Session,
  SessionUsage,
  SlashCommand,
  UploadedAttachment,
  WorkspacePanelKey,
} from '../services/types';

const sessionMemory = {
  projectId: '',
  selectedSessionId: '',
  seq: 0,
  bootId: '',
  deleted: new Set<string>(),
  drafts: new Map<string, string>(),
  pendingDrafts: new Map<string, string>(),
  conversations: new Map<string, Conversation>(),
  attachmentsByMessage: new Map<string, UploadedAttachment[]>(),
  attachmentSessions: new Map<string, string>(),
  pendingAttachments: new Map<string, { requestId: string; uids: string[] }>(),
};

function convertAgentEventToMessage(e: AgentEvent): Message {
  const blocks =
    e.kind === 'message.user'
      ? [{ type: 'text' as const, text: e.text }]
      : (e.blocks || []).map((b: any) =>
          b.type === 'text'
            ? { type: 'text' as const, text: b.text, isError: !!b.isError }
            : b.type === 'tool_use'
              ? { type: 'tool_use' as const, name: b.name, text: JSON.stringify(b.input, null, 2) }
              : {
                  type: 'tool_result' as const,
                  text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2),
                  isError: !!b.is_error,
                },
        );
  const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  const isModelCmd = e.kind === 'message.user' && /^[ \t]*\/model(?:[ \t]+[^\r\n]*)?[ \t]*$/.test(text);

  return {
    id: e.id,
    role:
      e.kind === 'message.user'
        ? 'user'
        : e.kind === 'message.tool'
          ? 'tool'
          : e.kind === 'message.command_result'
            ? 'system'
            : 'assistant',
    ...(isModelCmd
      ? { kind: 'command' as const }
      : e.kind === 'message.command_result'
        ? { kind: 'command_result' as const }
        : {}),
    time: e.time || new Date().toISOString(),
    blocks,
    languageHint: /[\u3041-\u3096\u30a1-\u30fa]/.test(text)
      ? 'japanese_kana'
      : /[\u3400-\u9fff]/.test(text)
        ? 'han_only'
        : 'other',
    attachments: sessionMemory.attachmentsByMessage.get(e.id),
  };
}

const NEXT_PHASE_MAP: Record<string, string> = {
  'translation.input.started': 'translating',
  'message.submitting': 'submitting',
  'message.accepted': 'submitted',
  'translation.output.started': 'output',
  'translation.output.completed': 'done',
  'translation.output.failed': 'output_failed',
  'message.failed': 'failed',
};

interface AgentContextValue {
  projects: Project[];
  projectId: string;
  currentProject: Project | undefined;
  sessions: Session[];
  combinedSessions: Session[];
  selectedSessionId: string;
  activeSession: Session | undefined;
  conversation: Conversation | null;
  draft: string;
  setDraft: (value: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  connected: boolean;
  loading: boolean;
  creating: boolean;
  paging: boolean;
  error: string;
  clearError: () => void;
  approvals: ApprovalRequest[];
  pendingApprovals: ApprovalRequest[];
  models: ModelOption[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  commands: SlashCommand[];
  phaseMap: Record<string, string>;
  streamMap: Record<string, string>;
  usageMap: Record<string, SessionUsage>;
  accountUsage: AccountUsage | null;
  translateInput: boolean;
  setTranslateInput: (v: boolean) => void;
  translateOutput: boolean;
  setTranslateOutput: (v: boolean) => void;
  showTools: boolean;
  setShowTools: (v: boolean) => void;
  showChinese: boolean;
  setShowChinese: (v: boolean) => void;
  translatorStatus: string;
  storagePath: string;
  activePanel: WorkspacePanelKey;
  setActivePanel: (panel: WorkspacePanelKey) => void;
  isBusy: boolean;
  refreshAgent: () => Promise<void>;
  refreshCapabilities: () => Promise<void>;
  selectProject: (id: string) => void;
  createProject: (name: string, path: string) => Promise<Project>;
  selectSession: (id: string, scope?: string) => Promise<void>;
  createSession: (targetProjectId?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  applyModel: (modelValue?: string) => Promise<void>;
  changePermissionMode: (mode: string) => Promise<void>;
  checkTranslator: () => Promise<void>;
  sendMessage: (customText?: string, files?: File[], skipTranslate?: boolean) => Promise<boolean>;
  interruptCurrentTask: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  retryMessageTranslation: (messageId: string) => Promise<void>;
  respondToApproval: (requestId: string, allow: boolean, answers?: Record<string, string>) => Promise<void>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function useDisplaySwitch(name: string) {
  const key = 'isolation.chat.' + name;
  const [value, setValue] = useState(() => localStorage.getItem(key) !== 'false');
  const save = useCallback((next: boolean) => {
    localStorage.setItem(key, String(next));
    setValue(next);
  }, [key]);
  return [value, save] as const;
}

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { message } = App.useApp();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<HistoryListing | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState(sessionMemory.selectedSessionId);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraftState] = useState(sessionMemory.drafts.get(sessionMemory.selectedSessionId) || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paging, setPaging] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('default');
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [phaseMap, setPhaseMap] = useState<Record<string, string>>({});
  const [streamMap, setStreamMap] = useState<Record<string, string>>({});
  const [usageMap, setUsageMap] = useState<Record<string, SessionUsage>>({});
  const [accountUsage, setAccountUsage] = useState<AccountUsage | null>(null);

  const [translateInput, setTranslateInput] = useDisplaySwitch('translateInput');
  const [translateOutput, setTranslateOutput] = useDisplaySwitch('translateOutput');
  const [showTools, setShowTools] = useDisplaySwitch('showTools');
  const [showChinese, setShowChinese] = useDisplaySwitch('showChinese');
  const { snapshot } = useConsole();
  const translationEnabled = snapshot?.chatPreferences.provider !== 'none';
  const [translatorStatus, setTranslatorStatus] = useState('待命');
  useEffect(() => {
    setTranslatorStatus((current) => {
      if (!translationEnabled) return '已关闭翻译';
      return current === '已关闭翻译' ? '待命' : current;
    });
  }, [translationEnabled]);
  const [storagePath, setStoragePath] = useState('');
  const [activePanel, setActivePanel] = useState<WorkspacePanelKey>('chat');

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(sessionMemory.projectId);

  const currentSessionRef = useRef(selectedSessionId);
  const mountedRef = useRef(true);
  const creatingLockRef = useRef(false);
  const replayingRef = useRef(true);
  const bufferedEventsRef = useRef<AgentEvent[]>([]);

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    if (currentSessionRef.current) sessionMemory.drafts.set(currentSessionRef.current, value);
    if (currentSessionRef.current) setDraftValue(`text:${currentSessionRef.current}`, value);
  }, []);

  const upsertSession = useCallback((s: Session) => {
    if (sessionMemory.deleted.has(s.id)) return;
    setSessions((old) => [...old.filter((v) => v.id !== s.id), s].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (s.id === currentSessionRef.current) setSelectedModel(s.model || 'default');
  }, []);

  const forgetSession = useCallback((id: string) => {
    sessionMemory.deleted.add(id);
    sessionMemory.conversations.delete(id);
    sessionMemory.drafts.delete(id);
    sessionMemory.pendingDrafts.delete(id);
    clearDraftValue(`attachments:${id}`);
    setDraftValue(`text:${id}`, '');
    sessionMemory.pendingAttachments.delete(id);
    for (const [messageId, owner] of sessionMemory.attachmentSessions) if (owner === id) {
      sessionMemory.attachmentSessions.delete(messageId); sessionMemory.attachmentsByMessage.delete(messageId);
    }
    setSessions((old) => old.filter((s) => s.id !== id));
    setHistory((old) => (old ? { ...old, sessions: old.sessions.filter((s) => s.id !== id) } : old));
    setApprovals((old) => old.filter((a) => a.sessionId !== id));
    setStreamMap(({ [id]: _, ...rest }) => rest);
    setPhaseMap(({ [id]: _, ...rest }) => rest);
    if (currentSessionRef.current === id) {
      currentSessionRef.current = '';
      sessionMemory.selectedSessionId = '';
      setSelectedSessionId('');
      setConversation(null);
      setDraftState('');
      setSelectedModel('default');
    }
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    try {
        const data = await agentService.readHistory(id, undefined, translateOutput && translationEnabled);
      if (sessionMemory.deleted.has(id)) return;
      const prev = sessionMemory.conversations.get(id);
      const getMsgText = (m?: Message) => m?.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '';
      for (const [k, val] of Object.entries(prev?.bilingual || {})) {
        if (
          val.chinese &&
          !data.bilingual?.[k]?.chinese &&
          data.messages.some((m) => m.id === k && getMsgText(m) === getMsgText(prev?.messages.find((pm) => pm.id === k)))
        ) {
          data.bilingual = { ...data.bilingual, [k]: val };
        }
      }
      data.messages = data.messages.map((m) => ({
        ...m,
        attachments: m.attachments || sessionMemory.attachmentsByMessage.get(m.id),
      }));
      if (prev?.messages.length) {
        const ids = new Set(data.messages.map(m => m.id));
        data.messages = [...prev.messages.filter(m => !ids.has(m.id)), ...data.messages];
      }
      sessionMemory.conversations.set(id, data);
      if (mountedRef.current && currentSessionRef.current === id) setConversation(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('HISTORY_NOT_FOUND') && mountedRef.current && currentSessionRef.current === id) setError(msg);
    }
  }, [translateOutput, translationEnabled]);

  const mergeAccountUsage = useCallback((au: any) => {
    if (!au) return;
    const rl = au.rateLimits;
    setAccountUsage((prev) => ({
      subscriptionType: au.subscriptionType ?? prev?.subscriptionType ?? null,
      rateLimitsAvailable: au.rateLimitsAvailable ?? prev?.rateLimitsAvailable,
      fiveHour: rl?.five_hour?.utilization != null
        ? { utilization: Math.round(Number(rl.five_hour.utilization)), resetsAt: rl.five_hour.resets_at ?? null }
        : prev?.fiveHour ?? null,
      sevenDay: rl?.seven_day?.utilization != null
        ? { utilization: Math.round(Number(rl.seven_day.utilization)), resetsAt: rl.seven_day.resets_at ?? null }
        : prev?.sevenDay ?? null,
      updatedAt: au.updatedAt || Date.now(),
    }));
  }, []);

  const loadCapabilities = useCallback(async (id: string, initialize = false) => {
    try {
      const c: any = await agentService.readCapabilities(id, initialize);
      if (mountedRef.current && currentSessionRef.current === id) {
        if (c.models?.length) setModels(c.models);
        if (c.commands?.length) setCommands(c.commands);
        setSelectedModel(c.model || 'default');
        if (c.accountUsage) mergeAccountUsage(c.accountUsage);
      }
    } catch (e) {
      if (mountedRef.current && currentSessionRef.current === id) setError(e instanceof Error ? e.message : String(e));
    }
  }, [mergeAccountUsage]);

  const fetchBilingual = useCallback(async (id: string, messageId: string) => {
    try {
      const rows = await agentService.readTranslations(id, [messageId]);
      const old = sessionMemory.conversations.get(id);
      if (!sessionMemory.deleted.has(id) && old) {
        const next: Conversation = { ...old, bilingual: { ...old.bilingual, ...rows } };
        sessionMemory.conversations.set(id, next);
        if (currentSessionRef.current === id) setConversation(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const chooseSessionInternal = useCallback(
    (id: string, scope?: string, allSessions?: Session[], historyListing?: HistoryListing | null) => {
      if (sessionMemory.deleted.has(id)) return;
      const list = allSessions || sessions;
      const hist = historyListing !== undefined ? historyListing : history;
      const group =
        scope ||
        list.find((s) => s.id === id)?.projectId ||
        hist?.sessions.find((s) => s.id === id)?.projectId ||
        sessionMemory.projectId ||
        'legacy';
      sessionMemory.projectId = group;
      setProjectId(group);
      currentSessionRef.current = id;
      sessionMemory.selectedSessionId = id;
      setSelectedSessionId(id);
      setDraftState(sessionMemory.drafts.get(id) || '');
      setConversation(sessionMemory.conversations.get(id) || null);
      setSelectedModel(list.find((s) => s.id === id)?.model || 'default');
      void loadHistory(id);
      const needsQuotaInit = !accountUsage || (accountUsage.rateLimitsAvailable !== false && !accountUsage.fiveHour && !accountUsage.sevenDay);
      void loadCapabilities(id, needsQuotaInit);
    },
    [sessions, history, accountUsage, loadHistory, loadCapabilities],
  );

  const handleEvent = useCallback(
    (e: AgentEvent, replay = false) => {
      if (replayingRef.current && !replay) {
        bufferedEventsRef.current.push(e);
        return;
      }
      if (!mountedRef.current) return;
      if (e.seq) {
        if (e.seq <= sessionMemory.seq) return;
        sessionMemory.seq = e.seq;
      }
      if (e.kind === 'session.deleted') return forgetSession(e.sessionId);
      if (e.sessionId && sessionMemory.deleted.has(e.sessionId)) return;
      if (e.kind === 'connection.lost') {
        setConnected(false);
        setError('与 WSL2 运行时的连接已中断，点击右上角刷新可恢复连接。');
        return;
      }
      if (e.kind === 'project.created') setProjects((old) => [...old.filter((p) => p.id !== e.project.id), e.project]);
      if (e.kind === 'session.created' || e.kind === 'session.state') upsertSession(e.session);
      if (e.kind === 'session.init') {
        setSessions((old) => old.map((s) => (s.id === e.sessionId ? { ...s, actualModel: e.model } : s)));
      }
      if (e.kind === 'model.changed') {
        setSessions((old) => old.map((s) => (s.id === e.sessionId ? { ...s, model: e.model, actualModel: null } : s)));
        if (currentSessionRef.current === e.sessionId) setSelectedModel(e.model);
      }
      if (e.kind === 'text.delta') {
        setStreamMap((old) => ({ ...old, [e.sessionId]: (old[e.sessionId] || '') + e.text }));
      }
      if (['message.user', 'message.assistant', 'message.tool', 'message.command_result'].includes(e.kind)) {
        const data: Conversation = sessionMemory.conversations.get(e.sessionId) || {
          sessionId: e.sessionId,
          messages: [],
          nextBefore: null,
          ignoredLines: 0,
          outputTruncated: false,
        };
        const m = convertAgentEventToMessage(e);
        const next: Conversation = {
          ...data,
          messages: [...data.messages.filter((v) => v.id !== m.id), m],
        };
        sessionMemory.conversations.set(e.sessionId, next);
        if (currentSessionRef.current === e.sessionId) setConversation(next);
        if (e.kind === 'message.user') void fetchBilingual(e.sessionId, e.id);
        if (e.kind === 'message.assistant' || e.kind === 'message.command_result') {
          setStreamMap((old) => ({ ...old, [e.sessionId]: '' }));
        }
      }
      if (e.kind === 'approval.required') {
        setApprovals((old) => [...old.filter((p) => p.requestId !== e.request.requestId), e.request]);
      }
      if (e.kind === 'approval.resolved') {
        setApprovals((old) => old.filter((p) => p.requestId !== e.requestId));
      }
      if (e.kind === 'rate.limit' && e.info) {
        const info = e.info as any;
        const rawUtil = typeof info.utilization === 'number' ? info.utilization : null;
        const pct = rawUtil != null ? (rawUtil <= 1 ? Math.round(rawUtil * 100) : Math.round(rawUtil)) : null;
        const win = pct != null
          ? {
              utilization: pct,
              resetsAt: info.resetsAt ?? null,
              status: info.status,
            }
          : null;
        if (win) {
          setAccountUsage((prev) => ({
            ...prev,
            rateLimitsAvailable: true,
            ...(info.rateLimitType === 'five_hour'
              ? { fiveHour: win }
              : info.rateLimitType?.startsWith('seven_day')
                ? { sevenDay: win }
                : {}),
            updatedAt: Date.now(),
          }));
        }
      }
      if (e.kind === 'account.usage' && e.accountUsage) {
        mergeAccountUsage(e.accountUsage);
      }
      if (e.kind === 'turn.completed') {
        if (e.accountUsage) mergeAccountUsage(e.accountUsage);
        setStreamMap((old) => ({ ...old, [e.sessionId]: '' }));
        setPhaseMap(({ [e.sessionId]: _, ...rest }) => rest);
        if (e.usage || e.modelUsage || typeof e.costUsd === 'number') {
          const u = e.usage || {};
          const inputTokens = Number(u.input_tokens || 0);
          const outputTokens = Number(u.output_tokens || 0);
          const cacheReadTokens = Number(u.cache_read_input_tokens || 0);
          const cacheCreationTokens = Number(u.cache_creation_input_tokens || 0);
          const contextTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
          const modelEntries = e.modelUsage && typeof e.modelUsage === 'object' ? Object.values(e.modelUsage) as any[] : [];
          const reportedWindow = Number(modelEntries.find((m) => Number(m?.contextWindow) > 0)?.contextWindow || 0);
          setUsageMap((old) => {
            const prev = old[e.sessionId];
            return {
              ...old,
              [e.sessionId]: {
                inputTokens: (prev?.inputTokens || 0) + inputTokens,
                outputTokens: (prev?.outputTokens || 0) + outputTokens,
                cacheReadTokens: (prev?.cacheReadTokens || 0) + cacheReadTokens,
                cacheCreationTokens: (prev?.cacheCreationTokens || 0) + cacheCreationTokens,
                contextTokens: contextTokens || prev?.contextTokens || 0,
                contextWindow: reportedWindow || prev?.contextWindow || 0,
                costUsd: typeof e.costUsd === 'number' && e.costUsd > 0 ? e.costUsd : (prev?.costUsd || 0),
              },
            };
          });
        }
        if (!replay && currentSessionRef.current === e.sessionId) void loadHistory(e.sessionId);
      }
      if (NEXT_PHASE_MAP[e.kind]) {
        setPhaseMap((p) => ({ ...p, [e.sessionId]: NEXT_PHASE_MAP[e.kind] }));
      }
      if (e.kind.startsWith('translation.') && !(e.kind === 'translation.input.completed' && e.translated === false)) {
        setTranslatorStatus(
          e.kind.endsWith('.started') ? '处理中' : e.kind.endsWith('.completed') ? '已连接' : '回译失败',
        );
      }
      if (e.kind === 'message.failed' && String(e.code).startsWith('TRANSLATION')) setTranslatorStatus('翻译失败');
      if (e.kind === 'message.accepted') {
        if (currentSessionRef.current === e.sessionId) void loadCapabilities(e.sessionId);
        const pending = sessionMemory.pendingAttachments.get(e.sessionId);
        if (pending && pending.requestId === e.requestId) {
          const current = getDraftValue<any[]>(`attachments:${e.sessionId}`) || [];
          setDraftValue(`attachments:${e.sessionId}`, current.filter(item => !pending.uids.includes(item.uid)));
          sessionMemory.pendingAttachments.delete(e.sessionId);
        }
        if (sessionMemory.drafts.get(e.sessionId) === sessionMemory.pendingDrafts.get(e.sessionId)) {
          sessionMemory.drafts.delete(e.sessionId);
          if (currentSessionRef.current === e.sessionId) setDraftState('');
          setDraftValue(`text:${e.sessionId}`, '');
        }
        sessionMemory.pendingDrafts.delete(e.sessionId);
      }
      if (['translation.output.started', 'translation.output.completed', 'translation.output.failed'].includes(e.kind)) {
        void fetchBilingual(e.sessionId, e.messageId);
      }
      if (e.kind === 'storage.error') setError('中文记录保存失败，请检查本机 SQLite 数据库目录权限。');
      if (e.kind === 'message.failed' && currentSessionRef.current === e.sessionId) {
        setError(`消息未成功提交：${e.code}`);
      }
      if (e.kind === 'runtime.error' && currentSessionRef.current === e.sessionId) setError(String(e.code));
    },
    [forgetSession, upsertSession, fetchBilingual, loadHistory, loadCapabilities, mergeAccountUsage],
  );

  const refreshAgent = useCallback(async () => {
    setError('');
    setLoading(true);
    replayingRef.current = true;
    try {
      const result = await agentService.getStatus();
      if (!mountedRef.current) return;
      setConnected(true);
      setSessions(result.sessions);
      setProjects(result.projects || []);
      setModels(result.models || []);
      setCommands(result.commands || []);
      setStoragePath(result.storage?.path || '');

      if (sessionMemory.bootId !== result.bootId) {
        sessionMemory.bootId = result.bootId;
        sessionMemory.seq = 0;
      }
      const pending = await agentService.listApprovals();
      if (mountedRef.current) setApprovals(pending);

      const listing = await agentService.listHistory();
      if (!mountedRef.current) return;
      setHistory(listing);

      const scope =
        sessionMemory.projectId ||
        result.sessions.find((s) => s.id === currentSessionRef.current)?.projectId ||
        listing.sessions.find((s) => s.id === currentSessionRef.current)?.projectId ||
        result.projects?.find((p) => !p.legacy)?.id ||
        'legacy';
      sessionMemory.projectId = scope;
      setProjectId(scope);

      const id =
        currentSessionRef.current ||
        result.sessions.find((s) => (s.projectId || 'legacy') === scope)?.id ||
        listing.sessions.find((s) => (s.projectId || 'legacy') === scope)?.id;

      if (id) {
        if (!result.sessions.some((s) => s.id === id)) {
          upsertSession(await agentService.resumeSession(id));
        }
        chooseSessionInternal(id, scope, result.sessions, listing);
      }

      const missed = await agentService.getEventsSince(sessionMemory.seq);
      for (const ev of missed.events) handleEvent(ev, true);
      if (missed.gap && id) void loadHistory(id);
    } catch (e) {
      if (mountedRef.current) {
        setConnected(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      replayingRef.current = false;
      for (const ev of bufferedEventsRef.current.splice(0)) handleEvent(ev);
      if (mountedRef.current) setLoading(false);
    }
  }, [upsertSession, chooseSessionInternal, handleEvent, loadHistory]);

  const handleEventRef = useRef(handleEvent);
  const verified = snapshot?.runtime.verified;
  const previousVerified = useRef(verified);
  useEffect(() => {
    if (previousVerified.current === false && verified) void refreshAgent();
    if (verified === false) setConnected(false);
    previousVerified.current = verified;
  }, [verified, refreshAgent]);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    mountedRef.current = true;
    let unlisten: (() => void) | undefined;
    void subscribeAgentEvents((payload) => handleEventRef.current(payload))
      .then((fn) => {
        if (!mountedRef.current) return fn();
        unlisten = fn;
        void refreshAgent();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      mountedRef.current = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const combinedSessionsMap = new Map<string, Session>(
    (history?.sessions || []).map((s) => [
      s.id,
      { ...s, status: 'history', model: 'default', actualModel: null, permissionMode: 'default' } as Session,
    ]),
  );
  for (const s of sessions) combinedSessionsMap.set(s.id, s);
  const combinedSessions = [...combinedSessionsMap.values()]
    .filter((s) => (s.projectId || 'legacy') === projectId && !sessionMemory.deleted.has(s.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const activeSession = sessions.find((s) => s.id === selectedSessionId);
  const pendingApprovals = approvals.filter((p) => p.sessionId === selectedSessionId);
  const isBusy =
    sending ||
    ['running', 'waiting_permission', 'starting'].includes(activeSession?.status || '') ||
    ['translating', 'submitting'].includes(phaseMap[selectedSessionId] || '');

  const selectProject = useCallback(
    (id: string) => {
      sessionMemory.projectId = id;
      setProjectId(id);
      currentSessionRef.current = '';
      sessionMemory.selectedSessionId = '';
      setSelectedSessionId('');
      setConversation(null);
      setDraftState('');
      setSelectedModel('default');
      const first =
        sessions
          .filter((s) => (s.projectId || 'legacy') === id && !sessionMemory.deleted.has(s.id))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ||
        history?.sessions.find((s) => (s.projectId || 'legacy') === id && !sessionMemory.deleted.has(s.id));
      if (first) {
        void (async () => {
          try {
            if (!sessions.some((s) => s.id === first.id)) {
              upsertSession(await agentService.resumeSession(first.id, id));
            }
            if (sessionMemory.projectId === id) chooseSessionInternal(first.id, id);
          } catch (e) {
            if (sessionMemory.projectId === id) setError(e instanceof Error ? e.message : String(e));
          }
        })();
      }
    },
    [sessions, history, upsertSession, chooseSessionInternal],
  );

  const createProject = useCallback(
    async (name: string, path: string) => {
      const project = await agentService.createProject(name, path);
      setProjects((old) => [...old.filter((p) => p.id !== project.id), project]);
      selectProject(project.id);
      message.success(`项目“${project.name}”已创建`);
      return project;
    },
    [selectProject, message],
  );

  const selectSession = useCallback(
    async (id: string, scope?: string) => {
      try {
        if (!sessions.some((v) => v.id === id)) {
          upsertSession(await agentService.resumeSession(id, scope || projectId));
        }
        chooseSessionInternal(id, scope || projectId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [sessions, projectId, upsertSession, chooseSessionInternal],
  );

  const createSession = useCallback(async (targetProjectId?: string) => {
    if (creatingLockRef.current) return;
    const pid = targetProjectId || projectId;
    creatingLockRef.current = true;
    setCreating(true);
    setError('');
    try {
      const s = await agentService.createSession(pid);
      upsertSession(s);
      chooseSessionInternal(s.id, pid);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      creatingLockRef.current = false;
      setCreating(false);
    }
  }, [projectId, upsertSession, chooseSessionInternal]);

  const deleteSession = useCallback(
    async (id: string) => {
      setError('');
      try {
        await agentService.deleteSession(id);
        forgetSession(id);
        message.success('对话已删除');
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const msg = raw.includes('SESSION_BUSY')
          ? '会话正在初始化或执行，请先停止任务再删除。'
          : `删除失败：${raw}`;
        setError(msg);
        throw new Error(msg);
      }
    },
    [forgetSession, message],
  );

  const applyModel = useCallback(
    async (modelValue?: string) => {
      const targetModel = modelValue ?? selectedModel;
      if (!selectedSessionId) return;
      try {
        upsertSession(await agentService.setModel(selectedSessionId, targetModel));
        message.success(`已切换模型为：${targetModel}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedSessionId, selectedModel, upsertSession, message],
  );

  const changePermissionMode = useCallback(
    async (mode: string) => {
      if (!selectedSessionId) return;
      try {
        upsertSession(await agentService.setPermissionMode(selectedSessionId, mode));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [selectedSessionId, upsertSession],
  );

  const checkTranslator = useCallback(async () => {
    setTranslatorStatus('连接中…');
    try {
      const r = await agentService.getTranslatorStatus();
      setTranslatorStatus(
        r.disabled || r.provider === 'none'
          ? '已关闭翻译'
          : r.provider === 'openai-compatible'
            ? `${r.model} · 翻译测试成功`
            : r.authenticated
              ? `${r.model || 'Codex'} · 已登录`
              : '需要登录',
      );
    } catch (error) {
      setTranslatorStatus(error instanceof Error ? error.message : '连接失败');
    }
  }, []);

  const sendMessage = useCallback(
    async (customText?: string, files?: File[], skipTranslate?: boolean) => {
      const baseText = (customText !== undefined ? customText : draft).trim();
      if ((!baseText && (!files || files.length === 0)) || isBusy || sendingRef.current || !selectedSessionId) return false;
      sendingRef.current = true;
      setSending(true);
      setError('');

      const requestId = crypto.randomUUID();
      const uploadedAttachments: UploadedAttachment[] = [];
      const selectedFiles = getDraftValue<any[]>(`attachments:${selectedSessionId}`) || [];
      sessionMemory.pendingAttachments.set(selectedSessionId, { requestId, uids: selectedFiles.filter(item => files?.includes(item.originFileObj)).map(item => item.uid) });

      try {
        if (files && files.length > 0) {
          for (const file of files) {
            const cached = selectedFiles.find(item => item.originFileObj === file)?.uploaded;
            if (cached?.projectId === projectId) { uploadedAttachments.push(cached); continue; }
            let encoded;
            const safeName = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'}`;
            const relPath = `.isolation-uploads/${safeName}`;
            try {
              encoded = await readFileAsBase64(file);
              await workspaceService.uploadAttachment(projectId, relPath, encoded.base64);
            } catch (uploadErr) {
              throw new Error(
                `附件上传失败 (${file.name})：${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`,
              );
            }
            uploadedAttachments.push({
              uid: crypto.randomUUID(),
              name: file.name,
              path: relPath,
              size: file.size,
              type: file.type,
              dataUrl: file.type.startsWith('image/') ? encoded.dataUrl : undefined,
            });
            const saved = { ...uploadedAttachments.at(-1), projectId };
            setDraftValue(`attachments:${selectedSessionId}`, (getDraftValue<any[]>(`attachments:${selectedSessionId}`) || []).map(item => item.originFileObj === file ? { ...item, uploaded: saved } : item));
          }
          sessionMemory.attachmentsByMessage.set(requestId, uploadedAttachments);
          sessionMemory.attachmentSessions.set(requestId, selectedSessionId);
        }

        sessionMemory.pendingDrafts.set(selectedSessionId, draft);
        await agentService.sendMessage({
          sessionId: selectedSessionId,
          requestId,
          text: baseText || '请查看并分析上述附加的图片/文件。',
          attachmentPaths: uploadedAttachments.map(({ path }) => path),
          translate: skipTranslate ? false : (translateInput && translationEnabled),
          translateOutput: translateOutput && translationEnabled,
        });
        return true;
      } catch (e) {
        sessionMemory.attachmentsByMessage.delete(requestId);
        sessionMemory.pendingDrafts.delete(selectedSessionId);
        sessionMemory.pendingAttachments.delete(selectedSessionId);
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [draft, isBusy, selectedSessionId, projectId, translateInput, translateOutput, translationEnabled],
  );

  const interruptCurrentTask = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      await agentService.interruptTask(selectedSessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedSessionId]);

  const loadOlderMessages = useCallback(async () => {
    if (conversation?.nextBefore == null || paging || !selectedSessionId) return;
    setPaging(true);
    const id = selectedSessionId;
    try {
      const data = await agentService.readHistory(id, conversation.nextBefore, translateOutput && translationEnabled);
      const old = sessionMemory.conversations.get(id);
      if (old) {
        const merged = new Map([...data.messages, ...old.messages].map((m) => [m.id, m]));
        const next: Conversation = {
          ...old,
          messages: [...merged.values()],
          bilingual: { ...data.bilingual, ...old.bilingual },
          answers: [...(data.answers || []), ...(old.answers || [])].filter(
            (v, i, arr) => arr.findIndex((a) => a.approvalId === v.approvalId && a.question === v.question) === i,
          ),
          nextBefore: data.nextBefore,
        };
        sessionMemory.conversations.set(id, next);
        if (currentSessionRef.current === id) setConversation(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaging(false);
    }
  }, [conversation, paging, selectedSessionId, translateOutput, translationEnabled]);

  const retryMessageTranslation = useCallback(
    async (messageId: string) => {
      if (!selectedSessionId) return;
      await agentService.retryTranslation(selectedSessionId, messageId);
      await fetchBilingual(selectedSessionId, messageId);
    },
    [selectedSessionId, fetchBilingual],
  );

  const respondToApproval = useCallback(
    async (requestId: string, allow: boolean, answers?: Record<string, string>) => {
      if (!selectedSessionId) return;
      await agentService.respondApproval({
        sessionId: selectedSessionId,
        requestId,
        allow,
        ...(answers ? { answers } : {}),
      });
    },
    [selectedSessionId],
  );

  return (
    <AgentContext.Provider
      value={{
        projects,
        projectId,
        currentProject: projects.find((p) => p.id === projectId),
        sessions,
        combinedSessions,
        selectedSessionId,
        activeSession,
        conversation,
        draft,
        setDraft,
        searchQuery,
        setSearchQuery,
        connected,
        loading,
        creating,
        paging,
        error,
        clearError: () => setError(''),
        approvals,
        pendingApprovals,
        models,
        selectedModel,
        setSelectedModel,
        commands,
        phaseMap,
        streamMap,
        usageMap,
        accountUsage,
        translateInput,
        setTranslateInput,
        translateOutput,
        setTranslateOutput,
        showTools,
        setShowTools,
        showChinese,
        setShowChinese,
        translatorStatus,
        storagePath,
        activePanel,
        setActivePanel,
        isBusy,
        refreshAgent,
        refreshCapabilities: () => {
          const target = currentSessionRef.current || selectedSessionId;
          return target ? loadCapabilities(target, true) : Promise.resolve();
        },
        selectProject,
        createProject,
        selectSession,
        createSession,
        deleteSession,
        applyModel,
        changePermissionMode,
        checkTranslator,
        sendMessage,
        interruptCurrentTask,
        loadOlderMessages,
        retryMessageTranslation,
        respondToApproval,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
};

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider');
  return ctx;
}
