import { EventEmitter } from "node:events";
export const publicError = (e) =>
  /^[A-Z][A-Z0-9_]+$/.test(e?.message || "")
    ? e.message
    : "AGENT_REQUEST_FAILED";
// Requests and notifications share the stream; a long request never locks control RPCs.
export class JsonRpc extends EventEmitter {
  constructor(
    input,
    output,
    { handle, timeout = 30000, maxFrame = 1600000 } = {},
  ) {
    super();
    Object.assign(this, { input, output, handle, timeout, maxFrame });
    this.next = 0;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
    input.setEncoding("utf8");
    input.on("data", (part) => this.receive(part));
    input.on("end", () => this.close());
    input.on("error", () => this.close());
    output.on("error", () => this.close());
  }
  receive(part) {
    if (this.closed) return;
    this.buffer += part;
    let end;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > this.maxFrame)
        return this.close("RPC_FRAME_TOO_LARGE");
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return this.close("RPC_PROTOCOL_ERROR");
      }
      if (frame.method) {
        if (frame.id == null)
          this.emit("notification", frame.method, frame.params);
        else
          Promise.resolve()
            .then(() => {
              if (!this.handle) throw Error("METHOD_NOT_ALLOWED");
              return this.handle(frame.method, frame.params || {});
            })
            .then(
              (result) => this.write({ id: frame.id, result }),
              (e) =>
                this.write({ id: frame.id, error: { code: publicError(e) } }),
            );
      } else {
        const p = this.pending.get(frame.id);
        if (!p) continue;
        this.pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.error)
          p.reject(Error(frame.error.code || "AGENT_REQUEST_FAILED"));
        else p.resolve(frame.result);
      }
    }
    if (Buffer.byteLength(this.buffer) > this.maxFrame)
      this.close("RPC_FRAME_TOO_LARGE");
  }
  write(frame) {
    if (this.closed) return false;
    const line = JSON.stringify(frame) + "\n";
    if (Buffer.byteLength(line) > this.maxFrame) {
      if (frame.id != null && ("result" in frame || "error" in frame)) {
        if (frame.error?.code === "RPC_RESPONSE_TOO_LARGE") {
          this.close("RPC_FRAME_TOO_LARGE");
          return false;
        }
        return this.write({
          id: frame.id,
          error: { code: "RPC_RESPONSE_TOO_LARGE" },
        });
      }
      if (frame.id != null) return false;
      this.close("RPC_FRAME_TOO_LARGE");
      return false;
    }
    if (this.output.writableLength > 4000000) {
      this.close("RPC_BACKPRESSURE");
      return false;
    }
    this.output.write(line);
    return true;
  }
  notify(method, params) {
    return this.write({ method, params });
  }
  call(method, params = {}, timeout = this.timeout) {
    if (this.closed) return Promise.reject(Error("RPC_DISCONNECTED"));
    const id = ++this.next;
    if (
      Buffer.byteLength(JSON.stringify({ id, method, params }) + "\n") >
      this.maxFrame
    )
      return Promise.reject(Error("RPC_FRAME_TOO_LARGE"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("RPC_TIMEOUT"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  close(reason = "RPC_DISCONNECTED") {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error(reason));
    }
    this.pending.clear();
    this.emit("closed", reason);
  }
}
