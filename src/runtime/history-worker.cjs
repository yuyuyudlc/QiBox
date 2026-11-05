// Fixed, bounded, read-only Claude history reader; executed as the worker user.
const fs = require("node:fs"),
  path = require("node:path");
const { stripVTControlCharacters } = require("node:util");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clip = (s, n = 24000) => {
  const b = Buffer.from(String(s ?? ""));
  return b.length <= n
    ? b.toString("utf8")
    : b
        .subarray(0, n)
        .toString("utf8")
        .replace(/\uFFFD$/u, "") + "\n…（内容过长，已截断显示）";
};
function localCommandOutput(content) {
  const wrapped =
    /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>\s*$/.exec(
      content,
    );
  return {
    text: stripVTControlCharacters(wrapped ? wrapped[2] : content),
    isError: wrapped?.[1] === "stderr",
  };
}
function createHistoryStore({ home = "/home/agent" } = {}) {
  const base = path.resolve(home, ".claude"),
    projects = path.join(base, "projects");
  const check = (ok, code) => {
    if (!ok) throw Error(code);
  };
  let secrets = [];
  try {
    const file = safe(path.join(base, "settings.json")),
      fd = fs.openSync(
        file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
    try {
      check(fs.fstatSync(fd).size <= 262144, "SETTINGS_TOO_LARGE");
      const s = JSON.parse(fs.readFileSync(fd, "utf8"));
      secrets = Object.entries(s.env || {})
        .filter(
          ([k, v]) =>
            /KEY|TOKEN/.test(k) && typeof v === "string" && v.length > 8,
        )
        .map(([, v]) => v);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
  const scrub = (s) => {
    s = String(s ?? "");
    for (const v of secrets) s = s.split(v).join("[REDACTED]");
    return s;
  };
  function safe(file, { missing = false } = {}) {
    const absolute = path.resolve(file);
    check(absolute.startsWith(base + path.sep), "HISTORY_PATH_DENIED");
    let current = base;
    for (const part of path.relative(base, absolute).split(path.sep)) {
      if (fs.existsSync(current))
        check(!fs.lstatSync(current).isSymbolicLink(), "HISTORY_PATH_DENIED");
      current = path.join(current, part);
      if (!fs.existsSync(current)) {
        if (missing) continue;
        throw Error("HISTORY_NOT_FOUND");
      }
      check(!fs.lstatSync(current).isSymbolicLink(), "HISTORY_PATH_DENIED");
    }
    return absolute;
  }
  function boundedJson(file, max = 1100000) {
    try {
      safe(file);
      const fd = fs.openSync(
        file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
      try {
        check(fs.fstatSync(fd).size <= max, "HISTORY_RECORD_TOO_LARGE");
        return JSON.parse(fs.readFileSync(fd, "utf8"));
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      if (e.message === "HISTORY_PATH_DENIED") throw e;
      return null;
    }
  }
  function files(sessionId) {
    let deleted = [];
    try {
      deleted = JSON.parse(
        fs.readFileSync(
          path.join(home, ".isolation/deleted-sessions.json"),
          "utf8",
        ),
      );
      check(
        Array.isArray(deleted) && deleted.every((id) => UUID.test(id)),
        "HISTORY_DELETION_STATE_INVALID",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const deletedIds = new Set(deleted);
    if (!fs.existsSync(projects)) return { items: [], limited: false };
    safe(projects);
    const items = [];
    let limited = false;
    const directories = fs
      .readdirSync(projects, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.isSymbolicLink());
    for (const d of directories)
      for (const name of sessionId
        ? [sessionId + ".jsonl"]
        : fs.readdirSync(safe(path.join(projects, d.name)))) {
        if (
          !name.endsWith(".jsonl") ||
          !UUID.test(name.slice(0, -6)) ||
          deletedIds.has(name.slice(0, -6))
        )
          continue;
        const file = path.join(projects, d.name, name);
        if (sessionId && !fs.existsSync(file)) continue;
        safe(file);
        const stat = fs.statSync(file);
        if (!stat.isFile()) continue;
        items.push({
          id: name.slice(0, -6),
          file,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
        check(items.length <= 100000, "HISTORY_INDEX_TOO_LARGE");
      }
    const unique = new Map();
    for (const item of items.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ))
      if (!unique.has(item.id)) unique.set(item.id, item);
    return { items: [...unique.values()], limited };
  }
  function normalize(row, offset, complete = false) {
    if (row.isSidechain) return null;
    if (
      row.type === "system" &&
      row.subtype === "local_command" &&
      typeof row.content === "string"
    ) {
      const output = localCommandOutput(row.content),
        text = clip(scrub(output.text));
      if (!text.trim()) return null;
      return {
        id: typeof row.uuid === "string" ? row.uuid : "offset-" + offset,
        role: "system",
        kind: "command_result",
        parentId: row.parentUuid,
        time: row.timestamp || null,
        blocks: [
          {
            type: "text",
            text,
            isError: row.level === "error" || output.isError,
          },
        ],
        offset,
        fullText: text,
      };
    }
    if (!["user", "assistant"].includes(row.type)) return null;
    const content = row.message?.content;
    const source =
      typeof content === "string"
        ? [{ type: "text", text: content }]
        : Array.isArray(content)
          ? content
          : [];
    const plain =
      source.length === 1 && source[0].type === "text" ? source[0].text : null;
    // These records are CLI control metadata, not user prose or model replies.
    if (
      row.type === "user" &&
      row.isMeta &&
      typeof plain === "string" &&
      /^\s*<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/.test(
        plain,
      )
    )
      return null;
    const command =
      row.type === "user" && typeof plain === "string"
        ? /^\s*<command-name>(\/[A-Za-z][\w:.-]*)<\/command-name>\s*<command-message>[^<]*<\/command-message>\s*<command-args>([\s\S]*?)<\/command-args>\s*$/.exec(
            plain,
          )
        : null;
    if (command) {
      const text = clip(
        scrub(command[1] + (command[2].trim() ? " " + command[2].trim() : "")),
      );
      return {
        id: typeof row.uuid === "string" ? row.uuid : "offset-" + offset,
        role: "user",
        kind: "command",
        requestId: UUID.test(row.promptId || "") ? row.promptId : undefined,
        time: row.timestamp || null,
        blocks: [{ type: "text", text }],
        offset,
        fullText: text,
      };
    }
    const blocks = source.flatMap((b) => {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim())
        return [
          {
            type: "text",
            text: complete ? scrub(b.text) : clip(scrub(b.text)),
          },
        ];
      if (b.type === "tool_use")
        return [
          {
            type: "tool_use",
            name: clip(scrub(b.name), 100),
            text: clip(scrub(JSON.stringify(b.input ?? {}))),
            id: b.id,
          },
        ];
      if (b.type === "tool_result")
        return [
          {
            type: "tool_result",
            text: clip(
              scrub(
                typeof b.content === "string"
                  ? b.content
                  : JSON.stringify(b.content ?? []),
              ),
            ),
            isError: !!b.is_error,
            id: b.tool_use_id,
          },
        ];
      return [];
    });
    if (!blocks.length) return null;
    const role = blocks.every((b) => b.type === "tool_result")
      ? "tool"
      : row.type;
    return {
      id: typeof row.uuid === "string" ? row.uuid : "offset-" + offset,
      role,
      time: row.timestamp || null,
      blocks,
      contentComplete:
        complete ||
        source
          .filter((b) => b.type === "text")
          .every((b) => Buffer.byteLength(scrub(b.text)) <= 24000),
      offset,
      fullText: source
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n"),
    };
  }
  function page(file, before, limit = 80, complete = false) {
    safe(file);
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    try {
      const size = fs.fstatSync(fd).size,
        end = before == null ? size : Math.min(before, size),
        start = Math.max(0, end - 1048576);
      const b = Buffer.alloc(end - start);
      fs.readSync(fd, b, 0, b.length, start);
      let cursor = 0;
      if (start > 0) {
        const n = b.indexOf(10);
        cursor = n < 0 ? b.length : n + 1;
      }
      const rows = [];
      let ignored = 0;
      while (cursor < b.length) {
        let next = b.indexOf(10, cursor);
        if (next < 0) next = b.length;
        const line = b.subarray(cursor, next).toString("utf8");
        try {
          const m = normalize(JSON.parse(line), start + cursor, complete);
          if (m) rows.push(m);
        } catch {
          if (line.trim()) ignored++;
        }
        cursor = next + 1;
      }
      const selected = rows.slice(-limit);
      const nextBefore =
        selected.length && (rows.length > limit || start > 0)
          ? selected[0].offset
          : start > 0
            ? start
            : 0;
      return {
        messages: selected,
        nextBefore: nextBefore || null,
        size,
        ignored,
      };
    } finally {
      fs.closeSync(fd);
    }
  }
  function read(p) {
    check(UUID.test(p.sessionId), "INVALID_HISTORY_ID");
    check(
      p.before == null || (Number.isSafeInteger(p.before) && p.before >= 0),
      "INVALID_HISTORY_CURSOR",
    );
    const item = files(p.sessionId).items[0];
    check(item, "HISTORY_NOT_FOUND");
    const data = page(item.file, p.before, 80, p.complete === true);
    let budget = 0;
    const messages = [];
    for (const m of data.messages.reverse()) {
      const sample = m.fullText
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "");
      m.languageHint = /[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]/u.test(sample)
        ? "japanese_kana"
        : /[\u3400-\u9fff]/u.test(sample)
          ? "han_only"
          : "other";
      delete m.fullText;
      const bytes = Buffer.byteLength(JSON.stringify(m));
      if (budget + bytes > 700000) {
        data.outputTruncated = true;
        data.nextBefore = messages[0]?.offset ?? m.offset;
        break;
      }
      budget += bytes;
      messages.unshift(m);
    }
    for (const m of messages) delete m.offset;
    return {
      sessionId: p.sessionId,
      ...metadata(item),
      messages,
      nextBefore: data.nextBefore,
      ignoredLines: data.ignored,
      outputTruncated: !!data.outputTruncated,
      source: "WSL2 Claude Code JSONL",
      contentStoredOnHost: false,
    };
  }
  function metadata(item) {
    const fd = fs.openSync(
      item.file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    let title = "Claude 会话",
      cwd;
    try {
      const b = Buffer.alloc(Math.min(65536, item.size));
      fs.readSync(fd, b, 0, b.length, 0);
      for (const line of b.toString("utf8").split("\n"))
        try {
          const row = JSON.parse(line);
          if (typeof row.cwd === "string") cwd = row.cwd;
          const m = normalize(row, 0);
          if (m?.role === "user") {
            const text = m.blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join(" ");
            if (text) {
              title = clip(text.replace(/\s+/g, " "), 140);
              break;
            }
          }
        } catch {}
    } finally {
      fs.closeSync(fd);
    }

    return { title, ...(cwd ? { cwd } : {}) };
  }
  function list(p = {}) {
    const all = files(),
      cursor = p.cursor ?? 0;
    check(
      Number.isSafeInteger(cursor) && cursor >= 0,
      "INVALID_HISTORY_CURSOR",
    );
    return {
      limited: all.items.length > cursor + 256,
      nextCursor: all.items.length > cursor + 256 ? cursor + 256 : null,
      sessions: all.items
        .slice(cursor, cursor + 256)
        .map((item) => ({
          id: item.id,
          ...metadata(item),
          updatedAt: item.updatedAt,
          size: item.size,
        })),
    };
  }
  return {
    call: (p) => {
      check(p && typeof p === "object", "INVALID_HISTORY_REQUEST");
      if (p.operation === "list") return list(p);
      if (p.operation === "read") return read(p);
      throw Error("INVALID_HISTORY_OPERATION");
    },
  };
}
module.exports = { createHistoryStore, localCommandOutput };
