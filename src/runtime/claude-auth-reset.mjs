import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export const authEnvKey=key=>/^ANTHROPIC_|^CLAUDE_CODE_(?:OAUTH_|USE_(?:BEDROCK|VERTEX|FOUNDRY)$|SUBAGENT_MODEL$)/.test(key);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function read(file){try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)throw Error('AUTH_STATE_INVALID');const raw=fs.readFileSync(file,'utf8'),value=JSON.parse(raw.replace(/^\uFEFF/,''));if(!object(value))throw Error();return {file,raw,value};}catch(e){if(e.code==='ENOENT')return null;throw Error('AUTH_STATE_INVALID');}}
export function assertNoProjectAuth(roots,home){for(const root of roots)for(const name of ['settings.json','settings.local.json']){const file=path.join(root,'.claude',name);if(file===path.join(home,'.claude/settings.json'))continue;const row=read(file);if(row&&(row.value.apiKeyHelper||Object.keys(row.value.env||{}).some(authEnvKey)))throw Error('PROJECT_AUTH_OVERRIDE');}}
export function resetClaudeAuth(home){
 const dir=path.join(home,'.claude');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(fs.lstatSync(dir).isSymbolicLink())throw Error('AUTH_STATE_INVALID');
 const lock=path.join(dir,'.isolation-sync.lock');let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{throw Error('AUTH_SYNC_BUSY');}
 const edits=[],written=[];
 const replace=(file,raw)=>{if(raw===null){fs.unlinkSync(file);return;}const temp=file+'.reset-'+randomUUID();try{fs.writeFileSync(temp,raw,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}};
 try{
  for(const file of [path.join(dir,'settings.json'),path.join(dir,'.credentials.json'),path.join(home,'.claude.json'),path.join(dir,'.claude.json')]){
   const row=read(file);if(!row)continue;const value=structuredClone(row.value);
   if(file===path.join(dir,'settings.json')){if(value.env!==undefined&&!object(value.env))throw Error('AUTH_STATE_INVALID');for(const key of Object.keys(value.env||{}))if(authEnvKey(key))delete value.env[key];delete value.apiKeyHelper;delete value.model;}
   else if(file===path.join(dir,'.credentials.json')){delete value.claudeAiOauth;delete value.primaryApiKey;}
   else {for(const key of ['oauthAccount','primaryApiKey','customApiKeyResponses','hasCompletedOnboarding','lastOnboardingVersion'])delete value[key];}
   if(JSON.stringify(value)!==JSON.stringify(row.value))edits.push({...row,next:file===path.join(dir,'.credentials.json')&&!Object.keys(value).length?null:JSON.stringify(value,null,2)+'\n'});
  }
  for(const row of edits){if(fs.readFileSync(row.file,'utf8')!==row.raw)throw Error('AUTH_STATE_CHANGED');replace(row.file,row.next);written.push(row);}
  return {reset:true,loggedIn:false,changed:edits.length>0,scope:'wsl-user',historyPreserved:true};
 }catch(e){let failed=false;for(const row of written.reverse())try{replace(row.file,row.raw);}catch{failed=true;}throw Error(failed?'AUTH_RESET_ROLLBACK_FAILED':/^(AUTH_)/.test(e.message)?e.message:'AUTH_RESET_FAILED');}
 finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
