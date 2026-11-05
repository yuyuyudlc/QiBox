export type BlockType = 'text' | 'tool_use' | 'tool_result';
export type LanguageHint = 'japanese_kana' | 'han_only' | 'other';
export type WorkspacePanelKey = 'chat' | 'mcp' | 'terminal';

export interface MessageBlock {
  type: BlockType;
  text: string;
  name?: string;
  isError?: boolean;
}

export interface UploadedAttachment {
  uid: string;
  name: string;
  path: string;
  size: number;
  type: string;
  dataUrl?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  kind?: 'command' | 'command_result';
  time: string | null;
  blocks: MessageBlock[];
  languageHint: LanguageHint;
  attachments?: UploadedAttachment[];
}

export interface BilingualRecord {
  requestId: string | null;
  messageId: string;
  originalChinese: string | null;
  chinese: string | null;
  status: string;
  sourceKind?: 'recorded' | 'history';
}

export interface ToolAnswerRecord {
  approvalId: string;
  turnRequestId: string;
  question: string;
  source: string;
  translated: number;
}

export interface Conversation {
  sessionId: string;
  messages: Message[];
  nextBefore: number | null;
  outputTruncated: boolean;
  ignoredLines: number;
  bilingual?: Record<string, BilingualRecord>;
  answers?: ToolAnswerRecord[];
}

export interface Project {
  id: string;
  name: string;
  root: string;
  legacy?: boolean;
}

export interface Session {
  projectId?: string;
  cwd?: string;
  id: string;
  title: string;
  status: string;
  state?: string;
  model: string;
  actualModel: string | null;
  permissionMode: string;
  updatedAt: string;
  turns: number;
}

export interface HistoryListing {
  sessions: Session[];
  limited: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface ApprovalQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface ApprovalRequest {
  requestId: string;
  sessionId: string;
  kind: 'question' | 'permission' | string;
  toolName: string;
  input: { questions?: ApprovalQuestion[]; [key: string]: unknown };
}

export interface AgentEvent {
  kind: string;
  sessionId: string;
  seq?: number;
  [key: string]: any;
}

export interface ModelOption {
  value: string;
  displayName?: string;
  description?: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextTokens: number;
  contextWindow: number;
  costUsd: number;
}

export interface RateLimitWindow {
  utilization: number;
  resetsAt?: string | number | null;
  status?: 'allowed' | 'allowed_warning' | 'rejected';
}

export interface AccountUsage {
  subscriptionType?: string | null;
  rateLimitsAvailable?: boolean;
  fiveHour?: RateLimitWindow | null;
  sevenDay?: RateLimitWindow | null;
  updatedAt?: number;
}

export interface GitStatusEntry {
  status: string;
  path: string;
  from?: string;
}

export interface GitStatusResult {
  root: string;
  branch: string;
  entries: GitStatusEntry[];
}

export interface Policy {
  schemaVersion: number;
  projectName: string;
  runtime: {
    backend: 'wsl';
    distro: string;
    user: string;
    hostname?: string;
    claudeVersion?: string;
  };
  environment: {
    timezone: string;
    locale: string;
    disableNonessentialTraffic: boolean;
    blockWindowsBrowser: boolean;
  };
  network: {
    proxyUrl: string | null;
  };
  workspace: { defaultRoot: string };
  chat: { allowedTools: string[] };
  audit?: { retentionDays: number; rawContent: boolean };
}

export interface ChatPreferences {
  provider: 'none' | 'codex' | 'openai-compatible';
  apiBaseUrl: string;
  apiModel: string;
  hasApiKey: boolean;
  apiKey?: string;
  targetLanguage: string;
  outputLanguage: string;
  model: string;
  allowedTools: string[];
}

export interface WslDistroInfo {
  name: string;
  state: string;
  version: number;
  isDefault: boolean;
}

export interface Snapshot {
  chatPreferences: ChatPreferences;
  targetLanguages: Record<string, string>;
  wslDistros?: WslDistroInfo[];
  root: string;
  policy: Policy;
  policyHash: string;
  runtime: {
    engineAvailable: boolean;
    backend?: string;
    distro?: string;
    user?: string;
    state?: string;
    dependenciesReady?: boolean;
    claudeVersion?: string | null;
    reason?: string | null;
    version?: number;
    exists: boolean;
    running: boolean;
    verified: boolean;
    policyMatches?: boolean;
    codeMatches?: boolean;
    expectedBuild?: { runtimeFingerprint: string };
    deployedBuild?: { runtimeFingerprint: string } | null;
  };
}

export interface ClaudeSyncInfo {
  sourcePath: string;
  sourceHash: string;
  modifiedAt: string;
  targetPath: string;
  endpointHost: string | null;
  hasCredential: boolean;
  settingKeys: string[];
  envKeys: string[];
  skipped: string[];
  blockedReason: string | null;
  networkAllowed: boolean;
  lastSync: { time: string; changed: boolean; backupCreated: boolean; configHash: string } | null;
}

export const getSessionModelLabel = (session?: Session) =>
  session?.actualModel || (session?.model && session.model !== 'default' ? session.model : '接口默认');

export const PERMISSION_MODES: Record<string, string> = {
  default: '逐项审批',
  acceptEdits: '自动编辑',
  plan: '计划模式',
  bypassPermissions: 'WSL2 内自动批准',
  dontAsk: '不询问，未授权则拒绝',
  auto: 'Claude 自动判断',
};

export const SESSION_STATE_LABELS: Record<string, string> = {
  idle: '就绪',
  running: '执行中',
  waiting_permission: '等待你的决定',
  interrupted: '已中断',
  failed: '执行失败',
  history: '历史会话',
  starting: '正在启动',
  completed: '已完成',
  cancelled: '已取消',
  timeout: '已超时',
  blocked_permission: '权限拦截',
};

export const formatTime = (v?: string | null, fallback = '尚无记录') =>
  v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : fallback;

export const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : bytes >= 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${bytes} B`;

export const joinPath = (dir: string, name: string) => (dir === '.' ? name : `${dir}/${name}`);
export const parentPath = (dir: string) => dir.split('/').slice(0, -1).join('/') || '.';
