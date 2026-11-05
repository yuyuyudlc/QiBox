import { tauriInvoke } from './api';
import type { ClaudeSyncInfo, Policy, Snapshot } from './types';

export const consoleService = {
  getSnapshot: () => tauriInvoke<Snapshot>('get_snapshot'),

  validatePolicy: (policy: Policy) => tauriInvoke('validate_policy', { policy }),

  savePolicy: (policy: Policy, expectedHash: string) => tauriInvoke('save_policy', { policy, expectedHash }),

  runOperation: (operation: 'up' | 'stop') =>
    tauriInvoke<{ ok: boolean; output: string; error: string | null }>('run_operation', {
      operation,
    }),

  claudeSync: (
    operation: 'info' | 'sync' | 'reset' | 'codex_info' | 'codex_sync',
    expectedSourceHash: string | null = null,
  ) => tauriInvoke<any>('claude_sync', { operation, expectedSourceHash }),

  getClaudeSyncInfo: () => tauriInvoke<ClaudeSyncInfo>('claude_sync', { operation: 'info', expectedSourceHash: null }),
};
