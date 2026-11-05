import fs from 'node:fs';
// Capture PID start times before interrupt: a reused PID must never be signalled.
function identity(pid,root){try{const text=fs.readFileSync(`${root}/${pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');return {pid:Number(pid),parent:Number(fields[1]),started:fields[19]};}catch{return null;}}
export function descendants(pid,{root='/proc'}={}){
 if(!Number.isInteger(pid)||pid<=1)return [];
 const rows=fs.readdirSync(root).filter(n=>/^\d+$/.test(n)).map(n=>identity(n,root)).filter(Boolean),owned=new Set([pid]),result=[];
 let changed=true;while(changed){changed=false;for(const row of rows)if(!owned.has(row.pid)&&owned.has(row.parent)){owned.add(row.pid);result.push(row);changed=true;}}
 return result;
}
export async function stopDescendants(rows,{root='/proc',kill=process.kill,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 function signal(row,value){const current=identity(row.pid,root);if(current&&current.started===row.started)try{kill(row.pid,value);}catch{}}
 for(const row of [...rows].reverse())signal(row,'SIGTERM');
 if(rows.length){await pause(350);for(const row of [...rows].reverse())signal(row,'SIGKILL');}
}
