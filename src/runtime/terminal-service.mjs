import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WorkspaceService} from './workspace-service.mjs';
import {descendants,stopDescendants} from '../core/process-tree.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const isHighSurrogate=code=>code>=0xD800&&code<=0xDBFF;
const isLowSurrogate=code=>code>=0xDC00&&code<=0xDFFF;

export class TerminalService extends EventEmitter {
 constructor({root='/workspace',spawnPty,maxBuffer=250000}={}){
  super();
  this.workspace=new WorkspaceService(root);
  this.spawnPty=spawnPty;
  this.maxBuffer=maxBuffer;
  this.terminals=new Map();
 }
 info(t){return {id:t.id,pid:t.pty.pid,path:t.path,cols:t.cols,rows:t.rows,exited:t.exited,exitCode:t.exitCode,offset:t.offset,start:t.start};}
 appendChunk(t,data){
  if(!data)return null;
  const from=t.offset;
  t.offset+=data.length;
  t.chunks.push({from,data});
  while(t.offset-t.start>this.maxBuffer&&t.chunks.length>1){
   t.chunks.shift();
   t.start=t.chunks[0].from;
  }
  if(t.chunks.length>0){
   const first=t.chunks[0];
   if(t.offset-t.start>this.maxBuffer&&first.data.length>this.maxBuffer){
    let cut=first.data.length-this.maxBuffer;
    if(cut<first.data.length&&isLowSurrogate(first.data.charCodeAt(cut)))cut++;
    first.from+=cut;
    first.data=first.data.slice(cut);
    t.start=first.from;
   }else if(first.from>0&&first.data.length>0&&isLowSurrogate(first.data.charCodeAt(0))){
    first.from+=1;
    first.data=first.data.slice(1);
    t.start=first.from;
    if(!first.data.length&&t.chunks.length>1){
     t.chunks.shift();
     t.start=t.chunks[0].from;
    }
   }
  }
  return {from,offset:t.offset,data};
 }
 readSlice(t,requestedAfter=0){
  let after=Math.max(t.start,Math.min(requestedAfter,t.offset));
  if(after>t.start&&after<t.offset){
   const idx=t.chunks.findIndex(c=>c.from<=after&&after<c.from+c.data.length);
   if(idx>=0){
    const c=t.chunks[idx],rel=after-c.from;
    if(rel>0&&isHighSurrogate(c.data.charCodeAt(rel-1))&&isLowSurrogate(c.data.charCodeAt(rel))){
     after-=1;
    }else if(rel===0&&idx>0){
     const prev=t.chunks[idx-1];
     if(prev.data.length>0&&isHighSurrogate(prev.data.charCodeAt(prev.data.length-1))&&isLowSurrogate(c.data.charCodeAt(0))){
      after-=1;
     }
    }
   }
  }
  const data=t.chunks.filter(c=>c.from+c.data.length>after).map(c=>c.data.slice(Math.max(0,after-c.from))).join('');
  return {...this.info(t),gap:requestedAfter<t.start,from:after,data};
 }
 async call(method,p={}){
  if(method==='terminal.list')return [...this.terminals.values()].map(t=>this.info(t));
  if(method==='terminal.open'){
   const cwd=await this.workspace.resolve(p.path||'.'),cols=p.cols||100,rows=p.rows||30;this.size(cols,rows);
   const spawnPty=this.spawnPty||(await import('node-pty')).spawn;
   const pty=spawnPty('/bin/bash',['--noprofile','--norc'],{name:'xterm-256color',cols,rows,cwd,env:{...process.env,TERM:'xterm-256color',COLORTERM:'truecolor',PS1:String.raw`\u@wsl:\w\$ `,LANG:process.env.LANG||'C.UTF-8'}});
   const t={id:randomUUID(),pty,path:p.path||'.',cols,rows,offset:0,start:0,chunks:[],exited:false};this.terminals.set(t.id,t);
   pty.onData(data=>{const appended=this.appendChunk(t,data);if(appended)this.emit('event',{kind:'terminal.data',terminalId:t.id,...appended});});
   pty.onExit(({exitCode})=>{t.exited=true;t.exitCode=exitCode;this.emit('event',{kind:'terminal.exit',terminalId:t.id,exitCode});});return this.info(t);
  }
  const t=this.terminals.get(p.id);check(t,'TERMINAL_NOT_FOUND');
  if(method==='terminal.read'){check(Number.isSafeInteger(p.after??0)&&(p.after??0)>=0,'INVALID_CURSOR');return this.readSlice(t,p.after||0);}
  if(method==='terminal.input'){check(!t.exited,'TERMINAL_EXITED');check(typeof p.data==='string'&&p.data.length<=32768,'INVALID_TERMINAL_INPUT');t.pty.write(p.data);return {written:true};}
  if(method==='terminal.resize'){this.size(p.cols,p.rows);if(!t.exited)t.pty.resize(p.cols,p.rows);t.cols=p.cols;t.rows=p.rows;return {resized:true};}
  if(method==='terminal.close'){if(!t.exited){const owned=descendants(t.pty.pid);t.pty.kill();await stopDescendants(owned);}this.terminals.delete(t.id);return {closed:true};}
  throw Error('METHOD_NOT_ALLOWED');
 }
 size(cols,rows){check(Number.isInteger(cols)&&cols>=2&&cols<=1000&&Number.isInteger(rows)&&rows>=1&&rows<=1000,'INVALID_TERMINAL_SIZE');}
 close(){for(const t of this.terminals.values())if(!t.exited)t.pty.kill();this.terminals.clear();}
}
