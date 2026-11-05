import { agentRpc } from './api';
import type {
  ApprovalRequest,
  BilingualRecord,
  Conversation,
  HistoryListing,
  ModelOption,
  Project,
  Session,
  SlashCommand,
} from './types';

export interface AgentStatusResponse {
  protocol: number;
  ready: boolean;
  bootId: string;
  seq: number;
  sessions: Session[];
  projects: Project[];
  models: ModelOption[];
  commands: SlashCommand[];
  modes: string[];
  storage?: { path: string };
}

export interface CapabilitiesResponse {
  models: ModelOption[];
  commands: SlashCommand[];
  tools: string[];
  modes: string[];
  permissionMode: string;
  model: string;
  actualModel: string | null;
}

export const agentService = {
  getStatus: () => agentRpc<AgentStatusResponse>('status'),
  listProjects: () => agentRpc<Project[]>('projects.list'),
  createProject: (name: string, path: string) => agentRpc<Project>('projects.create', { name, path }),
  listHistory: async () => {
    const result = await agentRpc<HistoryListing & { nextCursor?: number | null }>('history.list');
    let cursor = result.nextCursor;
    while (cursor != null) {
      const page = await agentRpc<HistoryListing & { nextCursor?: number | null }>('history.list', { cursor });
      result.sessions.push(...page.sessions); cursor = page.nextCursor;
    }
    return result;
  },
  readHistory: (sessionId: string, before?: number | null, translateOutput = true) =>
    agentRpc<Conversation>('history.read', { sessionId, translateOutput, ...(before != null ? { before } : {}) }),
  createSession: (projectId: string) => agentRpc<Session>('session.create', { projectId }),
  resumeSession: (sessionId: string, projectId?: string) =>
    agentRpc<Session>('session.resume', { sessionId, ...(projectId ? { projectId } : {}) }),
  deleteSession: (sessionId: string) =>
    agentRpc<{ deleted: boolean; sessionId: string }>('session.delete', { sessionId, confirm: true }),
  readCapabilities: (sessionId: string, initialize = false) =>
    agentRpc<CapabilitiesResponse>('capabilities.read', { sessionId, initialize }),
  setModel: (sessionId: string, model: string) => agentRpc<Session>('model.set', { sessionId, model }),
  setPermissionMode: (sessionId: string, mode: string) =>
    agentRpc<Session>('permission.setMode', { sessionId, mode }),
  sendMessage: (params: {
    sessionId: string;
    requestId: string;
    text: string;
    attachmentPaths?: string[];
    translate: boolean;
    translateOutput: boolean;
  }) => agentRpc<{ accepted: boolean; requestId: string; stage: string }>('message.send', params),
  interruptTask: (sessionId: string) => agentRpc<{ interrupted: boolean }>('task.interrupt', { sessionId }),
  listApprovals: () => agentRpc<ApprovalRequest[]>('approvals.list'),
  respondApproval: (params: {
    sessionId: string;
    requestId: string;
    allow: boolean;
    answers?: Record<string, string>;
  }) => agentRpc<{ resolved: boolean }>('approval.respond', params),
  readTranslations: (sessionId: string, messageIds: string[]) =>
    agentRpc<Record<string, BilingualRecord>>('translations.read', { sessionId, messageIds }),
  retryTranslation: (sessionId: string, messageId: string) =>
    agentRpc<Record<string, BilingualRecord>>('translations.retry', { sessionId, messageId }),
  getTranslatorStatus: () => agentRpc<{ authenticated: boolean; model?: string; provider?: string; disabled?: boolean }>('translator.status'),
  getEventsSince: async (after: number, sessionId?: string) => {
    type Replay = { bootId: string; seq: number; gap: boolean; events: any[]; nextAfter?: number; hasMore?: boolean };
    const result = await agentRpc<Replay>('events.since', { after, ...(sessionId ? { sessionId } : {}) });
    let page = result;
    while (page.hasMore && page.nextAfter != null) {
      page = await agentRpc<Replay>('events.since', { after: page.nextAfter, ...(sessionId ? { sessionId } : {}) });
      result.events.push(...page.events); result.gap ||= page.gap;
    }
    return result;
  },
};
