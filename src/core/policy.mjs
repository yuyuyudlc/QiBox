import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const POLICY_PATH = path.join(ROOT, 'config', 'isolation.json');

function check(ok, message) {
  if (!ok) throw new Error(`POLICY: ${message}`);
}

function keys(object, allowed, label) {
  check(object && typeof object === 'object' && !Array.isArray(object), `${label} must be an object`);
  for (const key of Object.keys(object)) check(allowed.includes(key), `Unknown ${label}.${key}`);
}

function integer(value, min, max, label) {
  check(Number.isInteger(value) && value >= min && value <= max, `Invalid ${label}`);
}

export function validatePolicy(p) {
  keys(p, ['schemaVersion', 'projectName', 'runtime', 'environment', 'network', 'workspace', 'chat', 'audit'], 'root');
  check(p.schemaVersion === 2, 'Unsupported schemaVersion');
  check(/^[a-z][a-z0-9-]{2,40}$/.test(p.projectName), 'Invalid projectName');

  keys(p.runtime, ['backend', 'distro', 'user', 'hostname', 'claudeVersion'], 'runtime');
  check(p.runtime.backend === 'wsl', 'Only WSL2 backend is supported');
  check(typeof p.runtime.distro === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(p.runtime.distro), 'Invalid WSL distro name');
  check(typeof p.runtime.user === 'string' && /^[a-z_][a-z0-9_-]{0,31}$/.test(p.runtime.user), 'Invalid Linux username');
  if (p.runtime.hostname !== undefined) {
    check(typeof p.runtime.hostname === 'string' && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(p.runtime.hostname), 'Invalid hostname');
  }
  if (p.runtime.claudeVersion !== undefined) {
    check(typeof p.runtime.claudeVersion === 'string' && (p.runtime.claudeVersion === 'latest' || /^\d+\.\d+\.\d+$/.test(p.runtime.claudeVersion)), 'Invalid claudeVersion');
  }

  keys(p.environment, ['timezone', 'locale', 'disableNonessentialTraffic', 'blockWindowsBrowser'], 'environment');
  try {
    new Intl.DateTimeFormat('en', { timeZone: p.environment.timezone }).format();
  } catch {
    throw new Error('POLICY: Invalid timezone');
  }
  check(typeof p.environment.timezone === 'string', 'timezone required');
  check(
    typeof p.environment.locale === 'string' &&
      /^(?:C|[a-z]{2,3}(?:_[A-Z]{2})?(?:@[a-zA-Z]+)?)\.(?:UTF-8|utf8)$/.test(p.environment.locale),
    'Unsupported locale',
  );
  check(typeof p.environment.disableNonessentialTraffic === 'boolean', 'disableNonessentialTraffic must be boolean');
  check(p.environment.blockWindowsBrowser === undefined || typeof p.environment.blockWindowsBrowser === 'boolean', 'blockWindowsBrowser must be boolean');

  keys(p.network, ['proxyUrl'], 'network');
  if (p.network.proxyUrl !== null && p.network.proxyUrl !== undefined && p.network.proxyUrl !== '') {
    check(typeof p.network.proxyUrl === 'string' && p.network.proxyUrl.length <= 512, 'Invalid proxyUrl');
    let u;
    try {
      u = new URL(p.network.proxyUrl);
    } catch {
      throw new Error('POLICY: Invalid proxyUrl');
    }
    check(['http:', 'https:', 'socks5:', 'socks5h:'].includes(u.protocol), 'Unsupported proxyUrl protocol');
  }

  keys(p.workspace, ['defaultRoot'], 'workspace');
  check(typeof p.workspace.defaultRoot === 'string' && p.workspace.defaultRoot.startsWith('/'), 'defaultRoot must be an absolute Linux path');

  keys(p.chat, ['allowedTools'], 'chat');
  validateAllowedTools(p.chat.allowedTools);

  if (p.audit !== undefined) {
    keys(p.audit, ['retentionDays', 'rawContent'], 'audit');
    integer(p.audit.retentionDays, 1, 30, 'retentionDays');
    check(p.audit.rawContent === false, 'Raw content logging is not allowed');
  }
  return p;
}

export function validateAllowedTools(tools) {
  check(
    Array.isArray(tools) &&
      tools.length <= 16 &&
      tools.every((t) => typeof t === 'string' && /^(Read|Glob|Grep|Edit|Write|Bash)(\([^\r\n\0]{1,256}\))?$/.test(t)),
    'Invalid chat allowedTools',
  );
}

export function loadPolicy(file = POLICY_PATH) {
  if (file === POLICY_PATH && !fs.existsSync(file)) {
    try {
      fs.copyFileSync(path.join(ROOT, 'config/isolation.example.json'), file, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return validatePolicy(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function validateWorkspace(p) {
  return p.workspace?.defaultRoot || '/workspace';
}
