import { EventEmitter } from "node:events";
import { RuntimeClient } from "./runtime-client.mjs";
import { CodexTranslator } from "./codex-translator.mjs";
import { ChatCompletionsTranslator } from "./chat-completions-translator.mjs";
import { ChatStore } from "./chat-store.mjs";
import { UUID } from "../runtime/session.mjs";
import { randomUUID } from "node:crypto";
import {readChatPreferences, saveChatPreferences} from './chat-preferences.mjs';
const allowed = [
  "projects.list",
  "projects.create",
  "history.list",
  "status",
  "session.create",
  "session.resume",
  "session.release",
  "history.read",
  "events.since",
  "capabilities.read",
  "model.set",
  "permission.setMode",
  "approval.respond",
  "approvals.list",
  "task.interrupt",
  "files.capabilities",
  "files.list",
  "files.read",
  "files.write",
  "files.mkdir",
  "files.rename",
  "files.remove",
  "git.init",
  "git.status",
  "git.diff",
  "git.log",
  "git.stage",
  "git.unstage",
  "git.commit",
  "git.branches",
  "git.checkout",
  "git.remotes",
  "git.fetch",
  "git.pull",
  "git.push",
  "mcp.read",
  "mcp.write",
  "mcp.apply",
  "mcp.status",
  "mcp.reconnect",
  "terminal.list",
  "terminal.open",
  "terminal.read",
  "terminal.input",
  "terminal.resize",
  "terminal.close",
];
export class AgentService extends EventEmitter {
  constructor({
    runtime = new RuntimeClient(),
    translator = new CodexTranslator(),
    store = new ChatStore(),
    getPreferences = readChatPreferences,
  } = {}) {
    super();
    Object.assign(this, { runtime, translator, store, getPreferences });
    this.apiTranslator = new ChatCompletionsTranslator();
    this.jobs = new Map();
    this.outputs = new Map();
    this.historyQueue = new Map();
    this.historyActive = 0;
    runtime.on("event", (e) => this.onEvent(e));
    runtime.on("disconnected", () =>
      this.emit("event", { kind: "connection.lost", sessionId: null }),
    );
  }
  translate(text, targetLanguage, prefs = this.getPreferences(), signal) {
    if (prefs.provider === 'none') throw Error("TRANSLATION_DISABLED");
    if (prefs.provider === 'openai-compatible')
      return this.apiTranslator.translate(text, targetLanguage, prefs, signal);
    return this.translator.translate(text, targetLanguage, {model:prefs.model, signal});
  }
  output(row) {
    const prefs = this.getPreferences();
    if (this.closed || !row.source || prefs.provider === 'none') return;
    const key = row.session_id + ":" + row.message_id;
    if (
      this.outputs.has(key) ||
      !this.store.claim(row.session_id, row.message_id, row.source)
    )
      return;
    const event = {
      sessionId: row.session_id,
      requestId: row.request_id,
      messageId: row.message_id,
    };
    this.emit("event", { ...event, kind: "translation.output.started" });
    const pending = this.translate(row.source, prefs.outputLanguage || "zh-CN", prefs)
      .then(
        (text) => {
          if (this.closed) return;
          if (
            this.store.translated(
              row.session_id,
              row.message_id,
              text,
              row.source,
            )
          )
            this.emit("event", {
              ...event,
              kind: "translation.output.completed",
              text,
            });
        },
        () => {
          if (this.closed) return;
          this.store.failed(row.session_id, row.message_id);
          this.emit("event", {
            ...event,
            kind: "translation.output.failed",
            code: "TRANSLATION_FAILED",
          });
        },
      )
      .finally(() => {
        this.outputs.delete(key);
        if (!this.closed) {
          this.store.release(row.session_id, row.message_id);
          const changed = this.store
            .pending(row.session_id)
            .find(
              (m) => m.message_id === row.message_id && m.source !== row.source,
            );
          if (changed) this.output(changed);
        }
      });
    this.outputs.set(key, pending);
  }
  onEvent(event) {
    if (this.closed) return;
    try {
      const { sessionId, requestId } = event;
      if (event.kind === "session.deleted") this.forgetSession(sessionId);
      else if (sessionId && this.store.isDeleted(sessionId)) return;
      if (event.kind === "message.user" && requestId)
        this.store.message(sessionId, requestId, event.id, "user", event.text);
      if (event.kind === "message.command_result" && requestId)
        this.store.message(
          sessionId,
          requestId,
          event.id,
          "command_result",
          event.blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
        );
      if (event.kind === "message.assistant" && requestId) {
        const text = event.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        this.store.message(sessionId, requestId, event.id, "assistant", text);
        for (const row of this.store.pending(sessionId)) this.output(row);
      }
      if (event.kind === "turn.completed" && requestId)
        this.store.state(
          sessionId,
          requestId,
          event.status || (event.success ? "completed" : "failed"),
        );
    } catch {
      this.emit("event", {
        kind: "storage.error",
        sessionId: event.sessionId,
        code: "BILINGUAL_STORAGE_FAILED",
      });
    }
    this.emit("event", event);
  }
  forgetSession(id) {
    this.jobs.get(id)?.abort();
    for (const [key, row] of this.historyQueue)
      if (row.session_id === id) this.historyQueue.delete(key);
    this.store.deleteSession(id);
  }
  async recover(sessionId, conversation, translateOutput = true) {
    // Only explicit native IDs are matched. Older sessions have no Chinese source to invent.
    const index = new Map();
    for (const link of conversation.requestLinks || []) {
      if (!this.store.turn(sessionId, link.requestId)) continue;
      this.store.state(sessionId, link.requestId, link.status);
      index.set(link.id, link);
    }
    for (const m of conversation.messages) {
      const owner = index.get(m.id);
      if (owner && m.contentComplete !== false)
        this.store.message(
          sessionId,
          owner.requestId,
          m.id,
          owner.role,
          m.blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
        );
    }
    if (translateOutput)
      for (const row of this.store.pending(sessionId)) this.output(row);
  }
  queueHistory(row) {
    const key = row.session_id + ":" + row.message_id;
    if (row.translation || row.status === "failed" || this.outputs.has(key))
      return;
    this.historyQueue.set(key, row);
    this.drainHistory();
  }
  drainHistory() {
    while (!this.closed && this.historyActive < 2 && this.historyQueue.size) {
      const prefs = this.getPreferences();
      if (prefs.provider === 'none') {
        this.historyQueue.clear();
        return;
      }
      const [key, row] = this.historyQueue.entries().next().value;
      this.historyQueue.delete(key);
      if (this.outputs.has(key) || !this.store.claimHistory(row)) continue;
      this.historyActive++;
      const event = { sessionId: row.session_id, messageId: row.message_id };
      this.emit("event", { ...event, kind: "translation.output.started" });
      const pending = Promise.resolve()
        .then(() => this.translate(row.source, prefs.outputLanguage || "zh-CN", prefs))
        .then(
          (text) => {
            if (!this.closed && this.store.finishHistory(row, text))
              this.emit("event", {
                ...event,
                kind: "translation.output.completed",
                text,
              });
          },
          () => {
            if (!this.closed) {
              this.store.finishHistory(row, null);
              this.emit("event", {
                ...event,
                kind: "translation.output.failed",
                code: "TRANSLATION_FAILED",
              });
            }
          },
        )
        .finally(() => {
          this.historyActive--;
          this.outputs.delete(key);
          if (!this.closed) {
            const latest = this.store.historySource(
              row.session_id,
              row.message_id,
            );
            if (latest && latest.source !== row.source)
              this.queueHistory(
                this.store.historyMessage(
                  row.session_id,
                  row.message_id,
                  latest.source,
                ),
              );
          }
          this.drainHistory();
        });
      this.outputs.set(key, pending);
    }
  }
  async call(method, params = {}) {
    if (
      params.sessionId &&
      this.store.isDeleted(params.sessionId) &&
      method !== "session.delete"
    )
      throw Error("SESSION_DELETED");
    if (method === "session.delete") {
      if (!UUID.test(params.sessionId || "")) throw Error("INVALID_SESSION_ID");
      if (params.confirm !== true) throw Error("DELETE_CONFIRMATION_REQUIRED");
      if (this.jobs.has(params.sessionId)) throw Error("SESSION_BUSY");
      const result = await this.runtime.call(method, params);
      this.forgetSession(params.sessionId);
      return result;
    }
    if (method === "storage.info") return this.store.info();
    if (method === "preferences.save") return saveChatPreferences(params);
    if (method === "translator.status") {
      const prefs = this.getPreferences();
      if (prefs.provider === 'none') return { authenticated: true, provider: 'none', disabled: true, model: '已关闭翻译' };
      return prefs.provider === 'openai-compatible' ? this.apiTranslator.status(prefs) : this.translator.status(prefs.model);
    }
    if (method === "translations.read")
      return this.store.bilingual(params.sessionId, params.messageIds || []);
    if (method === "translations.retry") {
      if (this.getPreferences().provider === 'none') throw Error("TRANSLATION_DISABLED");
      if (
        !UUID.test(params.sessionId || "") ||
        !UUID.test(params.messageId || "")
      )
        throw Error("INVALID_MESSAGE");
      const cached = this.store.historySource(
        params.sessionId,
        params.messageId,
      );
      if (cached?.source) {
        this.queueHistory(
          this.store.historyMessage(
            params.sessionId,
            params.messageId,
            cached.source,
            { retry: true },
          ),
        );
        return this.store.bilingual(params.sessionId, [params.messageId]);
      }
      const page = await this.runtime.call("history.read", {
        sessionId: params.sessionId,
        before: params.before,
        complete: true,
      });
      const message = page.messages.find((m) => m.id === params.messageId);
      if (
        !message ||
        message.kind ||
        !["user", "assistant"].includes(message.role)
      )
        throw Error("MESSAGE_NOT_TRANSLATABLE");
      if (message.contentComplete === false)
        throw Error("HISTORY_CONTENT_TRUNCATED");
      const text = message.blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (!text) throw Error("MESSAGE_NOT_TRANSLATABLE");
      this.queueHistory(
        this.store.historyMessage(params.sessionId, message.id, text, {
          retry: true,
        }),
      );
      return this.store.bilingual(params.sessionId, [message.id]);
    }
    if (method === "approval.respond" && params.allow && params.answers) {
      const pending = (await this.runtime.call("approvals.list")).find(
        (p) =>
          p.requestId === params.requestId && p.sessionId === params.sessionId,
      );
      if (!pending) throw Error("APPROVAL_NOT_FOUND");
      const turn = pending.turnRequestId && this.store.turn(params.sessionId, pending.turnRequestId);
      const prefs = this.getPreferences();
      const answers = {},
        attempt = randomUUID(),
        controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 120000);
      try {
        await Promise.all(
          Object.entries(params.answers).map(async ([question, answer]) => {
            if (typeof answer !== "string" || answer.length > 20000)
              throw Error("INVALID_ANSWER");
            const q = pending.input.questions?.find(
                (q) => q.question === question,
              ),
              options = q?.options?.map((v) => v.label) || [];
            const chosen = answer.split(", "),
              native =
                chosen.length && chosen.every((v) => options.includes(v));
            const sendOriginal = native || turn?.translate_input === 0 || prefs.provider === 'none';
            this.store.answer(pending, attempt, question, answer, !sendOriginal);
            answers[question] = sendOriginal
              ? answer
              : await this.translate(answer, turn?.target_language ?? prefs.targetLanguage, prefs, controller.signal);
            this.store.answerTranslated(
              pending,
              attempt,
              question,
              answers[question],
            );
          }),
        );
        if (controller.signal.aborted) throw Error("TRANSLATION_TIMEOUT");
        const result = await this.runtime.call(method, { ...params, answers });
        this.store.answerState(pending, attempt, "submitted");
        return result;
      } catch (e) {
        controller.abort();
        this.store.answerState(pending, attempt, "failed");
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    if (method === "message.send") {
      const {
        sessionId,
        requestId,
        text,
        attachmentPaths = [],
        translate: requestedTranslation = true,
        translateOutput = true,
      } = params;
      if (
        !UUID.test(sessionId || "") ||
        !UUID.test(requestId || "") ||
        typeof text !== "string" ||
        !text.trim() ||
        !Array.isArray(attachmentPaths) ||
        !attachmentPaths.every(
          (file) => typeof file === "string" && /^\.isolation-uploads\/[A-Za-z0-9._-]+$/.test(file),
        )
      )
        throw Error("INVALID_MESSAGE");
      const attachmentPrefix = attachmentPaths.length
        ? attachmentPaths.map((file) => `@${file}`).join(" ") + "\n\n"
        : "";
      const source = attachmentPrefix + text;
      if (Buffer.byteLength(source) > 262144) throw Error("INVALID_MESSAGE");
      const prefs = this.getPreferences();
      const translationEnabled = prefs.provider !== 'none';
      const effectiveTranslateOutput = Boolean(translateOutput && translationEnabled);
      // Native control syntax and model IDs must never be rewritten by the translator.
      const translate =
        requestedTranslation &&
        translationEnabled &&
        !/^[ \t]*\/model(?:[ \t]+[^\r\n]*)?[ \t]*$/.test(source);
      const old = this.store.turn(sessionId, requestId);
      if (old) {
        this.store.begin({
          sessionId,
          requestId,
          text: source,
          translate,
          translateOutput: effectiveTranslateOutput,
        });
        return {
          accepted: false,
          duplicate: true,
          status: old.status,
          requestId,
        };
      }
      if (this.jobs.has(sessionId)) throw Error("SESSION_BUSY");
      const {targetLanguage} = prefs;
      this.store.begin({
        sessionId,
        requestId,
        text: source,
        translate,
        translateOutput: effectiveTranslateOutput,
        targetLanguage,
      });
      const controller = new AbortController();
      this.jobs.set(sessionId, controller);
      this.emit("event", {
        kind: translate ? "translation.input.started" : "message.submitting",
        sessionId,
        requestId,
      });
      void (async () => {
        try {
          const body = translate
            ? await this.translate(text, targetLanguage, prefs, controller.signal)
            : text;
          const submitted = attachmentPrefix + body;
          if (controller.signal.aborted) throw Error("TRANSLATION_CANCELLED");
          if (this.closed) return;
          this.store.submitted(sessionId, requestId, submitted);
          this.emit("event", {
            kind: "translation.input.completed",
            sessionId,
            requestId,
            messageId: requestId,
            text: submitted,
            translated: translate,
          });
          const result = await this.runtime.call("message.send", {
            sessionId,
            requestId,
            text: submitted,
            translation: translate ? `${prefs.provider ?? 'codex'}-${targetLanguage}` : "original",
          });
          if (this.closed) return;
          this.store.state(
            sessionId,
            requestId,
            result.duplicate ? result.status : "submitted",
          );
          this.emit("event", {
            kind: "message.accepted",
            sessionId,
            requestId,
            result,
          });
        } catch (e) {
          if (this.closed) return;
          this.store.state(sessionId, requestId, "failed");
          this.emit("event", {
            kind: "message.failed",
            sessionId,
            requestId,
            code: /^[A-Z_]+(?:_\d{3})?$/.test(e.message) ? e.message : "MESSAGE_FAILED",
          });
        } finally {
          if (this.jobs.get(sessionId) === controller)
            this.jobs.delete(sessionId);
        }
      })();
      return {
        accepted: true,
        requestId,
        stage: translate ? "translating" : "submitting",
      };
    }
    if (method === "task.interrupt") this.jobs.get(params.sessionId)?.abort();
    if (!allowed.includes(method)) throw Error("METHOD_NOT_ALLOWED");
    const result = await this.runtime.call(method, params);
    if (method === "history.read") {
      if (this.store.isDeleted(params.sessionId))
        throw Error("SESSION_DELETED");
      const complete = result.messages.some((m) => m.contentComplete === false)
        ? await this.runtime.call("history.read", {
            sessionId: params.sessionId,
            before: params.before,
            complete: true,
          })
        : result;
      const shouldTranslateOutput =
        params.translateOutput !== false && this.getPreferences().provider !== 'none';
      if (this.store.owned(params.sessionId).length)
        await this.recover(
          params.sessionId,
          complete,
          shouldTranslateOutput,
        );
      for (const m of complete.messages) {
        if (
          !shouldTranslateOutput ||
          m.contentComplete === false ||
          m.kind ||
          !["user", "assistant"].includes(m.role)
        )
          continue;
        const text = m.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (!text) continue;
        const known = this.store.bilingual(params.sessionId, [m.id])[m.id];
        if (!known)
          this.queueHistory(
            this.store.historyMessage(params.sessionId, m.id, text),
          );
        else if (known.sourceKind === "history")
          this.queueHistory(
            this.store.historyMessage(params.sessionId, m.id, text),
          );
      }
      const bilingual = this.store.bilingual(
        params.sessionId,
        result.messages.map((m) => m.id),
      );
      return {
        ...result,
        bilingual,
        answers: this.store.answers(params.sessionId, [
          ...new Set(
            Object.values(bilingual)
              .map((b) => b.requestId)
              .filter(Boolean),
          ),
        ]),
        contentStoredOnHost: true,
      };
    }
    if (method === "status") return { ...result, storage: this.store.info() };
    return result;
  }
  close() {
    this.closed = true;
    this.historyQueue.clear();
    for (const job of this.jobs.values()) job.abort();
    const closing = this.translator.close();
    this.apiTranslator.close();
    this.runtime.close();
    this.store.close();
    return closing;
  }
}
