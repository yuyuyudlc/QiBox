import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const digest = (b) => createHash("sha256").update(b).digest("hex");
// Keep the base64 payload and RPC envelope below JsonRpc's 1.6 MB frame limit.
const MAX_BASE64_BYTES = 1400000;
const writes = new Map();
export class WorkspaceService {
  constructor(root = "/workspace") {
    this.root = path.resolve(root);
  }
  async resolve(value = ".", { missing = false } = {}) {
    check(
      typeof value === "string" &&
        value.length <= 4096 &&
        !/[\x00-\x1f]/.test(value),
      "INVALID_PATH",
    );
    const full = path.resolve(this.root, value);
    check(
      full === this.root || full.startsWith(this.root + path.sep),
      "PATH_OUTSIDE_WORKSPACE",
    );
    let cursor = this.root;
    for (const part of path
      .relative(this.root, full)
      .split(path.sep)
      .filter(Boolean)) {
      cursor = path.join(cursor, part);
      try {
        check(
          !(await fs.lstat(cursor)).isSymbolicLink(),
          "SYMLINK_NOT_ALLOWED",
        );
      } catch (e) {
        if (e.code === "ENOENT" && missing) break;
        throw e;
      }
    }
    return full;
  }
  async call(method, p = {}) {
    try {
      if (method === "files.capabilities")
        return {
          encodings: ["utf8", "base64"],
          maxBase64Bytes: MAX_BASE64_BYTES,
        };
      if (method === "files.list") {
        const full = await this.resolve(p.path),
          items = await fs.readdir(full, { withFileTypes: true });
        check(items.length <= 10000, "DIRECTORY_TOO_LARGE");
        return {
          path: path.relative(this.root, full) || ".",
          root: this.root,
          entries: items
            .map((v) => ({
              name: v.name,
              type: v.isSymbolicLink()
                ? "symlink"
                : v.isDirectory()
                  ? "directory"
                  : "file",
            }))
            .sort(
              (a, b) =>
                (a.type === "directory" ? 0 : 1) -
                  (b.type === "directory" ? 0 : 1) ||
                a.name.localeCompare(b.name),
            ),
        };
      }
      if (method === "files.read") {
        const full = await this.resolve(p.path),
          stat = await fs.stat(full);
        check(stat.isFile(), "NOT_A_FILE");
        check(stat.size <= 700000, "FILE_TOO_LARGE");
        const b = await fs.readFile(full);
        check(!b.includes(0), "BINARY_FILE");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(b);
        check(
          Buffer.byteLength(JSON.stringify(text)) <= 1450000,
          "FILE_TOO_LARGE",
        );
        return { path: p.path, text, revision: digest(b), bytes: b.length };
      }
      if (method === "files.write") {
        check(
          p.encoding === undefined ||
            p.encoding === "utf8" ||
            p.encoding === "base64",
          "INVALID_ENCODING",
        );
        check(
          typeof p.text === "string" &&
            Buffer.byteLength(p.text) <=
              (p.encoding === "base64" ? MAX_BASE64_BYTES : 700000) &&
            Buffer.byteLength(JSON.stringify(p.text)) <= 1450000,
          "FILE_TOO_LARGE",
        );
        if (p.encoding === "base64")
          check(
            p.text.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(p.text),
            "INVALID_BASE64",
          );
        const payload =
          p.encoding === "base64"
            ? Buffer.from(p.text, "base64")
            : Buffer.from(p.text);
        if (p.encoding === "base64")
          check(payload.toString("base64") === p.text, "INVALID_BASE64");
        const full = await this.resolve(p.path, { missing: true });
        check(full !== this.root, "INVALID_PATH");
        const previous = writes.get(full) || Promise.resolve();
        const job = previous
          .catch(() => {})
          .then(async () => {
            if (p.mkdir)
              await fs.mkdir(path.dirname(full), { recursive: true });
            let current = null,
              mode = 0o600;
            try {
              const stat = await fs.lstat(full);
              check(stat.isFile() && !stat.isSymbolicLink(), "NOT_A_FILE");
              mode = stat.mode & 0o777;
              current = digest(await fs.readFile(full));
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
            if (!p.force) check(p.revision === current, "FILE_CHANGED");
            const temporary = path.join(
              path.dirname(full),
              ".isolation-save-" + randomUUID(),
            );
            let handle;
            try {
              handle = await fs.open(
                temporary,
                fs.constants.O_WRONLY |
                  fs.constants.O_CREAT |
                  fs.constants.O_EXCL |
                  (fs.constants.O_NOFOLLOW || 0),
                mode,
              );
              for (let offset = 0; offset < payload.length;) {
                const { bytesWritten } = await handle.write(
                  payload,
                  offset,
                  payload.length - offset,
                  offset,
                );
                check(bytesWritten > 0, "FILE_WRITE_FAILED");
                offset += bytesWritten;
              }
              await handle.chmod(mode);
              await handle.sync();
              await handle.close();
              handle = null;
              await this.resolve(p.path, { missing: true });
              let latest = null;
              try {
                latest = digest(await fs.readFile(full));
              } catch (e) {
                if (e.code !== "ENOENT") throw e;
              }
              check(p.force || latest === current, "FILE_CHANGED");
              // Publishing a new file must never replace a concurrently created file.
              if (current === null) await fs.link(temporary, full);
              else await fs.rename(temporary, full);
              return { path: p.path, revision: digest(payload), saved: true };
            } finally {
              await handle?.close();
              await fs.unlink(temporary).catch((e) => {
                if (e.code !== "ENOENT") throw e;
              });
            }
          });
        writes.set(full, job);
        try {
          return await job;
        } finally {
          if (writes.get(full) === job) writes.delete(full);
        }
      }
      if (method === "files.mkdir") {
        const full = await this.resolve(p.path, { missing: true });
        check(full !== this.root, "INVALID_PATH");
        await fs.mkdir(full);
        return { created: true };
      }
      if (method === "files.rename") {
        const from = await this.resolve(p.path),
          to = await this.resolve(p.to, { missing: true });
        check(from !== this.root && to !== this.root, "INVALID_PATH");
        try {
          await fs.lstat(to);
          throw Error("DESTINATION_EXISTS");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        await fs.rename(from, to);
        return { renamed: true };
      }
      if (method === "files.remove") {
        const full = await this.resolve(p.path);
        check(full !== this.root, "INVALID_PATH");
        const stat = await fs.lstat(full);
        if (stat.isDirectory()) await fs.rmdir(full);
        else await fs.unlink(full);
        return { removed: true };
      }
      if (method.startsWith("git.")) return this.git(method, p);
      throw Error("METHOD_NOT_ALLOWED");
    } catch (e) {
      if (/^[A-Z][A-Z0-9_]+$/.test(e.message)) throw e;
      throw Error(
        {
          ENOENT: "PATH_NOT_FOUND",
          ENOTEMPTY: "DIRECTORY_NOT_EMPTY",
          EACCES: "ACCESS_DENIED",
          EISDIR: "NOT_A_FILE",
        }[e.code] || "WORKSPACE_OPERATION_FAILED",
      );
    }
  }
  async command(cwd, args) {
    return new Promise((resolve, reject) =>
      execFile(
        "git",
        ["--no-pager", ...args],
        {
          cwd,
          shell: false,
          encoding: "utf8",
          maxBuffer: 900000,
          timeout: 30000,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
          },
        },
        (e, stdout, stderr) => {
          if (e)
            reject(
              Error(
                /not a git repository/.test(stderr)
                  ? "NOT_A_GIT_REPOSITORY"
                  : /Please tell me who you are|unable to auto-detect email/.test(
                        stderr,
                      )
                    ? "GIT_IDENTITY_REQUIRED"
                    : /nothing to commit/.test(stdout)
                      ? "NOTHING_TO_COMMIT"
                      : "GIT_OPERATION_FAILED",
              ),
            );
          else resolve(stdout);
        },
      ),
    );
  }
  async git(method, p) {
    let cwd = await this.resolve(p.path);
    check((await fs.stat(cwd)).isDirectory(), "NOT_A_DIRECTORY");
    if (method === "git.init") {
      await this.command(cwd, ["init"]);
      return { initialized: true };
    }
    const root = (
      await this.command(cwd, ["rev-parse", "--show-toplevel"])
    ).trim();
    cwd = await this.resolve(root);
    if (method === "git.status") {
      const text = await this.command(cwd, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=normal",
        ]),
        parts = text.split("\0"),
        entries = [];
      for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        const item = { status: parts[i].slice(0, 2), path: parts[i].slice(3) };
        if (/[RC]/.test(item.status)) item.from = parts[++i];
        entries.push(item);
      }
      const branch = (
        await this.command(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(
          () => "(尚无提交)",
        )
      ).trim();
      return { root: path.relative(this.root, cwd) || ".", branch, entries };
    }
    if (method === "git.diff") {
      const args = [
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        ...(p.staged ? ["--cached"] : []),
        "--",
      ];
      if (p.file) {
        check(
          typeof p.file === "string" &&
            p.file.length > 0 &&
            !path.isAbsolute(p.file),
          "INVALID_PATH",
        );
        const full = path.resolve(cwd, p.file);
        check(full.startsWith(cwd + path.sep), "PATH_OUTSIDE_REPOSITORY");
        await this.resolve(full, { missing: true });
        args.push(path.relative(cwd, full).split(path.sep).join("/"));
      }
      return { text: await this.command(cwd, args) };
    }
    if (method === "git.log") {
      const text = await this.command(cwd, [
        "log",
        "-30",
        "--format=%h%x00%s%x00%an%x00%aI",
      ]).catch((e) => {
        if (e.message === "GIT_OPERATION_FAILED") return "";
        throw e;
      });
      return {
        commits: text
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((v) => {
            const [id, subject, author, time] = v.split("\0");
            return { id, subject, author, time };
          }),
      };
    }
    if (method === "git.stage" || method === "git.unstage") {
      check(
        Array.isArray(p.files) && p.files.length > 0 && p.files.length <= 1000,
        "INVALID_PATHS",
      );
      const names = [];
      for (const name of p.files) {
        check(
          typeof name === "string" &&
            name.length > 0 &&
            !path.isAbsolute(name),
          "INVALID_PATH",
        );
        const full = path.resolve(cwd, name);
        check(full.startsWith(cwd + path.sep), "PATH_OUTSIDE_REPOSITORY");
        await this.resolve(full, { missing: true });
        names.push(path.relative(cwd, full).split(path.sep).join("/"));
      }
      if (method === "git.stage") {
        await this.command(cwd, ["--literal-pathspecs", "add", "--", ...names]);
      } else {
        // Omit the explicit HEAD: Git natively resets to the empty tree on an
        // unborn branch. Permission/ref/index failures propagate with no fallback.
        await this.command(cwd, ["--literal-pathspecs", "reset", "-q", "--", ...names]);
      }
      return { updated: true };
    }
    if (method === "git.commit") {
      check(
        typeof p.message === "string" &&
          p.message.trim() &&
          p.message.length <= 20000,
        "INVALID_COMMIT_MESSAGE",
      );
      const config = [];
      if (p.author) {
        check(
          typeof p.author.name === "string" &&
            typeof p.author.email === "string" &&
            p.author.name.length < 200 &&
            p.author.email.length < 200 &&
            !/[\r\n]/.test(p.author.name + p.author.email),
          "INVALID_AUTHOR",
        );
        config.push(
          "-c",
          "user.name=" + p.author.name,
          "-c",
          "user.email=" + p.author.email,
        );
      }
      return {
        text: await this.command(cwd, [...config, "commit", "-m", p.message]),
      };
    }
    if (method === "git.branches")
      return {
        text: await this.command(cwd, ["branch", "--list", "--no-color"]),
      };
    if (method === "git.remotes") {
      const names = (await this.command(cwd, ["remote"]))
        .trim()
        .split("\n")
        .filter(Boolean);
      const remotes = [];
      for (const name of names) {
        const url = (
          await this.command(cwd, ["remote", "get-url", name])
        ).trim();
        remotes.push({
          name,
          url: url
            .replace(/(https?:\/\/)[^/@]+@/g, "$1[REDACTED]@")
            .replace(/\?.*$/, "?[REDACTED]"),
        });
      }
      return { remotes };
    }
    if (["git.fetch", "git.pull", "git.push"].includes(method)) {
      check(
        typeof p.remote === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(p.remote),
        "INVALID_REMOTE",
      );
      const names = (await this.command(cwd, ["remote"])).trim().split("\n");
      check(names.includes(p.remote), "REMOTE_NOT_FOUND");
      return {
        text: await this.command(cwd, [
          method.slice(4),
          ...(method === "git.pull" ? ["--ff-only"] : []),
          p.remote,
        ]),
      };
    }
    if (method === "git.checkout") {
      check(
        typeof p.branch === "string" &&
          /^[a-zA-Z0-9][a-zA-Z0-9._/\-]{0,199}$/.test(p.branch),
        "INVALID_BRANCH",
      );
      await this.command(cwd, [
        "switch",
        ...(p.create ? ["-c"] : []),
        p.branch,
      ]);
      return { switched: true };
    }
    throw Error("METHOD_NOT_ALLOWED");
  }
}
