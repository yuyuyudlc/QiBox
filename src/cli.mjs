import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './core/policy.mjs';
import { doctor, wslContext } from './wsl/doctor.mjs';
import { buildWorkerEnv, listWslDistros, loadWslPolicy, runWsl, startWslDaemon, stopWslDaemon, toWslPath } from './wsl/wsl.mjs';

const reportsDir = path.join(ROOT, 'reports');
const output = (value) => console.log(JSON.stringify(value, null, 2));

function save(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode });
}

function pruneReports(days) {
  if (!fs.existsSync(reportsDir)) return;
  for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^runtime-\d+\.json$/.test(entry.name)) continue;
    const file = path.join(reportsDir, entry.name);
    if (Date.now() - fs.statSync(file).mtimeMs > days * 86400000) fs.unlinkSync(file);
  }
}

async function main() {
  const [action = 'help', ...args] = process.argv.slice(2);
  if (action === 'help') {
    console.log(
      'Agent Isolation (WSL2)\n  setup        安装并配置 WSL2 运行依赖\n  doctor       检查 WSL2 与 Node.js / Claude Code 依赖\n  up           同步代码并启动 WSL2 后台服务\n  stop         停止 WSL2 后台服务\n  verify       验证 WSL2 环境并记录报告\n  probe        导出 WSL2 内可见环境信息\n  exec -- CMD  在 WSL2 环境内执行命令',
    );
    return;
  }
  const p = await loadWslPolicy();
  if (action === 'setup') {
    await setupWsl(p);
    return;
  }
  pruneReports(p.audit?.retentionDays ?? 7);

  if (action === 'doctor') {
    const report = await doctor(p);
    save(path.join(reportsDir, 'doctor.json'), report);
    output(report);
    process.exitCode = report.readyForRuntime ? 0 : 2;
    return;
  }
  if (!p.runtime.user && action !== 'verify') {
    const wsl = await wslContext(p);
    throw new Error(wsl.reason);
  }
  if (action === 'up' || action === 'resume') {
    const wsl = await wslContext(p, { fresh: true });
    if (!wsl.available || !wsl.dependenciesReady) throw new Error(wsl.reason);
    await startWslDaemon(p, { keepChild: false });
    output({ started: true, backend: 'wsl', distro: p.runtime.distro });
    return;
  }
  if (action === 'stop' || action === 'down') {
    await stopWslDaemon(p);
    output({ stopped: true });
    return;
  }
  if (action === 'probe') {
    const workerEnv = buildWorkerEnv(p);
    const envArgs = Object.entries(workerEnv).map(([k, v]) => `${k}=${v}`);
    const res = await runWsl(
      p.runtime.distro,
      [
        'env',
        ...envArgs,
        'node',
        '-e',
        "const os=require('os'),fs=require('fs');console.log(JSON.stringify({hostname:os.hostname(),user:os.userInfo().username,home:os.homedir(),tz:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:Intl.DateTimeFormat().resolvedOptions().locale,kernel:os.release(),browserEnv:process.env.BROWSER||null,xdgOpen:fs.existsSync('/usr/local/bin/xdg-open')?fs.readlinkSync('/usr/local/bin/xdg-open'):null},null,2))",
      ],
      { timeout: 10000, user: p.runtime.user },
    );
    if (!res.ok) throw new Error(res.stderr || 'PROBE_FAILED');
    const report = JSON.parse(res.stdout);
    save(path.join(reportsDir, 'probe.json'), report);
    output(report);
    return;
  }
  if (action === 'verify') {
    const wsl = await wslContext(p, { fresh: true });
    const report = { time: new Date().toISOString(), backend: 'wsl', wsl, passed: wsl.available && wsl.dependenciesReady };
    save(path.join(reportsDir, `runtime-${Date.now()}.json`), report);
    output(report);
    if (!report.passed) throw new Error('RUNTIME_VERIFICATION_FAILED');
    return;
  }
  if (action === 'exec') {
    if (args[0] !== '--' || args.length < 2) throw new Error('Use exec -- command [args]');
    const res = await runWsl(p.runtime.distro, args.slice(1), {
      timeout: 3600000,
      user: p.runtime.user,
      stdio: 'inherit',
    });
    process.exitCode = res.ok ? 0 : 1;
    return;
  }
  throw new Error('UNKNOWN_COMMAND');
}

async function setupWsl(policy) {
  const { distro, user } = policy.runtime;
  const distros = await listWslDistros();
  const target = distros.find((entry) => entry.name === distro);
  if (!target) {
    throw new Error('WSL2 distribution ' + distro + ' is missing. Install it with "wsl --install -d ' + distro + '", then open it once to create your Linux account.');
  }
  if (target.version !== 2) throw new Error(distro + ' must run under WSL2.');
  if (!user) throw new Error('Open ' + distro + ' once and finish setting up its default Linux user.');

  console.log('Configuring ' + distro + ' for ' + user + '...');
  const script = toWslPath(path.join(ROOT, 'scripts/setup-wsl.sh'));
  const result = await runWsl(distro, ['bash', script, policy.workspace.defaultRoot], {
    user,
    stdio: 'inherit',
    timeout: 3600000,
  });
  if (!result.ok) throw new Error('WSL2 setup failed. See the message above.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
