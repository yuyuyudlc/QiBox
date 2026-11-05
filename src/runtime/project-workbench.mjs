import {WorkspaceService} from './workspace-service.mjs';
import {TerminalService} from './terminal-service.mjs';
export class ProjectWorkbench{
 constructor(manager,{onEvent=()=>{},spawnPty}={}){this.manager=manager;this.onEvent=onEvent;this.spawnPty=spawnPty;this.workspaces=new Map();this.terminals=new Map();}
 scope(p){const session=p.sessionId?this.manager.get(p.sessionId):null;if(session&&p.projectId&&session.projectId!==p.projectId)throw Error('SESSION_PROJECT_MISMATCH');return this.manager.projects.get(session?.projectId||p.projectId||'legacy');}
 services(project){if(!this.workspaces.has(project.id)){this.workspaces.set(project.id,new WorkspaceService(project.root));const terminal=new TerminalService({root:project.root,spawnPty:this.spawnPty});terminal.on('event',e=>this.onEvent({...e,projectId:project.id}));this.terminals.set(project.id,terminal);}return {workspace:this.workspaces.get(project.id),terminal:this.terminals.get(project.id)};}
 async call(method,p={}){
  if(method==='terminal.list'&&!p.projectId&&!p.sessionId)return [...this.terminals.entries()].flatMap(([projectId,t])=>[...t.terminals.values()].map(row=>({...t.info(row),projectId})));
  if(method.startsWith('terminal.')&&p.id){const found=[...this.terminals.entries()].find(([,t])=>t.terminals.has(p.id));if(!found)throw Error('TERMINAL_NOT_FOUND');if((p.projectId||p.sessionId)&&found[0]!==this.scope(p).id)throw Error('TERMINAL_PROJECT_MISMATCH');return {...await found[1].call(method,p),projectId:found[0]};}
  const project=this.scope(p),{workspace,terminal}=this.services(project);if(method==='terminal.list')return (await terminal.call(method,p)).map(t=>({...t,projectId:project.id}));return method.startsWith('terminal.')?{...await terminal.call(method,p),projectId:project.id}:workspace.call(method,p);
 }
 close(){for(const t of this.terminals.values())t.close();}
}
