import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
export class NativeLedger {
 constructor(directory,sessions){
  this.db=new DatabaseSync(path.join(directory,'native-links.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS requests(session_id TEXT,request_id TEXT,status TEXT NOT NULL,PRIMARY KEY(session_id,request_id));
   CREATE TABLE IF NOT EXISTS links(session_id TEXT,message_id TEXT,request_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(session_id,message_id),FOREIGN KEY(session_id,request_id) REFERENCES requests(session_id,request_id));`);
  for(const s of sessions)for(const r of s.requests||[]){this.db.prepare('INSERT OR IGNORE INTO requests VALUES(?,?,?)').run(s.id,r.id,r.status);for(const m of r.messages||[])this.link(s.id,r.id,m.id,m.role);}
  this.db.exec("UPDATE requests SET status='interrupted' WHERE status='running'");
 }
 request(s,r){return this.db.prepare('SELECT status FROM requests WHERE session_id=? AND request_id=?').get(s,r);}
 begin(s,r){this.db.prepare("INSERT INTO requests VALUES(?,?,'running')").run(s,r);this.link(s,r,r,'user');}
 state(s,r,status){this.db.prepare('UPDATE requests SET status=? WHERE session_id=? AND request_id=?').run(status,s,r);}
 link(s,r,id,role){const old=this.db.prepare('SELECT request_id FROM links WHERE session_id=? AND message_id=?').get(s,id);if(old&&old.request_id!==r)throw Error('NATIVE_MESSAGE_ID_CONFLICT');this.db.prepare('INSERT INTO links VALUES(?,?,?,?) ON CONFLICT(session_id,message_id) DO UPDATE SET role=excluded.role').run(s,id,r,role);}
 links(s,ids){const q=this.db.prepare('SELECT l.message_id AS id,l.request_id AS requestId,l.role,r.status FROM links l JOIN requests r USING(session_id,request_id) WHERE l.session_id=? AND l.message_id=?');return ids.map(id=>q.get(s,id)).filter(Boolean);}
 removeSession(s){this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM links WHERE session_id=?').run(s);this.db.prepare('DELETE FROM requests WHERE session_id=?').run(s);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 close(){if(!this.closed){this.closed=true;this.db.close();}}
}
