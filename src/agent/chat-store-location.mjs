import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ROOT } from "../core/policy.mjs";

export const CHAT_STORE_PATH = path.join(ROOT, ".runtime", "client.sqlite");

function identity(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

function physicalWindowsPath(file) {
  if (process.platform !== "win32" || !path.win32.isAbsolute(file)) return null;
  const root = path.win32.parse(file).root;
  if (!/^[a-zA-Z]:\\$/.test(root)) return null;
  return `\\\\localhost\\${root[0].toLowerCase()}$\\${file.slice(root.length)}`;
}

export function legacyChatStorePaths({
  localAppData = process.env.LOCALAPPDATA ||
    path.join(os.homedir(), ".local", "share"),
} = {}) {
  const nominal = path.join(localAppData, "AgentIsolation", "client.sqlite");
  const candidates = [];
  const physical = physicalWindowsPath(nominal);
  if (physical) candidates.push(physical);
  candidates.push(nominal);
  if (process.platform === "win32") {
    const packages = path.join(localAppData, "Packages");
    try {
      for (const entry of fs.readdirSync(packages, { withFileTypes: true }))
        if (entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name))
          candidates.push(
            path.join(
              packages,
              entry.name,
              "LocalCache",
              "Local",
              "AgentIsolation",
              "client.sqlite",
            ),
          );
    } catch {}
  }
  const seen = new Set(),
    result = [];
  for (const file of candidates) {
    const id = identity(file);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(file);
  }
  return result;
}

function hasTable(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}
function rows(db, table) {
  return hasTable(db, table) ? db.prepare(`SELECT * FROM ${table}`).all() : [];
}

function mergeOne(target, file, deleted, conflicts) {
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    for (const row of rows(source, "turns")) {
      if (deleted.has(row.session_id)) continue;
      const existing = target
        .prepare(
          "SELECT source,translate_input,translate_output FROM turns WHERE session_id=? AND request_id=?",
        )
        .get(row.session_id, row.request_id);
      if (!existing) {
        target
          .prepare(
            "INSERT INTO turns(session_id,request_id,source,translate_input,translate_output,submitted,status,created_at,target_language) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            row.session_id,
            row.request_id,
            row.source,
            row.translate_input,
            row.translate_output,
            row.submitted,
            row.status,
            row.created_at,
            row.target_language ?? "ja",
          );
      } else if (
        existing.source !== row.source ||
        existing.translate_input !== row.translate_input ||
        existing.translate_output !== row.translate_output
      ) {
        conflicts.add(`${row.session_id}:${row.request_id}`);
      }
    }
    for (const row of rows(source, "messages")) {
      if (deleted.has(row.session_id)) continue;
      const turn = target
        .prepare("SELECT 1 FROM turns WHERE session_id=? AND request_id=?")
        .get(row.session_id, row.request_id);
      if (!turn) continue;
      const existing = target
        .prepare(
          "SELECT request_id,source,translation FROM messages WHERE session_id=? AND message_id=?",
        )
        .get(row.session_id, row.message_id);
      if (!existing) {
        target
          .prepare(
            "INSERT INTO messages(session_id,message_id,request_id,role,source,translation,translation_status,lease_owner,lease_until) VALUES(?,?,?,?,?,?,?,NULL,NULL)",
          )
          .run(
            row.session_id,
            row.message_id,
            row.request_id,
            row.role,
            row.source,
            row.translation,
            row.translation_status,
          );
      } else if (
        existing.request_id === row.request_id &&
        existing.source === row.source &&
        existing.translation === null &&
        row.translation !== null
      ) {
        target
          .prepare(
            "UPDATE messages SET translation=?,translation_status='completed' WHERE session_id=? AND message_id=? AND translation IS NULL",
          )
          .run(row.translation, row.session_id, row.message_id);
      } else if (
        existing.request_id !== row.request_id ||
        existing.source !== row.source
      ) {
        conflicts.add(`${row.session_id}:${row.message_id}`);
      }
    }
    for (const row of rows(source, "history_translations")) {
      if (deleted.has(row.session_id)) continue;
      const existing = target
        .prepare(
          "SELECT source,translation FROM history_translations WHERE session_id=? AND message_id=?",
        )
        .get(row.session_id, row.message_id);
      if (!existing) {
        target
          .prepare(
            "INSERT INTO history_translations(session_id,message_id,source,translation,status,lease_owner,lease_until) VALUES(?,?,?,?,?,NULL,NULL)",
          )
          .run(
            row.session_id,
            row.message_id,
            row.source,
            row.translation,
            row.status,
          );
      } else if (
        existing.source === row.source &&
        existing.translation === null &&
        row.translation !== null
      ) {
        target
          .prepare(
            "UPDATE history_translations SET translation=?,status='completed' WHERE session_id=? AND message_id=? AND translation IS NULL",
          )
          .run(row.translation, row.session_id, row.message_id);
      } else if (existing.source !== row.source) {
        conflicts.add(`${row.session_id}:${row.message_id}`);
      }
    }
    for (const row of rows(source, "answers")) {
      if (deleted.has(row.session_id)) continue;
      target
        .prepare(
          "INSERT OR IGNORE INTO answers(session_id,approval_id,attempt_id,question,turn_request_id,tool_use_id,source,submitted,translated,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          row.session_id,
          row.approval_id,
          row.attempt_id,
          row.question,
          row.turn_request_id,
          row.tool_use_id,
          row.source,
          row.submitted,
          row.translated,
          row.status,
        );
    }
  } finally {
    source.close();
  }
}

function mergeSources(
  target,
  destination,
  { sources = legacyChatStorePaths() } = {},
) {
  const destinationId = identity(destination),
    unique = [],
    seen = new Set();
  for (const file of sources) {
    const id = identity(file);
    if (!id || id === destinationId || seen.has(id)) continue;
    seen.add(id);
    unique.push(file);
  }
  if (!unique.length) return { sources: 0, conflicts: 0 };
  const deleted = new Set(
    target
      .prepare("SELECT session_id FROM deleted_sessions")
      .all()
      .map((row) => row.session_id),
  );
  for (const file of unique) {
    const source = new DatabaseSync(file, { readOnly: true });
    try {
      for (const row of rows(source, "deleted_sessions"))
        deleted.add(row.session_id);
    } finally {
      source.close();
    }
  }
  const conflicts = new Set();
  target.exec("BEGIN IMMEDIATE");
  try {
    const tombstone = target.prepare(
      "INSERT OR IGNORE INTO deleted_sessions(session_id,deleted_at) VALUES(?,?)",
    );
    for (const sessionId of deleted)
      tombstone.run(sessionId, new Date().toISOString());
    for (const file of unique) mergeOne(target, file, deleted, conflicts);
    for (const sessionId of deleted)
      for (const table of [
        "messages",
        "answers",
        "history_translations",
        "turns",
      ])
        target
          .prepare(`DELETE FROM ${table} WHERE session_id=?`)
          .run(sessionId);
    target.exec("COMMIT");
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  }
  return { sources: unique.length, conflicts: conflicts.size };
}

// A bad historical database must never prevent opening the current database.
// A source is revisited only when its physical file or WAL changes.
export function mergeLegacyChatStores(
  target,
  destination,
  { sources = legacyChatStorePaths() } = {},
) {
  target.exec(
    "CREATE TABLE IF NOT EXISTS legacy_imports(source_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,status TEXT NOT NULL,imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  const destinationId = identity(destination),
    candidates = [],
    errors = [],
    seen = new Set();
  const signature = (file) =>
    [file, file + "-wal"]
      .map((p) => {
        try {
          const s = fs.statSync(p, { bigint: true });
          return `${s.size}:${s.mtimeNs}`;
        } catch {
          return "absent";
        }
      })
      .join(":");
  for (const file of sources) {
    const id = identity(file);
    if (!id || id === destinationId || seen.has(id)) continue;
    seen.add(id);
    const fingerprint = signature(file),
      old = target
        .prepare(
          "SELECT fingerprint,status FROM legacy_imports WHERE source_id=?",
        )
        .get(id);
    if (old?.fingerprint === fingerprint) {
      if (old.status === "failed")
        errors.push({ code: "LEGACY_IMPORT_FAILED", source: file });
      continue;
    }
    let source;
    try {
      source = new DatabaseSync(file, { readOnly: true });
      source.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
      for (const [table, columns] of Object.entries({
        turns:
          "session_id,request_id,source,translate_input,translate_output,submitted,status,created_at",
        messages:
          "session_id,message_id,request_id,role,source,translation,translation_status",
        history_translations: "session_id,message_id,source,translation,status",
        deleted_sessions: "session_id",
        answers:
          "session_id,approval_id,attempt_id,question,turn_request_id,tool_use_id,source,submitted,translated,status",
      }))
        if (hasTable(source, table))
          source.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`);
      candidates.push({ file, id, fingerprint });
    } catch {
      target
        .prepare(
          "INSERT OR REPLACE INTO legacy_imports(source_id,fingerprint,status) VALUES(?,?,'failed')",
        )
        .run(id, signature(file));
      errors.push({ code: "LEGACY_IMPORT_FAILED", source: file });
    } finally {
      source?.close();
    }
  }
  if (!candidates.length) return { sources: 0, conflicts: 0, errors };
  try {
    const result = mergeSources(target, destination, {
      sources: candidates.map((c) => c.file),
    });
    for (const c of candidates)
      target
        .prepare(
          "INSERT OR REPLACE INTO legacy_imports(source_id,fingerprint,status) VALUES(?,?,'completed')",
        )
        .run(c.id, signature(c.file));
    return { ...result, errors };
  } catch {
    for (const c of candidates) {
      target
        .prepare(
          "INSERT OR REPLACE INTO legacy_imports(source_id,fingerprint,status) VALUES(?,?,'failed')",
        )
        .run(c.id, c.fingerprint);
      errors.push({ code: "LEGACY_IMPORT_FAILED", source: c.file });
    }
    return { sources: 0, conflicts: 0, errors };
  }
}
