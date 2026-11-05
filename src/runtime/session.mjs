import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createHistoryStore, localCommandOutput } from "./history-worker.cjs";
import { descendants, stopDescendants } from "../core/process-tree.mjs";
import { McpConfig } from "./mcp-config.mjs";
import { NativeLedger } from "./native-ledger.mjs";
import { ProjectStore } from "./project-store.mjs";
import {
  authEnvKey,
  assertNoProjectAuth,
  resetClaudeAuth,
} from "./claude-auth-reset.mjs";
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "dontAsk",
  "auto",
];
const check = (ok, code) => {
  if (!ok) throw Error(code);
};
function readSessions(file) {
  try {
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    check(
      Array.isArray(rows) &&
        rows.every(
          (s) =>
            s &&
            UUID.test(s.id) &&
            [
              "idle",
              "running",
              "waiting_permission",
              "starting",
              "failed",
              "interrupted",
              "completed",
            ].includes(s.status) &&
            (s.model === undefined || typeof s.model === "string") &&
            (s.permissionMode === undefined ||
              MODES.includes(s.permissionMode)) &&
            (s.projectId === undefined || typeof s.projectId === "string") &&
            (s.requests === undefined ||
              (Array.isArray(s.requests) &&
                s.requests.every(
                  (r) =>
                    r &&
                    UUID.test(r.id) &&
                    ["running", "failed", "interrupted", "completed"].includes(
                      r.status,
                    ),
                ))),
        ),
      "SESSION_STATE_INVALID",
    );
    check(
      new Set(rows.map((s) => s.id)).size === rows.length,
      "SESSION_STATE_INVALID",
    );
    return rows;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw Error("SESSION_STATE_INVALID");
  }
}
class InputQueue {
  constructor() {
    this.values = [];
    this.waiters = [];
  }
  push(value) {
    if (this.ended) throw Error("SESSION_CLOSED");
    if (this.waiters.length) this.waiters.shift()({ value, done: false });
    else this.values.push(value);
  }
  end() {
    this.ended = true;
    for (const resolve of this.waiters) resolve({ done: true });
    this.waiters = [];
  }
  [Symbol.asyncIterator]() {
    return {
      next: () =>
        this.values.length
          ? Promise.resolve({ value: this.values.shift(), done: false })
          : this.ended
            ? Promise.resolve({ done: true })
            : new Promise((resolve) => this.waiters.push(resolve)),
    };
  }
}
export class SessionManager extends EventEmitter {
  constructor({
    home = "/home/agent",
    cwd = "/workspace",
    createQuery,
    deleteHistory,
    settingsCheckIntervalMs = 500,
    now = () => Date.now(),
  } = {}) {
    super();
    Object.assign(this, {
      home,
      cwd,
      createQuery,
      settingsCheckIntervalMs,
      _now: now,
    });
    this._settingsCache = null;
    this._settingsDirty = true;
    this._settingsCheckedAt = 0;
    this._retainedSecrets = new Set();
    this._settingsWatcher = null;
    this.deleteHistory =
      deleteHistory ||
      (async (id) =>
        (await import("@anthropic-ai/claude-agent-sdk")).deleteSession(id));
    this.directory = path.join(home, ".isolation");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.deletedFile = path.join(this.directory, "deleted-sessions.json");
    this.deleting = new Set();
    try {
      const ids = JSON.parse(fs.readFileSync(this.deletedFile, "utf8"));
      check(
        Array.isArray(ids) && ids.every((id) => UUID.test(id)),
        "DELETION_LEDGER_INVALID",
      );
      this.deleted = new Set(ids);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.deleted = new Set();
    }
    this.file = path.join(this.directory, "sessions.json");
    this.live = new Map();
    this.initializing = new Map();
    this.sending = new Set();
    this.approvals = new Map();
    this.events = [];
    this.eventBytes = 0;
    this.seq = 0;
    this.models = [];
    this.commands = [];
    this.tools = [];
    this.sessions = new Map(
      readSessions(this.file).map((s) => [
        s.id,
        {
          ...s,
          status: ["running", "waiting_permission", "starting"].includes(
            s.status,
          )
            ? "interrupted"
            : s.status,
          requests: (s.requests || []).map((r) => ({
            ...r,
            status: r.status === "running" ? "interrupted" : r.status,
          })),
        },
      ]),
    );
    this.projects = new ProjectStore({ home, root: cwd });
    for (const s of this.sessions.values()) {
      s.projectId ||= "legacy";
      const project = this.projects.projects.get(s.projectId);
      check(project, "PROJECT_STATE_INVALID");
      s.cwd = project.root;
    }
    for (const id of this.deleted) this.sessions.delete(id);
    this.ledger = new NativeLedger(this.directory, this.sessions.values());
    this.mcp = new McpConfig(home);
    this.save();
    this.idleTimer = setInterval(() => this.releaseIdle(), 60000);
    this.idleTimer.unref();
  }
  save() {
    const temp = this.file + ".tmp";
    if (fs.existsSync(this.file)) {
      readSessions(this.file);
      fs.copyFileSync(this.file, this.file + ".bak");
    }
    fs.writeFileSync(temp, JSON.stringify([...this.sessions.values()]) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(temp, this.file);
  }
  invalidateSettingsCache({ clearRetainedSecrets = false } = {}) {
    this._settingsDirty = true;
    this._settingsCheckedAt = 0;
    if (clearRetainedSecrets) this._retainedSecrets.clear();
  }
  _ensureSettingsWatcher() {
    if (this._settingsWatcher || this.closed) return;
    const dir = path.join(this.home, ".claude");
    try {
      if (!fs.existsSync(dir)) return;
      this._settingsWatcher = fs.watch(dir, () => {
        this._settingsDirty = true;
      });
      this._settingsWatcher.on("error", () => {
        try {
          this._settingsWatcher?.close();
        } catch {}
        this._settingsWatcher = null;
        this._settingsDirty = true;
      });
      this._settingsWatcher.unref?.();
    } catch {}
  }
  _loadSettingsState(force = false, { verify = false } = {}) {
    this._ensureSettingsWatcher();
    const now = this._now();
    if (
      !force &&
      !verify &&
      !this._settingsDirty &&
      this._settingsCache !== null &&
      now - this._settingsCheckedAt < this.settingsCheckIntervalMs
    ) {
      return this._settingsCache;
    }
    const dirty = this._settingsDirty;
    this._settingsCheckedAt = now;
    this._settingsDirty = false;
    const file = path.join(this.home, ".claude/settings.json");
    let stat;
    try {
      stat = fs.statSync(file, { bigint: true });
    } catch (e) {
      if (e.code === "ENOENT") {
        this._settingsCache = {
          stamp: "missing",
          settings: {},
          secrets: [...this._retainedSecrets],
        };
        return this._settingsCache;
      }
      return { ...(this._settingsCache || { settings: {}, secrets: [...this._retainedSecrets] }), unavailable: true };
    }
    const stamp = `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
    // NTFS may preserve all timestamps across rapid same-size writes. The
    // production Linux worker uses nanosecond metadata; Windows also verifies
    // bytes, retaining the parsed cache when those bytes have not changed.
    if (!force && !dirty && this._settingsCache && this._settingsCache.stamp === stamp && !(verify && process.platform === "win32")) {
      return this._settingsCache;
    }
    try {
      check(stat.size <= 1048576n, "AUTH_STATE_INVALID");
      const raw = fs.readFileSync(file, "utf8");
      if (this._settingsCache?.raw === raw) {
        this._settingsCache.stamp = stamp;
        return this._settingsCache;
      }
      const parsed = JSON.parse(raw);
      check(parsed && typeof parsed === "object" && !Array.isArray(parsed), "AUTH_STATE_INVALID");
      check(parsed.env === undefined || (parsed.env && typeof parsed.env === "object" && !Array.isArray(parsed.env)), "AUTH_STATE_INVALID");
      const settings = parsed;
      const currentSecrets = Object.entries(settings.env || {})
        .filter(
          ([k, v]) =>
            /KEY|TOKEN/.test(k) && typeof v === "string" && v.length > 8,
        )
        .map(([, v]) => v);
      for (const secret of currentSecrets) {
        this._retainedSecrets.delete(secret);
        this._retainedSecrets.add(secret);
      }
      this._settingsCache = {
        stamp,
        raw,
        settings,
        secrets: [...new Set([...currentSecrets, ...this._retainedSecrets])],
      };
      return this._settingsCache;
    } catch {
      return { ...(this._settingsCache || { settings: {}, secrets: [...this._retainedSecrets] }), unavailable: true };
    }
  }
  settings({ force = false } = {}) {
    const state = this._loadSettingsState(force);
    check(!state.unavailable, "AUTH_STATE_INVALID");
    return state.settings;
  }
  scrub(value) {
    // Watch callbacks are asynchronous. Verify metadata at the disclosure boundary,
    // but keep file contents/JSON parsing cached while the version is unchanged.
    const { secrets, unavailable } = this._loadSettingsState(false, { verify: true });
    check(!unavailable, "AUTH_STATE_INVALID");
    let text = JSON.stringify(value);
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    return JSON.parse(text);
  }
  event(sessionId, kind, data = {}) {
    if (this.deleted.has(sessionId) && kind !== "session.deleted") return;
    const envelope = { sessionId, seq: ++this.seq, time: new Date().toISOString() };
    let event;
    try {
      event = this.scrub({ ...envelope, kind, ...data });
    } catch (error) {
      if (error.message !== "AUTH_STATE_INVALID") throw error;
      // No original payload is emitted or retained while new credentials are unknown.
      event = { ...envelope, kind: "runtime.error", code: "AUTH_STATE_INVALID" };
    }
    const size = Buffer.byteLength(JSON.stringify(event));
    this.events.push({ event, size });
    this.eventBytes += size;
    while (this.events.length > 1500 || this.eventBytes > 8000000)
      this.eventBytes -= this.events.shift().size;
    this.emit("event", event);
    return event;
  }
  state(s, status) {
    s.status = status;
    s.updatedAt = new Date().toISOString();
    this.save();
    this.event(s.id, "session.state", { session: { ...s } });
  }
  get(id) {
    check(!this.deleted.has(id), "SESSION_DELETED");
    check(!this.deleting.has(id), "SESSION_BUSY");
    check(UUID.test(id || "") && this.sessions.has(id), "SESSION_NOT_FOUND");
    return this.sessions.get(id);
  }
  async open(params = {}) {
    const id = params.sessionId || randomUUID();
    check(UUID.test(id), "INVALID_SESSION_ID");
    check(!this.deleted.has(id), "SESSION_DELETED");
    check(!this.deleting.has(id), "SESSION_BUSY");
    if (this.sessions.has(id)) {
      const s = this.get(id);
      if (params.projectId)
        check(params.projectId === s.projectId, "SESSION_PROJECT_MISMATCH");
      return s;
    }
    let hasHistory = false,
      project = this.projects.get(params.projectId || "legacy");
    if (params.sessionId) {
      const old = createHistoryStore({ home: this.home }).call({
        operation: "read",
        sessionId: id,
      });
      project = this.projects.forHistory(old.cwd);
      if (params.projectId && params.projectId !== "legacy")
        check(params.projectId === project.id, "SESSION_PROJECT_MISMATCH");
      hasHistory = true;
    }
    if (params.allowedTools != null)
      check(
        Array.isArray(params.allowedTools) &&
          params.allowedTools.length <= 100 &&
          params.allowedTools.every(
            (v) => typeof v === "string" && v.length <= 500,
          ),
        "INVALID_TOOL_RULES",
      );
    const s = {
      id,
      projectId: project.id,
      cwd: project.root,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Claude " + id.slice(0, 8),
      model: "default",
      actualModel: null,
      permissionMode: "default",
      status: "idle",
      hasHistory,
      turns: 0,
      requests: [],
      allowedTools: params.allowedTools || [
        "Read",
        "Glob",
        "Grep",
        "Bash(node *)",
        "Bash(pwd)",
        "Bash(ls *)",
      ],
    };
    this.sessions.set(id, s);
    this.save();
    this.event(id, "session.created", { session: s });
    return s;
  }
  async ensure(s) {
    check(!this.resettingAuth, "AUTH_RESET_IN_PROGRESS");
    check(!this.deleted.has(s.id), "SESSION_DELETED");
    check(!this.deleting.has(s.id), "SESSION_BUSY");
    if (this.initializing.has(s.id)) return this.initializing.get(s.id);
    const pending = this.initialize(s).finally(() =>
      this.initializing.delete(s.id),
    );
    this.initializing.set(s.id, pending);
    return pending;
  }
  async initialize(s) {
    if (!s.hasHistory) {
      try {
        createHistoryStore({ home: this.home }).call({
          operation: "read",
          sessionId: s.id,
        });
        s.hasHistory = true;
        this.save();
      } catch (e) {
        if (e.message !== "HISTORY_NOT_FOUND") throw e;
      }
    }
    const settings = this.settings({ force: true }),
      connectionEnv = Object.fromEntries(
        Object.entries(settings.env || {}).filter(
          ([k, v]) =>
            typeof v === "string" &&
            (/^ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL|MODEL|DEFAULT_[A-Z_]+|SMALL_FAST_MODEL)$/.test(
              k,
            ) ||
              [
                "CLAUDE_CODE_SUBAGENT_MODEL",
                "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
                "MAX_THINKING_TOKENS",
                "API_TIMEOUT_MS",
              ].includes(k)),
        ),
      );
    const signature = createHash("sha256")
      .update(
        JSON.stringify([connectionEnv, settings.model, this.mcp.signature()]),
      )
      .digest("hex");
    let live = this.live.get(s.id);
    if (live && live.signature === signature && !live.closed) {
      live.lastUsed = Date.now();
      return live;
    }
    if (live) {
      check(!live.busy, "SESSION_BUSY");
      live.closed = true;
      live.queue.end();
      live.query.close();
      this.live.delete(s.id);
    }
    const queue = new InputQueue();
    const sdk =
      this.createQuery ||
      (await import("@anthropic-ai/claude-agent-sdk")).query;
    let processPid, processExit;
    const options = {
      cwd: this.projects.get(s.projectId).root,
      pathToClaudeCodeExecutable: fs.existsSync("/usr/local/bin/claude")
        ? "/usr/local/bin/claude"
        : "/usr/bin/claude",
      spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
        const child = spawn(command, args, {
          cwd,
          env,
          signal,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
        processPid = child.pid;
        processExit = new Promise((resolve) => child.once("close", resolve));
        child.stderr.on("data", () => {});
        return child;
      },
      env: {
        ...process.env,
        ...connectionEnv,
        ...(!connectionEnv.ANTHROPIC_MODEL && settings.model
          ? { ANTHROPIC_MODEL: settings.model }
          : {}),
      },
      permissionMode: s.permissionMode,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      settingSources: ["user", "project"],
      settings: { disableAllHooks: true },
      persistSession: true,
      mcpServers: this.mcp.servers(),
      strictMcpConfig: true,
      allowedTools: s.allowedTools || [
        "Read",
        "Glob",
        "Grep",
        "Bash(node *)",
        "Bash(pwd)",
        "Bash(ls *)",
      ],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      canUseTool: (name, input, context) => this.ask(s, name, input, context),
    };
    if (s.model !== "default") options.model = s.model;
    if (s.hasHistory) options.resume = s.id;
    else options.extraArgs = { "session-id": s.id };
    const query = sdk({ prompt: queue, options });
    live = {
      query,
      queue,
      signature,
      busy: false,
      closed: false,
      s,
      get pid() {
        return processPid;
      },
      get exited() {
        return processExit;
      },
    };
    this.live.set(s.id, live);
    live.loop = this.consume(s, live);
    // Initialization does not send a model prompt.
    try {
      live.models = await query.supportedModels();
      live.commands = await query.supportedCommands();
      if (Array.isArray(live.models) && live.models.length > 0) this.models = live.models;
      if (Array.isArray(live.commands) && live.commands.length > 0) this.commands = live.commands;
      await this.refreshAccountUsage(query, { retryIfNull: true });
      live.lastUsed = Date.now();
    } catch {
      live.closed = true;
      queue.end();
      query.close();
      if (this.live.get(s.id) === live) this.live.delete(s.id);
      throw Error("CLAUDE_INITIALIZATION_FAILED");
    }
    return live;
  }
  async ask(s, toolName, input, context = {}) {
    const requestId = randomUUID(),
      kind = toolName === "AskUserQuestion" ? "question" : "permission";
    return new Promise((resolve) => {
      const finish = (decision) => {
        if (!this.approvals.has(requestId)) return;
        this.approvals.delete(requestId);
        context.signal?.removeEventListener("abort", abort);
        this.event(s.id, "approval.resolved", {
          requestId,
          allowed: decision.behavior === "allow",
        });
        if (this.live.get(s.id)?.busy) this.state(s, "running");
        resolve(decision);
      };
      const abort = () =>
        finish({ behavior: "deny", message: "Request interrupted" });
      const pending = {
        requestId,
        sessionId: s.id,
        turnRequestId: this.live.get(s.id)?.currentRequestId || null,
        toolUseId: context.toolUseID || null,
        kind,
        toolName,
        input: this.scrub(input),
        originalInput: input,
        finish,
      };
      this.approvals.set(requestId, pending);
      context.signal?.addEventListener("abort", abort, { once: true });
      this.state(s, "waiting_permission");
      const { finish: ignored, originalInput: raw, ...request } = pending;
      this.event(s.id, "approval.required", { request });
      if (context.signal?.aborted) abort();
    });
  }
  async refreshAccountUsage(query, { retryIfNull = false } = {}) {
    if (!query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET) return this.accountUsage || null;
    try {
      let usageInfo = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      if (retryIfNull && usageInfo?.rate_limits_available && !usageInfo?.rate_limits) {
        await new Promise((r) => setTimeout(r, 650));
        usageInfo = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      }
      if (usageInfo) {
        const prev = this.accountUsage;
        this.accountUsage = {
          subscriptionType: usageInfo.subscription_type ?? prev?.subscriptionType ?? null,
          rateLimitsAvailable: Boolean(usageInfo.rate_limits_available),
          rateLimits: usageInfo.rate_limits ?? prev?.rateLimits ?? null,
          updatedAt: Date.now(),
        };
      }
    } catch {}
    return this.accountUsage || null;
  }
  finishTurn(s, live, status, detail = {}) {
    const requestId = live.currentRequestId;
    if (!requestId) return;
    const request = s.requests.find((r) => r.id === requestId);
    if (request) request.status = status;
    this.ledger.state(s.id, requestId, status);
    live.busy = false;
    live.currentRequestId = null;
    live.lastUsed = Date.now();
    this.state(s, status === "completed" ? "idle" : status);
    this.event(s.id, "turn.completed", {
      ...detail,
      requestId,
      status,
      success: status === "completed",
      accountUsage: this.accountUsage || null,
    });
    if (live?.query) {
      void this.refreshAccountUsage(live.query).then((au) => {
        if (au && !live.closed) this.event(s.id, "account.usage", { accountUsage: au });
      });
    }
  }
  releaseIdle(now = Date.now()) {
    for (const [id, live] of this.live)
      if (
        !live.busy &&
        !this.initializing.has(id) &&
        !this.sending.has(id) &&
        ![...this.approvals.values()].some((a) => a.sessionId === id) &&
        now - (live.lastUsed || now) >= 600000
      ) {
        live.closed = true;
        live.queue.end();
        live.query.close();
        this.live.delete(id);
      }
  }
  async consume(s, live) {
    try {
      for await (const message of live.query) {
        if (this.live.get(s.id) !== live || live.closed) break;
        if (message.type === "system" && message.subtype === "init") {
          s.actualModel = message.model || s.actualModel;
          live.tools = message.tools || [];
          this.event(s.id, "session.init", {
            model: s.actualModel,
            tools: live.tools,
            commands: message.slash_commands || [],
          });
          this.save();
        } else if (message.type === "stream_event") {
          const e = message.event;
          if (
            e?.type === "content_block_delta" &&
            e.delta?.type === "text_delta"
          )
            this.event(s.id, "text.delta", {
              messageId: message.uuid || live.messageId,
              text: e.delta.text,
            });
        } else if (message.type === "assistant") {
          live.messageId = message.uuid || randomUUID();
          if (message.message?.model && message.message.model !== "<synthetic>")
            s.actualModel = message.message.model;
          const local =
            live.nativeModelCommand && message.message?.model === "<synthetic>";
          const blocks = (message.message?.content || [])
            .filter((b) => b.type === "text" || b.type === "tool_use")
            .map((b) =>
              local && b.type === "text"
                ? { ...b, ...localCommandOutput(b.text) }
                : b,
            );
          if (live.currentRequestId)
            this.ledger.link(
              s.id,
              live.currentRequestId,
              live.messageId,
              local ? "command_result" : "assistant",
            );
          this.event(
            s.id,
            local ? "message.command_result" : "message.assistant",
            {
              id: live.messageId,
              requestId: live.currentRequestId,
              blocks,
              model: s.actualModel,
            },
          );
        } else if (message.type === "user") {
          const blocks = (
            Array.isArray(message.message?.content)
              ? message.message.content
              : []
          ).filter((b) => b.type === "tool_result");
          if (blocks.length)
            this.event(s.id, "message.tool", {
              id: message.uuid || randomUUID(),
              requestId: live.currentRequestId,
              blocks,
            });
        } else if (message.type === "result") {
          if (live.modelCommand && !message.is_error && !live.interrupted) {
            s.model = live.modelCommand;
            s.actualModel = null;
            this.event(s.id, "model.changed", { model: s.model });
          }
          live.modelCommand = null;
          live.nativeModelCommand = false;
          s.hasHistory = true;
          s.turns++;
          this.finishTurn(
            s,
            live,
            live.interrupted
              ? "interrupted"
              : message.is_error
                ? "failed"
                : "completed",
            {
              result: message.result || "",
              usage: message.usage || null,
              modelUsage: message.modelUsage || null,
              costUsd: message.total_cost_usd || 0,
              subtype: message.subtype,
            },
          );
          live.interrupted = false;
        } else if (
          ["task_started", "task_progress", "task_notification"].includes(
            message.type,
          )
        )
          this.event(s.id, "task.event", { data: message });
        else if (message.type === "rate_limit_event" && message.rate_limit_info)
          this.event(s.id, "rate.limit", { info: message.rate_limit_info });
      }
    } catch (e) {
      if (!live.closed && this.live.get(s.id) === live) {
        this.finishTurn(s, live, "failed");
        this.event(s.id, "runtime.error", { code: "CLAUDE_RUNTIME_FAILED" });
        this.state(s, "failed");
      }
    } finally {
      if (this.live.get(s.id) === live) {
        this.finishTurn(s, live, "interrupted");
        live.closed = true;
        live.busy = false;
        this.live.delete(s.id);
        this.cancelApprovals(s.id);
        if (["running", "waiting_permission", "starting"].includes(s.status))
          this.state(s, "interrupted");
      }
    }
  }
  cancelApprovals(id) {
    for (const p of [...this.approvals.values()])
      if (p.sessionId === id)
        p.finish({ behavior: "deny", message: "Session interrupted" });
  }
  async remove(p) {
    const id = p.sessionId;
    check(UUID.test(id || ""), "INVALID_SESSION_ID");
    check(p.confirm === true, "DELETE_CONFIRMATION_REQUIRED");
    check(
      !this.deleting.has(id) &&
        !this.initializing.has(id) &&
        !this.sending.has(id),
      "SESSION_BUSY",
    );
    const s = this.sessions.get(id),
      live = this.live.get(id);
    check(
      !live?.busy &&
        !["running", "starting", "waiting_permission"].includes(s?.status) &&
        ![...this.approvals.values()].some((a) => a.sessionId === id),
      "SESSION_BUSY",
    );
    this.deleting.add(id);
    try {
      let exists = false;
      try {
        createHistoryStore({ home: this.home }).call({
          operation: "read",
          sessionId: id,
        });
        exists = true;
      } catch (e) {
        if (e.message !== "HISTORY_NOT_FOUND") throw e;
      }
      check(s || exists || this.deleted.has(id), "SESSION_NOT_FOUND");
      if (live) {
        live.closed = true;
        live.queue.end();
        live.query.close();
        let timer;
        try {
          await Promise.race([
            live.loop,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Error("SESSION_SHUTDOWN_TIMEOUT")),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        this.live.delete(id);
      }
      if (exists) {
        await this.deleteHistory(id);
        try {
          createHistoryStore({ home: this.home }).call({
            operation: "read",
            sessionId: id,
          });
          throw Error("SESSION_HISTORY_DELETE_FAILED");
        } catch (e) {
          if (e.message !== "HISTORY_NOT_FOUND") throw e;
        }
      }
      this.deleted.add(id);
      const temp = this.deletedFile + ".tmp";
      fs.writeFileSync(temp, JSON.stringify([...this.deleted]) + "\n", {
        mode: 0o600,
      });
      fs.renameSync(temp, this.deletedFile);
      this.ledger.removeSession(id);
      this.sessions.delete(id);
      this.save();
      this.events = this.events.filter((v) => v.event.sessionId !== id);
      this.eventBytes = this.events.reduce((n, v) => n + v.size, 0);
      this.event(id, "session.deleted");
      return { deleted: true, sessionId: id };
    } finally {
      this.deleting.delete(id);
    }
  }
  async send(p) {
    check(!this.sending.has(p.sessionId), "SESSION_BUSY");
    this.sending.add(p.sessionId);
    try {
      return await this.sendOne(p);
    } finally {
      this.sending.delete(p.sessionId);
    }
  }
  async sendOne(p) {
    const s = this.get(p.sessionId);
    check(
      UUID.test(p.requestId || "") &&
        typeof p.text === "string" &&
        p.text.trim() &&
        Buffer.byteLength(p.text) <= 262144,
      "INVALID_MESSAGE",
    );
    const old = this.ledger.request(s.id, p.requestId);
    if (old)
      return {
        accepted: false,
        duplicate: true,
        status: old.status,
        requestId: p.requestId,
      };
    check(
      !["running", "waiting_permission", "starting"].includes(s.status),
      "SESSION_BUSY",
    );
    const live = await this.ensure(s);
    check(!live.busy, "SESSION_BUSY");
    const history = createHistoryStore({ home: this.home }).call({
      operation: "list",
    });
    s.hasHistory = s.hasHistory || history.sessions.some((r) => r.id === s.id);
    this.ledger.begin(s.id, p.requestId);
    live.busy = true;
    live.currentRequestId = p.requestId;
    live.nativeModelCommand = /^[ \t]*\/model(?:[ \t]+[^\r\n]*)?[ \t]*$/.test(
      p.text,
    );
    live.modelCommand =
      /^[ \t]*\/model[ \t]+([^\r\n]+?)[ \t]*$/.exec(p.text)?.[1] || null;
    s.requests.push({ id: p.requestId, status: "running" });
    s.requests = s.requests.slice(-256);
    if (s.title.startsWith("Claude "))
      s.title = this.scrub(p.text.replace(/\s+/g, " ").slice(0, 90));
    this.state(s, "running");
    this.event(s.id, "message.user", {
      id: p.requestId,
      requestId: p.requestId,
      text: p.text,
      translation: p.translation || "original",
    });
    live.queue.push({
      type: "user",
      uuid: p.requestId,
      session_id: s.id,
      parent_tool_use_id: null,
      message: { role: "user", content: p.text },
    });
    return { accepted: true, requestId: p.requestId, sessionId: s.id };
  }
  historyListing(params = {}) {
    const listing = createHistoryStore({ home: this.home }).call({
      operation: "list",
      cursor: params.cursor,
    });
    return {
      ...listing,
      sessions: listing.sessions.map((s) => {
        try {
          return {
            ...s,
            projectId:
              this.sessions.get(s.id)?.projectId ||
              this.projects.list().find((p) => p.root === s.cwd)?.id ||
              "legacy",
          };
        } catch (e) {
          return {
            ...s,
            projectId: "legacy",
            projectError: /^[A-Z_]+$/.test(e.message)
              ? e.message
              : "PROJECT_DIRECTORY_UNAVAILABLE",
          };
        }
      }),
    };
  }
  async call(method, p = {}) {
    if (method === "auth.reset") {
      check(p.confirm === true, "AUTH_RESET_CONFIRMATION_REQUIRED");
      check(
        !this.resettingAuth &&
          !this.initializing.size &&
          !this.sending.size &&
          !this.approvals.size &&
          ![...this.sessions.values()].some((s) =>
            ["running", "starting", "waiting_permission"].includes(s.status),
          ) &&
          ![...this.live.values()].some((l) => l.busy),
        "SESSION_BUSY",
      );
      check(
        !Object.keys(process.env).some(authEnvKey),
        "INHERITED_AUTH_REQUIRES_RESTART",
      );
      assertNoProjectAuth(
        [...this.projects.projects.values()].map((p) => p.root),
        this.home,
      );
      this.resettingAuth = true;
      let timer;
      try {
        const rows = [...this.live.values()];
        for (const l of rows) {
          l.closed = true;
          l.queue.end();
          l.query.close();
        }
        await Promise.race([
          Promise.all(rows.flatMap((l) => [l.loop, l.exited])),
          new Promise(
            (_, reject) =>
              (timer = setTimeout(
                () => reject(Error("AUTH_PROCESS_SHUTDOWN_TIMEOUT")),
                6000,
              )),
          ),
        ]);
        for (const l of rows)
          if (this.live.get(l.s.id) === l) this.live.delete(l.s.id);
        const result = resetClaudeAuth(this.home);
        this.invalidateSettingsCache();
        this.models = [];
        this.commands = [];
        this.tools = [];
        this.event(null, "auth.reset", { loggedIn: false });
        return result;
      } finally {
        clearTimeout(timer);
        this.resettingAuth = false;
      }
    }
    if (method === "projects.list") return this.projects.list();
    if (method === "projects.create") {
      const project = this.projects.create(p);
      this.event(null, "project.created", { project });
      return project;
    }
    if (method === "history.list") return this.historyListing(p);
    if (method === "status")
      return {
        protocol: 1,
        ready: true,
        bootId: this.bootId,
        seq: this.seq,
        sessions: [...this.sessions.values()],
        projects: this.projects.list(),
        models: this.models || [],
        commands: this.commands || [],
        modes: MODES,
        capabilities: {
          projects: true,
          chat: true,
          streaming: true,
          permissions: true,
          questions: true,
          models: true,
          history: true,
          background: true,
          sessionDeletion: true,
          mcpConfiguration: false,
          terminal: false,
        },
      };
    if (method === "session.delete") return this.remove(p);
    if (method === "session.create" || method === "session.resume")
      return this.open(p);
    if (method === "mcp.read") return this.mcp.read();
    if (method === "mcp.write")
      return { ...this.mcp.write(p.config, p.revision), applied: false };
    if (method === "mcp.status") {
      const live = await this.ensure(this.get(p.sessionId));
      return this.scrub(
        (await live.query.mcpServerStatus()).map(
          ({ name, status, tools, scope, source }) => ({
            name,
            status,
            tools,
            scope,
            source,
          }),
        ),
      );
    }
    if (method === "mcp.apply") {
      const live = await this.ensure(this.get(p.sessionId));
      check(!live.busy, "SESSION_BUSY");
      const result = await live.query.setMcpServers(this.mcp.servers());
      return {
        added: result.added,
        removed: result.removed,
        errors: Object.keys(result.errors || {}),
        servers: await this.call("mcp.status", p),
      };
    }
    if (method === "mcp.reconnect") {
      const live = await this.ensure(this.get(p.sessionId));
      check(
        typeof p.name === "string" && p.name.length <= 100,
        "MCP_SERVER_INVALID",
      );
      await live.query.reconnectMcpServer(p.name);
      return this.call("mcp.status", p);
    }
    if (method === "history.read") {
      check(UUID.test(p.sessionId || ""), "INVALID_SESSION_ID");
      check(!this.deleted.has(p.sessionId), "SESSION_DELETED");
      check(!this.deleting.has(p.sessionId), "SESSION_BUSY");
      const page = createHistoryStore({ home: this.home }).call({
        operation: "read",
        sessionId: p.sessionId,
        before: p.before,
        complete: p.complete,
      });
      for (const m of page.messages) {
        if (
          m.kind === "command" &&
          m.requestId &&
          this.ledger.request(p.sessionId, m.requestId)
        )
          this.ledger.link(p.sessionId, m.requestId, m.id, "command");
        if (m.kind === "command_result" && m.parentId) {
          const parent = this.ledger.links(p.sessionId, [m.parentId])[0];
          if (parent)
            this.ledger.link(
              p.sessionId,
              parent.requestId,
              m.id,
              "command_result",
            );
        }
      }
      return {
        ...page,
        requestLinks: this.ledger.links(
          p.sessionId,
          page.messages.map((m) => m.id),
        ),
      };
    }
    if (method === "message.send") return this.send(p);
    if (method === "events.since") {
      check(
        Number.isSafeInteger(p.after ?? 0) && (p.after ?? 0) >= 0,
        "INVALID_CURSOR",
      );
      const after = p.after || 0;
      const candidates = this.events.filter(
          (v) =>
            v.event.seq > after &&
            (!p.sessionId || v.event.sessionId === p.sessionId),
        ),
        events = [];
      let bytes = 0,
        nextAfter = after,
        gap =
          this.seq > after &&
          (!this.events.length || after < this.events[0].event.seq - 1);
      for (const row of candidates) {
        if (row.size > 900000) {
          gap = true;
          nextAfter = row.event.seq;
          continue;
        }
        if (bytes + row.size > 900000) break;
        events.push(row.event);
        bytes += row.size;
        nextAfter = row.event.seq;
      }
      const hasMore = candidates.some((row) => row.event.seq > nextAfter);
      return {
        bootId: this.bootId,
        seq: this.seq,
        gap,
        events,
        nextAfter: hasMore ? nextAfter : this.seq,
        hasMore,
      };
    }
    if (method === "capabilities.read") {
      const s = this.get(p.sessionId),
        live =
          p.initialize === false ? this.live.get(s.id) : await this.ensure(s);
      const stale = !this.accountUsage?.rateLimits || Date.now() - (this.accountUsage.updatedAt || 0) > 15000;
      if (live?.query && (p.initialize || stale)) {
        await this.refreshAccountUsage(live.query, { retryIfNull: Boolean(p.initialize) });
      }
      return {
        models: live?.models?.length ? live.models : this.models || [],
        commands: live?.commands?.length ? live.commands : this.commands || [],
        tools: live?.tools?.length ? live.tools : this.tools || [],
        modes: MODES,
        permissionMode: s.permissionMode,
        model: s.model,
        actualModel: s.actualModel,
        accountUsage: this.accountUsage || null,
      };
    }
    if (method === "model.set") {
      const s = this.get(p.sessionId);
      check(
        typeof p.model === "string" &&
          p.model.length > 0 &&
          p.model.length <= 200 &&
          !/[\r\n\x00]/.test(p.model),
        "INVALID_MODEL",
      );
      const live = this.live.get(s.id);
      check(!live?.busy, "SESSION_BUSY");
      if (live)
        await live.query.setModel(p.model === "default" ? undefined : p.model);
      s.model = p.model;
      s.actualModel = null;
      this.save();
      this.event(s.id, "model.changed", { model: p.model });
      return s;
    }
    if (method === "permission.setMode") {
      const s = this.get(p.sessionId);
      check(MODES.includes(p.mode), "INVALID_PERMISSION_MODE");
      const live = this.live.get(s.id);
      if (live) await live.query.setPermissionMode(p.mode);
      s.permissionMode = p.mode;
      this.save();
      this.event(s.id, "permission.changed", { mode: p.mode });
      return s;
    }
    if (method === "approval.respond") {
      const pending = this.approvals.get(p.requestId);
      check(pending && pending.sessionId === p.sessionId, "APPROVAL_NOT_FOUND");
      check(typeof p.allow === "boolean", "INVALID_APPROVAL");
      let input = pending.originalInput;
      if (pending.kind === "question" && p.allow) {
        check(
          p.answers &&
            typeof p.answers === "object" &&
            !Array.isArray(p.answers),
          "INVALID_ANSWER",
        );
        input = { ...input, answers: p.answers };
      }
      pending.finish(
        p.allow
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "User denied this request" },
      );
      return { resolved: true };
    }
    if (method === "approvals.list")
      return [...this.approvals.values()].map(
        ({ finish, originalInput, ...p }) => p,
      );
    if (method === "session.release") {
      const s = this.get(p.sessionId),
        live = this.live.get(s.id);
      check(!live?.busy, "SESSION_BUSY");
      if (live) {
        live.closed = true;
        live.queue.end();
        live.query.close();
        this.live.delete(s.id);
      }
      return { released: true };
    }
    if (method === "task.interrupt") {
      const s = this.get(p.sessionId),
        live = this.live.get(s.id);
      this.cancelApprovals(s.id);
      if (live) {
        const wasBusy = live.busy;
        live.interrupted = wasBusy;
        const owned = descendants(live.pid);
        try {
          if (wasBusy) await live.query.interrupt();
        } finally {
          const all = new Map(
            [...owned, ...descendants(live.pid)].map((row) => [row.pid, row]),
          );
          await stopDescendants([...all.values()]);
          if (!wasBusy) this.state(s, "interrupted");
        }
      } else this.state(s, "interrupted");
      return { interrupted: true };
    }
    throw Error("METHOD_NOT_ALLOWED");
  }
  close() {
    this.closed = true;
    try {
      this._settingsWatcher?.close();
    } catch {}
    this._settingsWatcher = null;
    clearInterval(this.idleTimer);
    for (const live of this.live.values()) {
      this.finishTurn(live.s, live, "interrupted");
      live.closed = true;
      live.queue.end();
      live.query.close();
    }
    this.live.clear();
    for (const s of this.sessions.values())
      if (["running", "waiting_permission"].includes(s.status))
        s.status = "interrupted";
    this.save();
    this.ledger.close();
  }
}
