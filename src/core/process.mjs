import { spawn } from 'node:child_process';

// Deliberately no shell; all externally configured values remain argv data.
export function run(command, args = [], { timeout = 15000, cwd, stdio = 'pipe', env, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, stdio, env, windowsHide: true, shell: false });
    } catch (error) {
      return resolve({ ok: false, code: null, error: error.code || 'SPAWN_FAILED', stdout: '', stderr: '' });
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill());
      } else {
        child.kill('SIGKILL');
      }
    }, timeout);
    const append = (which, chunk) => {
      if (which === 'stdout') stdout = (stdout + chunk).slice(-1048576);
      else stderr = (stderr + chunk).slice(-1048576);
    };
    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));
    if (input !== undefined) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    }
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, error: error.code || 'SPAWN_FAILED', stdout, stderr });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, error: timedOut ? 'TIMEOUT' : null, stdout, stderr });
    });
  });
}

const exited = (child) => child.exitCode != null || child.signalCode != null;

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      child.removeListener('error', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once('exit', finish);
    child.once('error', finish);
    if (exited(child)) finish();
  });
}

export async function stopHostChild(
  child,
  { platform = process.platform, spawnProcess = spawn, graceMs = 350, killTimeoutMs = 1000, processGroup = false } = {},
) {
  if (!child) return;
  if (platform === 'win32' && !exited(child) && Number.isInteger(child.pid) && child.pid > 0) {
    // Keep stdin open until taskkill has captured the tree; closing the launcher
    // first can orphan its native child before /T sees it.
    try {
      const killer = spawnProcess('taskkill.exe', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      await waitForExit(killer, killTimeoutMs);
      if (!exited(killer)) {
        try {
          killer.kill('SIGKILL');
        } catch {}
      }
    } catch {}
  } else {
    try {
      child.stdin?.end();
    } catch {}
    try {
      if (processGroup && child.pid > 1) process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await waitForExit(child, graceMs);
  }
  try {
    child.stdin?.end();
  } catch {}
  if (processGroup && platform !== 'win32' && child.pid > 1) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
  if (!exited(child)) {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
  await waitForExit(child, 200);
}
