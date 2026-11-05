import { agentRpc, tauriInvoke } from './api';
import type { GitStatusResult } from './types';
import { uploadAttachment } from './attachment-upload';

export interface WorkspaceFileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
}

export type ExternalEditorId = 'vscode' | 'cursor' | 'antigravity' | 'zed' | 'explorer' | 'terminal';

export const workspaceService = {
  uploadAttachment: (projectId: string, path: string, base64: string) =>
    uploadAttachment(agentRpc, projectId, path, base64),
  listFiles: (projectId: string, path = '.') =>
    agentRpc<{ path: string; root: string; entries: WorkspaceFileEntry[] }>('files.list', { projectId, path }),
  readFile: (projectId: string, path: string) =>
    agentRpc<{ path: string; text: string; revision: string; bytes: number }>('files.read', { projectId, path }),
  gitInit: (projectId: string) =>
    agentRpc<{ initialized: boolean }>('git.init', { projectId }),
  gitStatus: (projectId: string) =>
    agentRpc<GitStatusResult>('git.status', { projectId }),
  gitDiff: (projectId: string, file?: string, staged = false) =>
    agentRpc<{ text: string }>('git.diff', { projectId, ...(file ? { file } : {}), ...(staged ? { staged } : {}) }),
  gitStage: (projectId: string, files: string[]) =>
    agentRpc<{ updated: boolean }>('git.stage', { projectId, files }),
  gitUnstage: (projectId: string, files: string[]) =>
    agentRpc<{ updated: boolean }>('git.unstage', { projectId, files }),
  gitCommit: (projectId: string, message: string) =>
    agentRpc<{ text: string }>('git.commit', { projectId, message }),
  gitBranches: (projectId: string) =>
    agentRpc<{ text: string }>('git.branches', { projectId }),
  gitCheckout: (projectId: string, branch: string, create = false) =>
    agentRpc<{ switched: boolean }>('git.checkout', { projectId, branch, ...(create ? { create: true } : {}) }),
  gitLog: (projectId: string) =>
    agentRpc<{ commits: { id: string; subject: string; author: string; time: string }[] }>('git.log', { projectId }),
  gitRemotes: (projectId: string) =>
    agentRpc<{ remotes: { name: string; url: string }[] }>('git.remotes', { projectId }),
  gitFetch: (projectId: string, remote = 'origin') =>
    agentRpc<{ text: string }>('git.fetch', { projectId, remote }),
  gitPull: (projectId: string, remote = 'origin') =>
    agentRpc<{ text: string }>('git.pull', { projectId, remote }),
  gitPush: (projectId: string, remote = 'origin') =>
    agentRpc<{ text: string }>('git.push', { projectId, remote }),
  openInEditor: (editor: ExternalEditorId, wslPath: string, distro?: string) =>
    tauriInvoke<{ opened: boolean; editor: string; path: string }>('open_in_editor', {
      editor,
      wslPath,
      distro,
    }),
  ensureWindowWidth: (targetInnerWidth: number, allowShrink = false) =>
    tauriInvoke<{
      resized: boolean;
      previousInnerWidth?: number;
      innerWidth?: number;
      reason?: string;
    }>('ensure_window_width', {
      targetInnerWidth: Math.round(targetInnerWidth),
      allowShrink,
    }),

  readMcp: (projectId: string) =>
    agentRpc<{ config: Record<string, unknown>; revision: string }>('mcp.read', { projectId }),
  writeMcp: (projectId: string, config: Record<string, unknown>, revision: string) =>
    agentRpc<{ config: Record<string, unknown>; revision: string; applied: boolean }>('mcp.write', {
      projectId,
      config,
      revision,
    }),
  applyMcp: (projectId: string, sessionId: string) =>
    agentRpc<{ added: string[]; removed: string[]; errors: string[]; servers: any[] }>('mcp.apply', {
      projectId,
      sessionId,
    }),
  statusMcp: (projectId: string, sessionId: string) =>
    agentRpc<any[]>('mcp.status', { projectId, sessionId }),
  reconnectMcp: (projectId: string, sessionId: string, name: string) =>
    agentRpc<any[]>('mcp.reconnect', { projectId, sessionId, name }),

  listTerminals: (projectId: string) =>
    agentRpc<{ id: string; exited: boolean }[]>('terminal.list', { projectId }),
  openTerminal: (projectId: string, cols = 100, rows = 30, path = '.') =>
    agentRpc<{ id: string }>('terminal.open', { projectId, path, cols, rows }),
  readTerminal: (projectId: string, id: string, after = 0) =>
    agentRpc<{ data: string; offset: number; gap: boolean; exited: boolean }>('terminal.read', {
      projectId,
      id,
      after,
    }),
  inputTerminal: (projectId: string, id: string, data: string) =>
    agentRpc('terminal.input', { projectId, id, data }),
  resizeTerminal: (projectId: string, id: string, cols: number, rows: number) =>
    agentRpc('terminal.resize', { projectId, id, cols, rows }),
  closeTerminal: (projectId: string, id: string) => agentRpc('terminal.close', { projectId, id }),
};
