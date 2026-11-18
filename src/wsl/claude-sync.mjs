import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ROOT } from '../core/policy.mjs';
import { runWsl } from './wsl.mjs';

const MAX_BYTES = 1048576;
export const portableKeys = [
  'model',
  'effortLevel',
  'language',
  'outputStyle',
  'alwaysThinkingEnabled',
  'theme',
  'verbose',
  'spinnerTipsEnabled',
  'showTurnDuration',
  'respectGitignore',
  'cleanupPeriodDays',
  'includeCoAuthoredBy',
  'attribution',
  'permissions',
];
export const portableEnv = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'MAX_THINKING_TOKENS',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
];

const digest = (value) => createHash('sha256').update(value).digest('hex');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readJson(file, optional = false) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error();
    const raw = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error();
    const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!isObject(value)) throw new Error();
    return { value, raw };
  } catch (e) {
    if (optional && e.code === 'ENOENT') return null;
    throw new Error('无法读取配置：文件缺失、过大或 JSON 格式无效。');
  }
}

export function sourcePath({ home = os.homedir(), env = process.env } = {}) {
  const cc = readJson(path.join(home, '.cc-switch', 'settings.json'), true)?.value;
  let directory = cc?.claudeConfigDir || env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  if (typeof directory !== 'string' || directory.includes('\0')) throw new Error('Claude 配置目录无效。');
  if (directory === '~') directory = home;
  if (/^~[\\/]/.test(directory)) directory = path.join(home, directory.slice(2));
  if (!path.isAbsolute(directory)) throw new Error('Claude 配置目录必须是绝对路径。');
  return path.join(directory, 'settings.json');
}

export function prepareSettings(settings) {
  if (!isObject(settings)) throw new Error('Claude 配置必须是 JSON 对象。');
  const output = {};
  const skipped = [];
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'env') continue;
    if (!portableKeys.includes(key)) {
      skipped.push(key);
      continue;
    }
    if (key === 'permissions') {
      if (!isObject(value)) throw new Error('permissions 配置格式无效。');
      const permissions = {};
      for (const [k, v] of Object.entries(value)) {
        if (['allow', 'ask', 'deny'].includes(k)) {
          if (!Array.isArray(v) || v.some((rule) => typeof rule !== 'string')) throw new Error('工具权限规则必须是字符串列表。');
          permissions[k] = v.filter((rule) => {
            if (/[a-z]:[\\/]|\\\\/i.test(rule)) {
              skipped.push('permissions.WindowsPathRule');
              return false;
            }
            return true;
          });
        } else if (k === 'defaultMode' && typeof v === 'string') {
          permissions[k] = v;
        } else {
          skipped.push('permissions.' + k);
        }
      }
      output.permissions = permissions;
    } else {
      output[key] = value;
    }
  }
  if (settings.env !== undefined && !isObject(settings.env)) throw new Error('env 配置格式无效。');
  output.env = {};
  for (const [key, value] of Object.entries(settings.env || {})) {
    if (!portableEnv.includes(key)) {
      skipped.push('env.' + key);
      continue;
    }
    if (typeof value !== 'string' || value.length > 65536) throw new Error('可同步环境变量必须是有效字符串。');
    output.env[key] = value;
  }
  const base = output.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  let endpoint;
  try {
    endpoint = new URL(base);
  } catch {
    throw new Error('API 地址无效，请在 CC Switch 中检查当前配置。');
  }
  const blockedReason = !['https:', 'http:'].includes(endpoint.protocol)
    ? 'API 地址协议必须是 HTTP 或 HTTPS。'
    : null;
  const preview = {
    endpointHost: blockedReason ? null : endpoint.hostname,
    hasCredential: !!(output.env.ANTHROPIC_API_KEY || output.env.ANTHROPIC_AUTH_TOKEN),
    settingKeys: Object.keys(output).filter((k) => k !== 'env'),
    envKeys: Object.keys(output.env),
    skipped: [...new Set(skipped)],
    blockedReason,
  };
  return { settings: output, preview };
}

export function readSource(options = {}) {
  const file = sourcePath(options);
  const { value, raw } = readJson(file);
  const { settings, preview } = prepareSettings(value);
  return {
    file,
    settings,
    preview: {
      ...preview,
      sourcePath: file,
      sourceHash: digest(file + '\0' + raw),
      modifiedAt: fs.statSync(file).mtime.toISOString(),
    },
  };
}

export function syncInfo(policy, options = {}) {
  const { preview } = readSource(options);
  const statusFile = options.statusFile || path.join(ROOT, '.runtime', 'claude-sync.json');
  let lastSync = null;
  try {
    const s = readJson(statusFile, true)?.value;
    if (s) lastSync = { time: s.time, changed: s.changed, backupCreated: s.backupCreated, configHash: s.configHash };
  } catch {}
  return {
    ...preview,
    networkAllowed: !!preview.endpointHost,
    targetPath: `${policy.runtime.user ? `/home/${policy.runtime.user}` : '~'}/.claude/settings.json`,
    lastSync,
  };
}

export const wslSyncProgram = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
(async()=>{
 let raw='';for await(const part of process.stdin){raw+=part;if(Buffer.byteLength(raw)>1048576)throw Error();}
 const payload=JSON.parse(raw);const home=process.env.HOME;
 if(!path.isAbsolute(home))throw Error();
 const dir=path.join(home,'.claude'),target=path.join(dir,'settings.json');
 function safe(file,type){try{const s=fs.lstatSync(file);if(s.isSymbolicLink()||(type==='dir'?!s.isDirectory():!s.isFile()))throw Error();return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 if(!safe(dir,'dir'))fs.mkdirSync(dir,{mode:0o700});
 const lock=path.join(dir,'.isolation-sync.lock');const fd=fs.openSync(lock,'wx',0o600);
 let temp;
 try{
  const exists=safe(target,'file');const before=exists?fs.readFileSync(target,'utf8'):null;
  if(before&&Buffer.byteLength(before)>1048576)throw Error();
  const old=before===null?{}:JSON.parse(before.replace(/^\uFEFF/,''));
  if(!old||typeof old!=='object'||Array.isArray(old)||old.env&& (typeof old.env!=='object'||Array.isArray(old.env)))throw Error();
  const next={...old};for(const key of payload.keys)delete next[key];
  const env={...(old.env||{})};for(const key of payload.envKeys)delete env[key];
  Object.assign(next,payload.settings);next.env={...env,...payload.settings.env};
  const content=JSON.stringify(next,null,2)+'\n';
  if(before!==null&&require('node:util').isDeepStrictEqual(old,next)){
   fs.chmodSync(target,0o600);process.stdout.write(JSON.stringify({synced:true,changed:false,backupCreated:false,configHash:hash(before)}));return;
  }
  temp=path.join(dir,'.sync-'+crypto.randomUUID()+'.tmp');fs.writeFileSync(temp,content,{flag:'wx',mode:0o600});
  let backupCreated=false;
  if(exists){
   const backups=path.join(dir,'isolation-sync-backups');if(!safe(backups,'dir'))fs.mkdirSync(backups,{mode:0o700});
   fs.chmodSync(backups,0o700);
   fs.writeFileSync(path.join(backups,'settings-'+Date.now()+'-'+crypto.randomUUID()+'.json'),before,{flag:'wx',mode:0o600});backupCreated=true;
  }
  fs.renameSync(temp,target);temp=null;
  try{const b=path.join(dir,'isolation-sync-backups');if(fs.existsSync(b)){const names=fs.readdirSync(b).filter(n=>/^settings-\d+-[a-f0-9-]+\.json$/.test(n)).sort().reverse();for(const n of names.slice(5)){const f=path.join(b,n);if(safe(f,'file'))fs.unlinkSync(f);}}}catch{}
  process.stdout.write(JSON.stringify({synced:true,changed:true,backupCreated,configHash:hash(content)}));
 }finally{if(temp)try{fs.unlinkSync(temp);}catch{}fs.closeSync(fd);fs.unlinkSync(lock);}
})().catch(()=>{process.stderr.write('CLAUDE_SYNC_WRITE_FAILED');process.exitCode=1;});
`;

export async function syncClaude(payload, policy, { getRuntime, sourceOptions = {}, statusFile = path.join(ROOT, '.runtime', 'claude-sync.json') } = {}) {
  if (!payload || Object.keys(payload).some((k) => k !== 'expectedSourceHash') || !/^[a-f0-9]{64}$/.test(payload.expectedSourceHash || '')) {
    throw new Error('请先读取 Windows 配置，再同步。');
  }
  const source = readSource(sourceOptions);
  if (source.preview.sourceHash !== payload.expectedSourceHash) throw new Error('Windows 配置已经变化，请重新读取后同步。');
  if (source.preview.blockedReason) throw new Error(source.preview.blockedReason);
  const runtime = await getRuntime(policy);
  if (!runtime.engineAvailable || !runtime.dependenciesReady) throw new Error('请先启动 WSL2 环境，再同步 Claude 配置。');
  const input = JSON.stringify({ settings: source.settings, keys: portableKeys, envKeys: portableEnv });
  const result = await runWsl(policy.runtime.distro, ['node', '-e', wslSyncProgram], {
    timeout: 20000,
    input,
    user: policy.runtime.user,
  });
  if (!result.ok) throw new Error('WSL 配置同步失败：请检查配置是否有效或有其他同步操作正在运行。');
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error('WSL 未返回有效的同步结果。');
  }
  const report = { time: new Date().toISOString(), changed: value.changed, backupCreated: value.backupCreated, configHash: value.configHash };
  let statusSaved = true;
  try {
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  } catch {
    statusSaved = false;
  }
  return { synced: true, ...report, statusSaved, networkAllowed: true, restartSession: true };
}
