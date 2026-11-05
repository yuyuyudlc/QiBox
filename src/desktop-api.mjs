import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, POLICY_PATH, loadPolicy, validatePolicy, validateWorkspace } from './core/policy.mjs';
import { clearWslContextCache, wslContext } from './wsl/doctor.mjs';
import { runtimeSnapshot, clearRuntimeStateCache } from './wsl/runtime-state.mjs';
import { startWslDaemon, stopWslDaemon, listWslDistros } from './wsl/wsl.mjs';
import { syncInfo, syncClaude } from './wsl/claude-sync.mjs';
import { readCodexSource, syncCodex } from './wsl/codex-sync.mjs';
import { RuntimeClient } from './agent/runtime-client.mjs';
import { publicChatPreferences, readChatPreferences, targetLanguages } from './agent/chat-preferences.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export { runtimeSnapshot };

export function isMutatingConsoleRequest(request) {
  if (!request || typeof request !== 'object') return false;
  const { action, payload = {} } = request;
  if (action === 'snapshot' || action === 'validate') return false;
  if (action === 'claude_sync') return !['info', 'codex_info'].includes(payload?.operation);
  return true;
}

export function createConsoleDispatcher({ handle = handleRequest, onMutated = () => {} } = {}) {
  let mutationChain = Promise.resolve();
  return async function dispatchConsoleRequest(request) {
    const mutating = isMutatingConsoleRequest(request);
    const executeOne = async () => {
      try {
        const result = await handle(request);
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: error?.message || '本地操作失败' };
      } finally {
        if (mutating) {
          clearWslContextCache();
          clearRuntimeStateCache();
          try {
            onMutated(request);
          } catch {}
        }
      }
    };
    if (!mutating) return executeOne();
    const next = mutationChain.then(executeOne, executeOne);
    mutationChain = next.then(
      () => {},
      () => {},
    );
    return next;
  };
}

export async function savePolicy(payload, { policyPath = POLICY_PATH, getRuntime = runtimeSnapshot } = {}) {
  const current = JSON.parse(fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, ''));
  if (payload.expectedHash !== hash(current)) throw new Error('配置已被其他窗口或命令修改，请重新加载后再保存');
  const next = validatePolicy(payload.policy);
  validateWorkspace(next);
  if (next.projectName !== current.projectName) throw new Error('桌面界面不支持重命名受管项目');
  const runtime = await getRuntime(validatePolicy(current));
  if (runtime.running) throw new Error('请先停止当前运行环境，再保存配置');
  const temp = path.join(path.dirname(policyPath), `.isolation-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const latest = JSON.parse(fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, ''));
    if (payload.expectedHash !== hash(latest)) throw new Error('配置在保存前发生变化，请重新加载');
    fs.renameSync(temp, policyPath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return { saved: true, policy: next, policyHash: hash(next) };
}

export async function handleRequest(request) {
  const { action, payload = {} } = request;
  if (action === 'claude_sync') {
    if (payload.operation === 'codex_info') return readCodexSource({ user: loadPolicy().runtime.user }).preview;
    if (payload.operation === 'codex_sync') return syncCodex(payload.expectedSourceHash, loadPolicy(), { getRuntime: runtimeSnapshot });
    if (payload.operation === 'reset') {
      const client = new RuntimeClient();
      try {
        return await client.call('auth.reset', { confirm: true });
      } catch (e) {
        const messages = {
          SESSION_BUSY: 'Claude 正在执行或初始化，请等任务结束后再恢复未登录状态。',
          PROJECT_AUTH_OVERRIDE: '项目存在独立认证配置，请先移除项目中的 API / OAuth 配置。',
          INHERITED_AUTH_REQUIRES_RESTART: 'WSL 进程环境包含认证变量，需要移除后重启环境。',
          AUTH_STATE_INVALID: 'WSL 认证配置格式异常，未更改原文件。',
          AUTH_SYNC_BUSY: '正在同步配置，请稍后重试。',
        };
        throw Error(messages[e.message] || '恢复未登录状态失败，请确认 WSL 环境已启动。');
      } finally {
        client.close();
      }
    }
    const policy = loadPolicy();
    if (payload.operation === 'info') return syncInfo(policy);
    if (payload.operation === 'sync') return syncClaude({ expectedSourceHash: payload.expectedSourceHash }, policy, { getRuntime: runtimeSnapshot });
    throw new Error('不允许的 Claude 配置操作');
  }
  if (action === 'snapshot') {
    const policy = loadPolicy();
    const [runtime, wslDistros] = await Promise.all([
      runtimeSnapshot(policy),
      listWslDistros().catch(() => []),
    ]);
    return {
      root: ROOT,
      policy,
      policyHash: hash(policy),
      chatPreferences: publicChatPreferences(readChatPreferences(undefined, policy)),
      targetLanguages,
      wslDistros,
      runtime,
    };
  }
  if (action === 'validate') {
    const policy = validatePolicy(payload.policy);
    validateWorkspace(policy);
    return { valid: true, policyHash: hash(policy) };
  }
  if (action === 'save') return savePolicy(payload);
  if (action === 'operation') {
    if (!['up', 'stop'].includes(payload.operation)) throw new Error('不允许的操作');
    const policy = loadPolicy();
    if (payload.operation === 'up') {
      const wsl = await wslContext(policy, { fresh: true });
      if (!wsl.available || !wsl.dependenciesReady) throw new Error(wsl.reason);
      await startWslDaemon(policy, { keepChild: true });
      return { ok: true, code: 0, output: 'WSL2 daemon started', error: null };
    }
    await stopWslDaemon(policy);
    return { ok: true, code: 0, output: 'WSL2 daemon stopped', error: null };
  }
  throw new Error('不允许的桌面请求');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 262144) throw new Error('请求过大');
    }
    const result = await handleRequest(JSON.parse(input));
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
