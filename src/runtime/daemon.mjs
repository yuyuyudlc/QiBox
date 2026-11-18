import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import {randomUUID} from 'node:crypto';
import {JsonRpc} from '../core/json-rpc.mjs';
import {SessionManager} from './session.mjs';
import {ProjectWorkbench} from './project-workbench.mjs';
const directory=process.env.ISOLATION_RUNTIME_DIR || '/tmp/isolation-agent';fs.mkdirSync(directory,{recursive:true,mode:0o700});
const socketPath=path.join(directory,'runtime.sock');if(fs.existsSync(socketPath))fs.unlinkSync(socketPath);
const manager=new SessionManager({home:process.env.ISOLATION_HOME || homedir(),cwd:process.env.ISOLATION_WORKSPACE || '/workspace'});manager.bootId=randomUUID();const clients=new Set();
const workbench=new ProjectWorkbench(manager,{onEvent:event=>{for(const peer of clients)peer.notify('agent.event',event);}});
// Terminal bytes have their own offsets and scrollback, not the chat replay ring.
manager.on('event',event=>{for(const peer of clients)peer.notify('agent.event',event);});
const server=net.createServer(socket=>{
 const peer=new JsonRpc(socket,socket,{handle:async(method,params)=>{
  if(method.startsWith('files.')||method.startsWith('git.')||method.startsWith('terminal.'))return workbench.call(method,params);
  const result=await manager.call(method,params);if(method==='status'){Object.assign(result.capabilities,{files:true,git:true,mcpConfiguration:true,terminal:true});try{result.build=JSON.parse(fs.readFileSync('/opt/isolation/build-info.json','utf8'));}catch{result.build=null;}}return result;
 }});clients.add(peer);
 peer.once('closed',()=>{clients.delete(peer);socket.destroy();});
});
server.listen(socketPath,()=>fs.chmodSync(socketPath,0o600));
process.on('SIGTERM',()=>{workbench.close();manager.close();server.close();for(const peer of clients)peer.close();process.exit(0);});
