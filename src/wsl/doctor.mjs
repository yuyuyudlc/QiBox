import { listWslDistros, runWsl } from './wsl.mjs';

let cachedContext = null;

export function clearWslContextCache() {
  cachedContext = null;
}

export async function wslContext(policy, { fresh = false, ttlMs = 10000 } = {}) {
  const distro = policy?.runtime?.distro || 'Ubuntu';
  const user = policy.runtime.user;
  if (!fresh && cachedContext && cachedContext.distro === distro && cachedContext.user === user && Date.now() - cachedContext.at < ttlMs) {
    return { ...cachedContext.value };
  }

  const distros = await listWslDistros();
  const target = distros.find((d) => d.name === distro);
  if (!target) {
    cachedContext = null;
    return { available: false, distro, user, reason: `未找到 WSL 发行版 ${distro}，请先运行 wsl --install -d ${distro}` };
  }
  if (target.version !== 2) {
    cachedContext = null;
    return { available: false, distro, user, reason: `WSL 发行版 ${distro} 不是 WSL2 (当前版本: ${target.version})` };
  }
  if (!user) {
    return { available: false, distro, user, reason: `无法读取 ${distro} 的默认普通用户。请先打开该发行版完成初始化，或在设置中选择已有的 Linux 用户。` };
  }

  const check = await runWsl(
    distro,
    [
      'sh',
      '-c',
      [
        'PATH=/usr/local/bin:/usr/bin:/bin',
        'missing=""',
        'command -v node >/dev/null 2>&1 || missing="$missing node"',
        'command -v claude >/dev/null 2>&1 || missing="$missing claude"',
        'test -d /opt/isolation/node_modules/@anthropic-ai/claude-agent-sdk || missing="$missing @anthropic-ai/claude-agent-sdk"',
        'test -d /opt/isolation/node_modules/node-pty || missing="$missing node-pty"',
        'if [ -z "$missing" ]; then echo OK; else echo "MISSING:$missing"; fi',
      ].join('; '),
    ],
    { timeout: 10000, user },
  );
  const stdout = check.stdout || '';
  const ready = check.ok && stdout.trim() === 'OK';
  const missingMatch = stdout.match(/MISSING:\s*(.+)/);
  const missingList = missingMatch ? missingMatch[1].trim().split(/\s+/).join('、') : '';
  const reason = ready
    ? null
    : !check.ok
      ? `无法以 Linux 用户 ${user} 访问 WSL2（${distro}），请确认该用户存在或按 README 准备 WSL2 环境。`
      : missingList
        ? `WSL2（/usr/local/bin:/usr/bin）缺少依赖：${missingList}。请按 README 在 WSL2 中安装后再启动。`
        : 'WSL2 依赖检查未通过，请按 README 检查 Node.js、Claude Code 与 /opt/isolation 依赖。';
  const value = {
    available: true,
    distro,
    user,
    state: target.state,
    version: target.version,
    dependenciesReady: ready,
    reason,
  };
  cachedContext = { at: Date.now(), distro, user, value };
  return { ...value };
}

export async function doctor(p) {
  const wsl = await wslContext(p, { fresh: true });
  return {
    time: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    wsl,
    readyForRuntime: wsl.available && wsl.dependenciesReady,
    nextActions: !wsl.available
      ? [wsl.reason]
      : !wsl.dependenciesReady
        ? ['Ensure Node.js 24, Claude Code, and /opt/isolation (@anthropic-ai/claude-agent-sdk + node-pty) are installed in WSL2.']
        : [],
  };
}
