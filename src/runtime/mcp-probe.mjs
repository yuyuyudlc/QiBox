// Optional local diagnostic MCP. Not enabled automatically.
import readline from 'node:readline';
for await(const line of readline.createInterface({input:process.stdin})){
 try{const q=JSON.parse(line);if(q.id==null)continue;let result;
  if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'wsl-diagnostic',version:'1.0.0'}};
  else if(q.method==='tools/list')result={tools:[{name:'wsl_identity',description:'Return WSL2 working directory and uid',inputSchema:{type:'object',properties:{}}}]};
  else if(q.method==='tools/call'&&q.params.name==='wsl_identity')result={content:[{type:'text',text:JSON.stringify({cwd:process.cwd(),uid:process.getuid(),platform:process.platform})}]};
  else if(q.method==='ping')result={};
  else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'Unknown method'}})+'\n');continue;}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
 }catch{}
}
