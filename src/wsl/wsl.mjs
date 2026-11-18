import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, POLICY_PATH, isLinuxUsername, loadPolicy } from '../core/policy.mjs';
import { run } from '../core/process.mjs';
import { buildInfo } from '../core/build-info.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

let activeDaemonChild = null;

export function wslExecutable() {
  return process.platform === 'win32' ? 'wsl.exe' : 'wsl';
}

export function wslEnvVars(env = process.env) {
  return { ...env, WSL_UTF8: '1' };
}

export async function runWsl(distro, args, opts = {}) {
  const userArgs = opts.user ? ['-u', opts.user] : [];
  return run(wslExecutable(), ['-d', distro, ...userArgs, '--', ...args], {
    ...opts,
    env: wslEnvVars(opts.env),
  });
}

export async function loadWslPolicy() {
  const policy = loadPolicy();
  if (policy.runtime.user || process.platform !== 'win32') return policy;

  const { distro } = policy.runtime;
  const distros = await listWslDistros();
  if (!distros.some((entry) => entry.name === distro && entry.version === 2)) return policy;

  const result = await runWsl(distro, ['id', '-un'], { timeout: 5000 });
  const user = result.stdout.trim();
  if (!result.ok || user === 'root' || !isLinuxUsername(user)) return policy;

  policy.runtime.user = user;
  try {
    fs.writeFileSync(POLICY_PATH, JSON.stringify(policy, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return loadPolicy();
    throw error;
  }
  return policy;
}

export function spawnWsl(distro, args, opts = {}) {
  const userArgs = opts.user ? ['-u', opts.user] : [];
  return spawn(wslExecutable(), ['-d', distro, ...userArgs, '--', ...args], {
    windowsHide: true,
    shell: false,
    ...opts,
    env: wslEnvVars(opts.env),
  });
}

export async function listWslDistros({ execute = run } = {}) {
  if (process.platform !== 'win32') return [];
  const res = await execute(wslExecutable(), ['--list', '--verbose'], {
    timeout: 5000,
    env: wslEnvVars(),
  });
  if (!res.ok) return [];
  const lines = res.stdout.split(/\r?\n/).slice(1);
  const distros = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isDefault = line.startsWith('*');
    const cleaned = isDefault ? line.slice(1).trim() : line;
    const match = cleaned.match(/^(.+?)\s+(Running|Stopped)\s+(\d+)$/i);
    if (match) {
      distros.push({
        name: match[1].trim(),
        state: match[2],
        version: Number(match[3]),
        isDefault,
      });
    }
  }
  return distros;
}

export function toWslPath(winPath) {
  if (typeof winPath !== 'string' || !winPath) return winPath;
  if (winPath.startsWith('/')) return winPath;
  const resolved = path.win32.resolve(winPath);
  const drive = resolved.match(/^([a-zA-Z]):\\(.*)$/);
  if (drive) {
    const rest = drive[2].replaceAll('\\', '/');
    return `/mnt/${drive[1].toLowerCase()}/${rest}`;
  }
  return resolved.replaceAll('\\', '/');
}

export function buildWorkerEnv(policy) {
  const { user } = policy.runtime;
  const env = {
    USER: user,
    LOGNAME: user,
    TZ: policy.environment.timezone,
    LANG: policy.environment.locale,
    LC_ALL: policy.environment.locale,
    PATH: '/usr/local/bin:/usr/bin:/bin',
    DISABLE_AUTOUPDATER: '1',
    BROWSER: policy.environment.blockWindowsBrowser === false ? '' : '/bin/false',
  };
  if (policy.environment.disableNonessentialTraffic) {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }
  if (policy.network?.proxyUrl) {
    env.HTTP_PROXY = policy.network.proxyUrl;
    env.HTTPS_PROXY = policy.network.proxyUrl;
    env.http_proxy = policy.network.proxyUrl;
    env.https_proxy = policy.network.proxyUrl;
    env.NO_PROXY = 'localhost,127.0.0.1,::1';
    env.no_proxy = 'localhost,127.0.0.1,::1';
    env.NODE_USE_ENV_PROXY = '1';
  }
  return env;
}

export async function syncCodeToWsl(policy) {
  const { distro, user } = policy.runtime;
  const srcWsl = toWslPath(path.join(ROOT, 'src'));
  const workspaceRoot = policy.workspace?.defaultRoot || '/workspace';
  const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
  const build = buildInfo();
  const res = await runWsl(
    distro,
    [
      'bash',
      '-lc',
      `rm -rf /opt/isolation/src && mkdir -p /opt/isolation/src ${quote(workspaceRoot)} /tmp/isolation-agent && cp -rf ${quote(srcWsl)}/. /opt/isolation/src/`,
    ],
    { timeout: 15000, user },
  );
  if (!res.ok) throw new Error(`SYNC_WSL_CODE_FAILED: ${res.stderr || res.error || res.code}`);
  const writeBuild = await runWsl(
    distro,
    ['node', '-e', "require('fs').writeFileSync('/opt/isolation/build-info.json', process.argv[1])", JSON.stringify(build, null, 2) + '\n'],
    { timeout: 5000, user },
  );
  if (!writeBuild.ok) throw new Error('WRITE_BUILD_INFO_FAILED');
  return build;
}

export async function isWslDaemonAlive(distro, user) {
  const check = await runWsl(
    distro,
    [
      'node',
      '-e',
      "const net=require('net');const s=net.createConnection('/tmp/isolation-agent/runtime.sock');s.on('connect',()=>{s.destroy();process.exit(0);});s.on('error',()=>process.exit(1));",
    ],
    { timeout: 3000, user },
  );
  return check.ok;
}

export async function startWslDaemon(policy, { keepChild = true } = {}) {
  const { distro, user } = policy.runtime;
  const runtimeDir = path.join(ROOT, '.runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  await syncCodeToWsl(policy);
  await stopWslDaemon(policy);

  const workerEnv = {
    ...buildWorkerEnv(policy),
    ISOLATION_WORKSPACE: policy.workspace.defaultRoot || '/workspace',
    ISOLATION_RUNTIME_DIR: '/tmp/isolation-agent',
  };

  const logFile = path.join(runtimeDir, 'wsl-daemon.log');
  const daemonLog = fs.openSync(logFile, 'a');
  const envArgs = Object.entries(workerEnv).map(([k, v]) => `${k}=${v}`);

  const child = spawn(
    wslExecutable(),
    ['-d', distro, '-u', user, '--', 'env', ...envArgs, 'node', '/opt/isolation/src/runtime/daemon.mjs'],
    {
      detached: !keepChild,
      stdio: ['pipe', daemonLog, daemonLog],
      windowsHide: true,
      shell: false,
      env: wslEnvVars(),
    },
  );
  // Keep stdin open (unwritten) when owned by agent-server so WSL never treats EOF as session end.
  if (keepChild) {
    activeDaemonChild = child;
    child.on('exit', () => {
      if (activeDaemonChild === child) activeDaemonChild = null;
    });
  } else {
    child.stdin.end();
    child.unref();
  }
  fs.closeSync(daemonLog);

  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await isWslDaemonAlive(distro, user)) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw new Error('DAEMON_SOCKET_TIMEOUT');

  const manifestPath = path.join(runtimeDir, 'wsl-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        backend: 'wsl',
        distro,
        user,
        projectName: policy.projectName,
        policyHash: hash(policy),
        time: new Date().toISOString(),
        verification: 'PASS',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}

export async function stopWslDaemon(policy) {
  const { distro, user } = policy.runtime;
  await runWsl(distro, ['pkill', '-f', '/opt/isolation/src/runtime/daemon.mjs'], { timeout: 5000, user });
  if (activeDaemonChild) {
    try {
      activeDaemonChild.stdin?.end();
      activeDaemonChild.kill();
    } catch {}
    activeDaemonChild = null;
  }
}
