import { JsonRpc } from './core/json-rpc.mjs';
import { AgentService } from './agent/agent-service.mjs';
import { createConsoleDispatcher } from './desktop-api.mjs';

const service = new AgentService();
const dispatchConsole = createConsoleDispatcher();

const rpc = new JsonRpc(process.stdin, process.stdout, {
  handle: (method, params) => {
    if (method === 'console.request') return dispatchConsole(params);
    return service.call(method, params);
  },
  maxFrame: 1600000,
});

service.on('event', (event) => rpc.notify('agent.event', event));

let shuttingDown = false;
rpc.on('closed', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 2200);
  const serviceClosed = service.close();
  process.stdin.destroy();
  void Promise.allSettled([serviceClosed]).then(() => {
    clearTimeout(deadline);
    process.stdout.end(() => process.exit(0));
  });
});
