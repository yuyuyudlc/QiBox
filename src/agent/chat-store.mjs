import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {CHAT_STORE_PATH,mergeLegacyChatStores} from './chat-store-location.mjs';
// Windows owns the bilingual ledger; native Claude JSONL remains in WSL2.
export class ChatStore {
 constructor(file=CHAT_STORE_PATH){
  this.file=file;if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS turns(session_id TEXT NOT NULL,request_id TEXT NOT NULL,source TEXT NOT NULL,translate_input INTEGER NOT NULL,translate_output INTEGER NOT NULL,submitted TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(session_id,request_id));
   CREATE TABLE IF NOT EXISTS messages(session_id TEXT NOT NULL,message_id TEXT NOT NULL,request_id TEXT NOT NULL,role TEXT NOT NULL,source TEXT NOT NULL,translation TEXT,translation_status TEXT NOT NULL DEFAULT 'none',PRIMARY KEY(session_id,message_id),FOREIGN KEY(session_id,request_id) REFERENCES turns(session_id,request_id));
   CREATE INDEX IF NOT EXISTS messages_turn ON messages(session_id,request_id);
   CREATE TABLE IF NOT EXISTS owners(owner TEXT PRIMARY KEY,pid INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS history_translations(session_id TEXT NOT NULL,message_id TEXT NOT NULL,source TEXT NOT NULL,translation TEXT,status TEXT NOT NULL DEFAULT 'pending',lease_owner TEXT,lease_until INTEGER,PRIMARY KEY(session_id,message_id));
   CREATE TABLE IF NOT EXISTS deleted_sessions(session_id TEXT PRIMARY KEY,deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE IF NOT EXISTS answers(session_id TEXT NOT NULL,approval_id TEXT NOT NULL,attempt_id TEXT NOT NULL,question TEXT NOT NULL,turn_request_id TEXT,tool_use_id TEXT,source TEXT NOT NULL,submitted TEXT,translated INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(session_id,approval_id,attempt_id,question));`);
  const columns=this.db.prepare('PRAGMA table_info(messages)').all();if(!columns.some(c=>c.name==='lease_owner'))this.db.exec('ALTER TABLE messages ADD COLUMN lease_owner TEXT;ALTER TABLE messages ADD COLUMN lease_until INTEGER;');
  if (!this.db.prepare('PRAGMA table_info(turns)').all().some(column => column.name === 'target_language'))
    this.db.exec("ALTER TABLE turns ADD COLUMN target_language TEXT NOT NULL DEFAULT 'ja'");
  this.migration=file===CHAT_STORE_PATH?mergeLegacyChatStores(this.db,file):{sources:0,conflicts:0};
  for(const owner of this.db.prepare('SELECT * FROM owners').all()){let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(!alive){this.db.prepare('UPDATE messages SET lease_owner=NULL,lease_until=NULL WHERE lease_owner=?').run(owner.owner);this.db.prepare('UPDATE history_translations SET lease_owner=NULL,lease_until=NULL WHERE lease_owner=?').run(owner.owner);this.db.prepare('DELETE FROM owners WHERE owner=?').run(owner.owner);}}
  this.owner=randomUUID();this.db.prepare('INSERT INTO owners VALUES(?,?)').run(this.owner,process.pid);this.db.exec('PRAGMA user_version=5;');
 }
 turn(s,r){return this.db.prepare('SELECT * FROM turns WHERE session_id=? AND request_id=?').get(s,r);}
 begin({sessionId,requestId,text,translate,translateOutput,targetLanguage='ja'}){
  if(this.isDeleted(sessionId))throw Error('SESSION_DELETED');
  const old=this.turn(sessionId,requestId);if(old){if(old.source!==text||!!old.translate_input!==!!translate||!!old.translate_output!==!!translateOutput)throw Error('REQUEST_ID_CONFLICT');return false;}
  this.db.prepare('INSERT INTO turns(session_id,request_id,source,translate_input,translate_output,status,target_language) VALUES(?,?,?,?,?,?,?)').run(sessionId,requestId,text,+!!translate,+!!translateOutput,'translating',targetLanguage);return true;
 }
 submitted(s,r,text){this.db.prepare("UPDATE turns SET submitted=?,status='submitting' WHERE session_id=? AND request_id=?").run(text,s,r);this.message(s,r,r,'user',text);}
 state(s,r,status){this.db.prepare("UPDATE turns SET status=? WHERE session_id=? AND request_id=? AND NOT(status IN ('completed','interrupted') AND ? IN ('submitted','submitting'))").run(status,s,r,status);}
 message(s,r,id,role,source){
  const turn=this.turn(s,r);if(!turn)return;
  const old=this.db.prepare('SELECT request_id FROM messages WHERE session_id=? AND message_id=?').get(s,id);if(old&&old.request_id!==r)throw Error('MESSAGE_ID_CONFLICT');
  this.db.prepare(`INSERT INTO messages(session_id,message_id,request_id,role,source,translation_status) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,message_id) DO UPDATE SET translation=CASE WHEN messages.source=excluded.source THEN messages.translation ELSE NULL END,translation_status=CASE WHEN messages.source=excluded.source AND (excluded.role='assistant' OR messages.translation IS NOT NULL) THEN messages.translation_status ELSE excluded.translation_status END,source=excluded.source,role=excluded.role`).run(s,id,r,role,source,role==='assistant'&&turn.translate_output&&source?'pending':'none');
 }
 claim(s,id,source){return !!this.db.prepare('UPDATE messages SET lease_owner=?,lease_until=? WHERE session_id=? AND message_id=? AND source=? AND translation IS NULL AND (lease_owner IS NULL OR lease_until<?)').run(this.owner,Date.now()+240000,s,id,source,Date.now()).changes;}
 release(s,id){this.db.prepare('UPDATE messages SET lease_owner=NULL,lease_until=NULL WHERE session_id=? AND message_id=? AND lease_owner=?').run(s,id,this.owner);}
 translated(s,id,text,source){return !!this.db.prepare("UPDATE messages SET translation=?,translation_status='completed',lease_owner=NULL,lease_until=NULL WHERE session_id=? AND message_id=? AND (? IS NULL OR source=?)").run(text,s,id,source??null,source??null).changes;}
 failed(s,id){this.db.prepare("UPDATE messages SET translation_status='failed',lease_owner=NULL,lease_until=NULL WHERE session_id=? AND message_id=? AND translation IS NULL AND lease_owner=?").run(s,id,this.owner);}
 pending(s){return this.db.prepare("SELECT m.* FROM messages m JOIN turns t USING(session_id,request_id) WHERE m.session_id=? AND m.role='assistant' AND m.translation IS NULL AND m.translation_status<>'failed' AND t.translate_output=1 AND m.source<>''").all(s);}
 owned(s){return this.db.prepare('SELECT * FROM turns WHERE session_id=?').all(s);}
 answer(pending,attempt,question,source,translated){this.db.prepare("INSERT INTO answers(session_id,approval_id,attempt_id,question,turn_request_id,tool_use_id,source,translated,status) VALUES(?,?,?,?,?,?,?,?, 'translating')").run(pending.sessionId,pending.requestId,attempt,question,pending.turnRequestId||null,pending.toolUseId||null,source,+translated);}
 answerTranslated(pending,attempt,question,text){this.db.prepare("UPDATE answers SET submitted=?,status='translated' WHERE session_id=? AND approval_id=? AND attempt_id=? AND question=?").run(text,pending.sessionId,pending.requestId,attempt,question);}
 answerState(pending,attempt,status){this.db.prepare('UPDATE answers SET status=? WHERE session_id=? AND approval_id=? AND attempt_id=?').run(status,pending.sessionId,pending.requestId,attempt);}
 answers(s,requestIds){const query=this.db.prepare("SELECT approval_id AS approvalId,turn_request_id AS turnRequestId,tool_use_id AS toolUseId,question,source,submitted,translated,status FROM answers WHERE session_id=? AND turn_request_id=? AND status='submitted'");return requestIds.flatMap(r=>query.all(s,r));}
 historyMessage(s,id,source,{retry=false}={}){
  if(this.isDeleted(s))throw Error('SESSION_DELETED');
  this.db.prepare(`INSERT INTO history_translations(session_id,message_id,source) VALUES(?,?,?) ON CONFLICT(session_id,message_id) DO UPDATE SET translation=CASE WHEN source=excluded.source THEN translation ELSE NULL END,status=CASE WHEN source=excluded.source THEN status ELSE 'pending' END,lease_owner=CASE WHEN source=excluded.source THEN lease_owner ELSE NULL END,lease_until=CASE WHEN source=excluded.source THEN lease_until ELSE NULL END,source=excluded.source`).run(s,id,source);
  if(retry)this.db.prepare("UPDATE history_translations SET status='pending' WHERE session_id=? AND message_id=? AND translation IS NULL").run(s,id);
  return this.db.prepare('SELECT * FROM history_translations WHERE session_id=? AND message_id=?').get(s,id);
 }
 historySource(s,id){return this.db.prepare('SELECT source FROM history_translations WHERE session_id=? AND message_id=?').get(s,id)||this.db.prepare("SELECT source FROM messages WHERE session_id=? AND message_id=? AND role IN ('user','assistant')").get(s,id);}
 claimHistory(row){return !!this.db.prepare("UPDATE history_translations SET lease_owner=?,lease_until=? WHERE session_id=? AND message_id=? AND source=? AND translation IS NULL AND status='pending' AND (lease_owner IS NULL OR lease_until<?)").run(this.owner,Date.now()+240000,row.session_id,row.message_id,row.source,Date.now()).changes;}
 finishHistory(row,text){return !!this.db.prepare("UPDATE history_translations SET translation=?,status=?,lease_owner=NULL,lease_until=NULL WHERE session_id=? AND message_id=? AND source=? AND lease_owner=?").run(text,text===null?'failed':'completed',row.session_id,row.message_id,row.source,this.owner).changes;}
 bilingual(s,ids){
  const out={};const query=this.db.prepare('SELECT m.*,t.source AS original,t.translate_input,t.status AS turn_status FROM messages m JOIN turns t USING(session_id,request_id) WHERE m.session_id=? AND m.message_id=?');
  const historical=this.db.prepare('SELECT * FROM history_translations WHERE session_id=? AND message_id=?');
  for(const id of ids){const row=query.get(s,id),cached=historical.get(s,id),history=cached&&(!row||cached.source===row.source)?cached:null;if(row||history)out[id]={requestId:row?.request_id||null,messageId:id,originalChinese:row?.role==='user'&&row.translate_input?row.original:null,chinese:row?.translation||history?.translation||null,status:row?.translation?'completed':history?.status||row?.translation_status,turnStatus:row?.turn_status,sourceKind:row?'recorded':'history'};}return out;
 }
 isDeleted(s){return !!this.db.prepare('SELECT 1 FROM deleted_sessions WHERE session_id=?').get(s);}
 deleteSession(s){this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO deleted_sessions(session_id) VALUES(?)').run(s);for(const table of ['messages','answers','history_translations','turns'])this.db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(s);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 info(){return {path:this.file,location:'Project runtime',engine:'SQLite',schemaVersion:5,mapping:'sessionId / requestId / native messageId; approvalId / native toolUseId',legacySourcesMerged:this.migration.sources,migrationConflicts:this.migration.conflicts,migrationErrors:this.migration.errors||[]};}
 close(){if(!this.closed){this.closed=true;this.db.prepare('UPDATE messages SET lease_owner=NULL,lease_until=NULL WHERE lease_owner=?').run(this.owner);this.db.prepare('UPDATE history_translations SET lease_owner=NULL,lease_until=NULL WHERE lease_owner=?').run(this.owner);this.db.prepare('DELETE FROM owners WHERE owner=?').run(this.owner);this.db.close();}}
}
