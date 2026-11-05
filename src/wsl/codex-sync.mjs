import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { runWsl } from './wsl.mjs';

const hash = (s) => createHash('sha256').update(s).digest('hex');

export function readCodexSource({ home = os.homedir(), env = process.env, user = 'agent' } = {}) {
  const base = env.CODEX_HOME || path.join(home, '.codex');
  if (!path.isAbsolute(base)) throw Error('CODEX_HOME 必须是绝对路径。');
  const file = path.join(base, 'auth.json');
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1048576) throw Error();
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const auth = JSON.parse(raw);
    if (!auth || typeof auth !== 'object' || !auth.tokens || typeof auth.tokens.access_token !== 'string' || !auth.tokens.access_token.trim()) {
      throw Error();
    }
    return {
      raw,
      preview: {
        sourcePath: file,
        modifiedAt: stat.mtime.toISOString(),
        sourceHash: hash(file + '\0' + raw),
        targetPath: `/home/${user}/.codex/auth.json`,
      },
    };
  } catch {
    throw Error('无法读取有效的 Codex OAuth 登录文件；请确认 Codex 使用文件存储并已登录 ChatGPT。');
  }
}

export const writeAuthProgram = String.raw`
const fs=require('fs'),path=require('path'),crypto=require('crypto');
(async()=>{let raw='';for await(const c of process.stdin){raw+=c;if(Buffer.byteLength(raw)>1048576)throw Error()}
const dir=path.join(process.env.HOME,'.codex'),target=path.join(dir,'auth.json');
function safe(p,dir){try{const s=fs.lstatSync(p);if(s.isSymbolicLink()||(dir?!s.isDirectory():!s.isFile()))throw Error();return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
if(!safe(dir,true))fs.mkdirSync(dir,{mode:0o700});fs.chmodSync(dir,0o700);
const lock=path.join(dir,'.isolation-auth-sync.lock'),fd=fs.openSync(lock,'wx',0o600);let tmp;
try{const exists=safe(target,false),before=exists?fs.readFileSync(target,'utf8'):null;
if(before!==null&&Buffer.byteLength(before)>1048576)throw Error();
if(before===raw){fs.chmodSync(target,0o600);process.stdout.write(JSON.stringify({changed:false,backupCreated:false}));return}
tmp=path.join(dir,'.auth-'+crypto.randomUUID()+'.tmp');fs.writeFileSync(tmp,raw,{flag:'wx',mode:0o600});
if(exists){const b=path.join(dir,'isolation-auth-backups');if(!safe(b,true))fs.mkdirSync(b,{mode:0o700});fs.chmodSync(b,0o700);fs.writeFileSync(path.join(b,'auth-'+Date.now()+'-'+crypto.randomUUID()+'.json'),before,{flag:'wx',mode:0o600})}
fs.renameSync(tmp,target);tmp=null;process.stdout.write(JSON.stringify({changed:true,backupCreated:exists}));
}finally{if(tmp)try{fs.unlinkSync(tmp)}catch{}fs.closeSync(fd);fs.unlinkSync(lock)}
})().catch(()=>{process.stderr.write('CODEX_SYNC_FAILED');process.exitCode=1});`;

export async function syncCodex(expectedSourceHash, policy, deps) {
  if (!/^[a-f0-9]{64}$/.test(expectedSourceHash || '')) throw Error('请先读取 Codex 登录状态。');
  const source = readCodexSource({ ...(deps.sourceOptions || {}), user: policy.runtime.user });
  if (source.preview.sourceHash !== expectedSourceHash) throw Error('Windows 登录状态已变化，请重新读取。');
  const runtime = await deps.getRuntime(policy);
  if (!runtime.engineAvailable || !runtime.dependenciesReady) throw Error('请先启动 WSL2 工作环境。');
  const result = await runWsl(policy.runtime.distro, ['node', '-e', writeAuthProgram], {
    input: source.raw,
    timeout: 20000,
    user: policy.runtime.user,
  });
  if (!result.ok) throw Error('Codex 登录态同步失败。');
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw Error('WSL 未返回有效同步结果。');
  }
  if (typeof value.changed !== 'boolean' || typeof value.backupCreated !== 'boolean') throw Error('WSL 同步结果校验失败。');
  return value;
}
