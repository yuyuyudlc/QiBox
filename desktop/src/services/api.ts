import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentEvent } from './types';

/**
 * 底层 Tauri IPC 调用与 Agent JSON-RPC 统一封装
 */
export async function tauriInvoke<T = any>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(formatErrorCode(message));
  }
}

/**
 * 调用 Node AgentService 的 JSON-RPC 方法
 */
export async function agentRpc<T = any>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return tauriInvoke<T>('agent_request', { method, params });
}

/**
 * 监听来自 WSL2 / 宿主 AgentService 的实时事件流
 */
export function subscribeAgentEvents(handler: (event: AgentEvent) => void): Promise<UnlistenFn> {
  return listen<AgentEvent>('agent-event', (event) => {
    handler(event.payload);
  });
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  TRANSLATION_API_HTTP_401: '翻译接口拒绝了密钥，请检查密钥和基础地址。',
  TRANSLATION_API_HTTP_402: '翻译接口余额不足。',
  TRANSLATION_API_HTTP_404: '翻译接口或模型不存在，请检查基础地址和模型名称。',
  TRANSLATION_API_HTTP_429: '翻译接口请求过于频繁，请稍后重试。',
  SESSION_STATE_INVALID: '会话元数据格式异常，原文件已保留。请从备份恢复后再启动。',
  FILE_CHANGED: '文件已被其他操作修改，请保留草稿并重新读取后合并。',
  RPC_RESPONSE_TOO_LARGE: '返回内容过大，请缩小读取范围。',
  TRANSLATOR_EXECUTABLE_NOT_FOUND: '未找到 Codex 翻译程序，请检查安装或设置 ISOLATION_CODEX_EXECUTABLE。',
  TRANSLATION_DISABLED: '当前已关闭翻译服务，如需翻译请在“设置 → 对话与翻译”启用。',
  HISTORY_CONTENT_TRUNCATED: '该历史内容超过完整读取上限，请在原生历史中查看。',
  VERIFIED_RUNTIME_REQUIRED: 'WSL2 工作环境尚未运行，请先启动环境。',
  WORKER_UNAVAILABLE: 'WSL2 后台服务暂不可用，请检查运行环境状态。',
  SESSION_BUSY: '当前会话正在初始化或执行任务，请先停止任务或稍候再试。',
  FILE_TOO_LARGE: '文件体积超出直接读写上限。',
  BINARY_FILE: '该文件为二进制文件，无法作为纯文本编辑。',
};

export function formatErrorCode(raw: string): string {
  for (const [code, readable] of Object.entries(KNOWN_ERROR_MESSAGES)) {
    if (raw.includes(code)) return readable;
  }
  return raw;
}
