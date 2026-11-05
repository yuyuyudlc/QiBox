import { EventEmitter } from 'node:events';
import { RuntimeConnection } from './runtime-connection.mjs';
import { JsonRpc } from '../core/json-rpc.mjs';
import { readChatPreferences } from './chat-preferences.mjs';
import { spawnWsl } from '../wsl/wsl.mjs';

export class RuntimeClient extends EventEmitter {
  constructor() {
    super();
    this.validation = new RuntimeConnection({
      createTransport: ({ distro, user }) => {
        const child = spawnWsl(distro, ['node', '/opt/isolation/src/runtime/connect.mjs'], {
          user,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const rpc = new JsonRpc(child.stdout, child.stdin);
        child.on('error', () => rpc.close());
        child.on('exit', () => rpc.close());
        rpc.on('notification', (method, p) => {
          if (method === 'agent.event') this.emit('event', p);
        });
        rpc.on('closed', () => {
          child.stdin.end();
          this.emit('disconnected');
        });
        return {
          rpc,
          get closed() {
            return rpc.closed;
          },
          close() {
            rpc.close();
            child.stdin.end();
          },
          call: (p) => rpc.call(p.method, p.params),
        };
      },
    });
  }

  async call(method, params = {}) {
    if (method === 'session.create') {
      params = { ...params, allowedTools: readChatPreferences().allowedTools };
    }
    const checked = (this.checking || Promise.resolve()).catch(() => {}).then(() => this.validation.context());
    this.checking = checked.then(
      () => {},
      () => {},
    );
    const context = await checked;
    return this.validation.execute(context, { method, params });
  }

  close() {
    this.validation.close();
  }
}
