import net from 'node:net';
import path from 'node:path';
const socket=net.createConnection(path.join(process.env.ISOLATION_RUNTIME_DIR || '/tmp/isolation-agent','runtime.sock'));
process.stdin.pipe(socket);socket.pipe(process.stdout);
socket.on('error',()=>{process.exitCode=1;process.stdin.destroy();});
socket.on('close',()=>{process.stdin.destroy();});
process.stdin.on('end',()=>socket.end());process.stdout.on('error',()=>socket.destroy());
