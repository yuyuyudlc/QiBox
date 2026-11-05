import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const KEEP = "__KEEP_SECRET__";
const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function mask(value, key = "", parent = "") {
  if (
    typeof value === "string" &&
    (["env", "headers"].includes(parent) ||
      /token|secret|password|api.?key|authorization/i.test(key) ||
      (key === "url" && /[?@]/.test(value)))
  )
    return KEEP;
  if (Array.isArray(value))
    return value.map((v, i) =>
      typeof v === "string" &&
      i > 0 &&
      (/token|secret|password|api.?key|authorization/i.test(value[i - 1]) ||
        (/^--?(?:header|H)$/i.test(value[i - 1]) &&
          /^(?:authorization|x-api-key|cookie)\s*:/i.test(v)))
        ? KEEP
        : typeof v === "string" &&
            (/^(?:--?[^=]*(?:token|secret|password|key|authorization))=/i.test(
              v,
            ) ||
              /^(?:authorization|x-api-key|cookie)\s*:/i.test(v) ||
              /^--?header[=\s].*(?:authorization|x-api-key|cookie)/i.test(v))
          ? KEEP
          : mask(v, String(i), key),
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mask(v, k, key)]),
    );
  return value;
}
function restore(value, old) {
  if (value === KEEP) {
    check(typeof old === "string", "MCP_SECRET_NOT_FOUND");
    return old;
  }
  if (Array.isArray(value)) return value.map((v, i) => restore(v, old?.[i]));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, restore(v, old?.[k])]),
    );
  return value;
}
export class McpConfig {
  constructor(home = "/home/agent") {
    this.file = path.join(home, ".isolation", "mcp.json");
  }
  raw() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return { mcpServers: {} };
      throw Error("MCP_CONFIG_INVALID");
    }
  }
  read() {
    const data = this.raw();
    return {
      config: mask(data),
      revision: hash(data),
      path: this.file,
      secretPlaceholder: KEEP,
    };
  }
  validate(data) {
    check(
      data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data.mcpServers &&
        typeof data.mcpServers === "object" &&
        !Array.isArray(data.mcpServers),
      "MCP_CONFIG_INVALID",
    );
    check(
      Object.keys(data).every((k) => k === "mcpServers") &&
        Object.keys(data.mcpServers).length <= 100,
      "MCP_CONFIG_INVALID",
    );
    for (const [name, s] of Object.entries(data.mcpServers)) {
      check(
        /^[a-zA-Z0-9_-]{1,100}$/.test(name) &&
          s &&
          typeof s === "object" &&
          !Array.isArray(s),
        "MCP_CONFIG_INVALID",
      );
      check(
        s.enabled === undefined || typeof s.enabled === "boolean",
        "MCP_CONFIG_INVALID",
      );
      check(
        ["stdio", "http", "sse"].includes(s.type || "stdio"),
        "MCP_TRANSPORT_UNSUPPORTED",
      );
      if (!s.type || s.type === "stdio")
        check(
          typeof s.command === "string" &&
            s.command.length > 0 &&
            s.command.length < 4096 &&
            !/[\x00\r\n]/.test(s.command) &&
            (!s.args ||
              (Array.isArray(s.args) &&
                s.args.every(
                  (a) => typeof a === "string" && !a.includes("\0"),
                ))) &&
            (!s.env ||
              (typeof s.env === "object" &&
                !Array.isArray(s.env) &&
                Object.entries(s.env).every(
                  ([k, v]) =>
                    /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === "string",
                ))),
          "MCP_CONFIG_INVALID",
        );
      else {
        let url;
        try {
          url = new URL(s.url);
        } catch {}
        check(
          url && ["http:", "https:"].includes(url.protocol),
          "MCP_URL_INVALID",
        );
        check(
          !s.headers ||
            (typeof s.headers === "object" &&
              !Array.isArray(s.headers) &&
              Object.values(s.headers).every((v) => typeof v === "string")),
          "MCP_CONFIG_INVALID",
        );
      }
      const allowed =
        !s.type || s.type === "stdio"
          ? ["type", "command", "args", "env", "enabled"]
          : ["type", "url", "headers", "enabled"];
      check(
        Object.keys(s).every((k) => allowed.includes(k)),
        "MCP_CONFIG_INVALID",
      );
    }
    check(
      Buffer.byteLength(JSON.stringify(data)) <= 300000,
      "MCP_CONFIG_TOO_LARGE",
    );
    return data;
  }
  write(config, revision) {
    const old = this.raw();
    check(hash(old) === revision, "MCP_CONFIG_CHANGED");
    const data = this.validate(restore(config, old));
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
    return this.read();
  }
  servers() {
    return Object.fromEntries(
      Object.entries(this.validate(this.raw()).mcpServers)
        .filter(([, s]) => s.enabled !== false)
        .map(([k, { enabled, ...s }]) => [k, s]),
    );
  }
  signature() {
    return hash(this.servers());
  }
}
