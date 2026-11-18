import { wslContext } from '../wsl/doctor.mjs';
import { isWslDaemonAlive, loadWslPolicy, startWslDaemon } from '../wsl/wsl.mjs';

export class RuntimeConnection {
  constructor({ getPolicy = loadWslPolicy, createTransport } = {}) {
    if (typeof createTransport !== 'function') throw Error('RUNTIME_TRANSPORT_REQUIRED');
    this.getPolicy = getPolicy;
    this.createTransport = createTransport;
    this.current = null;
    this.transport = null;
  }

  async connect(policy) {
    const wsl = await wslContext(policy, { fresh: true });
    if (!wsl.available || !wsl.dependenciesReady) {
      throw Error('VERIFIED_RUNTIME_REQUIRED');
    }
    const alive = await isWslDaemonAlive(wsl.distro, wsl.user);
    if (!alive) {
      await startWslDaemon(policy, { keepChild: true });
    }
    this.current = { policy, distro: wsl.distro, user: wsl.user };
    this.transport = this.createTransport(this.current);
  }

  async context() {
    try {
      const policy = await this.getPolicy();
      if (
        !this.current ||
        this.current.distro !== policy.runtime.distro ||
        this.current.user !== policy.runtime.user ||
        this.transport?.closed
      ) {
        this.close();
        await this.connect(policy);
      }
      return { ...this.current, policy };
    } catch (e) {
      this.close();
      throw e;
    }
  }

  async execute(ctx, payload) {
    if (!this.transport || this.transport.closed) throw Error('WORKER_UNAVAILABLE');
    try {
      return await this.transport.call(payload);
    } catch (e) {
      if (this.transport?.closed) this.close();
      throw e;
    }
  }

  close() {
    this.transport?.close();
    this.transport = null;
    this.current = null;
  }
}
