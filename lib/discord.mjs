import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion() {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg?.version) return String(pkg.version);
    }
  } catch {
    // ignore
  }
  return "1.1.0";
}

export const APP_VERSION = readPackageVersion();
export const USER_AGENT = `DiscordBot (https://github.com/Tolkium/t3-discord, ${APP_VERSION})`;

// Minimal permissions: View Channels, Send Messages, Embed Links, Attach Files,
// Read Message History, Create Public Threads, Send Messages in Threads
export const INVITE_PERMISSIONS = (
  1024n |
  2048n |
  16384n |
  32768n |
  65536n |
  (1n << 35n) |
  (1n << 38n)
).toString();

export function getConfigDir() {
  return (
    process.env.T3_DISCORD_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "t3-discord")
  );
}

export function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}

export function getTokenPath() {
  return path.join(getConfigDir(), "token.txt");
}

export const CONFIG_DIR = getConfigDir();
export const CONFIG_PATH = getConfigPath();
export const TOKEN_PATH = getTokenPath();

const API_BASE = "https://discord.com/api/v10";
const MAX_MESSAGE_LEN = 2000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB default unboosted limit
const MAX_ATTACHMENTS = 10;
const AUTO_ATTACH_CHUNK_THRESHOLD = 3;

const GENERIC_USERNAMES = new Set([
  "admin",
  "administrator",
  "user",
  "owner",
  "root",
  "default",
  "pc",
  "desktop",
  "laptop",
]);

const EXT_LANG_MAP = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".py": "py",
  ".rb": "rb",
  ".rs": "rs",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".php": "php",
  ".swift": "swift",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".ps1": "powershell",
  ".cmd": "bat",
  ".bat": "bat",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sql": "sql",
  ".md": "markdown",
  ".dockerfile": "dockerfile",
  ".vue": "vue",
  ".svelte": "svelte",
};

let cachedGitUserName;

export const CHANNEL_TYPE_NAMES = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  10: "announcement_thread",
  11: "public_thread",
  12: "private_thread",
  13: "stage",
  15: "forum",
  16: "media",
};

const MESSAGEABLE_CHANNEL_TYPES = new Set([0, 2, 5, 10, 11, 12, 13]);
const LISTABLE_CHANNEL_TYPES = new Set([0, 2, 5, 13, 15, 16]);
const FORUM_CHANNEL_TYPES = new Set([15, 16]);
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

export function buildInviteUrl(botId) {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
    String(botId)
  )}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
}

export function ensureConfigDir() {
  fs.mkdirSync(getConfigDir(), { recursive: true });
}

function emptyConfig() {
  return {
    defaultGuildId: "",
    defaultGuildName: "",
    defaultChannelId: "",
    defaultChannelName: "",
    defaultThreadId: "",
    defaultThreadName: "",
    senderName: "",
    includeSender: true,
    includeMachine: false,
    aliases: {},
  };
}

export function loadConfig() {
  ensureConfigDir();
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) {
    return emptyConfig();
  }
  const raw = fs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!raw) {
    return emptyConfig();
  }
  const parsed = JSON.parse(raw);
  return {
    defaultGuildId: parsed.defaultGuildId || "",
    defaultGuildName: parsed.defaultGuildName || "",
    defaultChannelId: parsed.defaultChannelId || "",
    defaultChannelName: parsed.defaultChannelName || "",
    defaultThreadId: parsed.defaultThreadId || "",
    defaultThreadName: parsed.defaultThreadName || "",
    senderName: parsed.senderName || "",
    includeSender:
      parsed.includeSender !== undefined ? Boolean(parsed.includeSender) : true,
    includeMachine: Boolean(parsed.includeMachine),
    aliases:
      parsed.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)
        ? parsed.aliases
        : {},
  };
}

export function saveConfig(config) {
  ensureConfigDir();
  const cfgPath = getConfigPath();
  const tmpPath = `${cfgPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, cfgPath);
}

function getGitUserName() {
  if (cachedGitUserName !== undefined) return cachedGitUserName;
  try {
    const out = execFileSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
    cachedGitUserName = out || "";
  } catch {
    cachedGitUserName = "";
  }
  return cachedGitUserName;
}

export function resolveSender(config = loadConfig(), overrideName = "") {
  const host = os.hostname() || "";
  const explicit = String(overrideName || "").trim();
  if (explicit) {
    return { name: explicit, source: "override", host };
  }

  const fromEnv = process.env.T3_DISCORD_SENDER?.trim();
  if (fromEnv) {
    return { name: fromEnv, source: "env", host };
  }

  if (config.senderName && config.senderName.trim()) {
    return { name: config.senderName.trim(), source: "config", host };
  }

  const gitName = getGitUserName();
  if (gitName) {
    return { name: gitName, source: "git", host };
  }

  let osUser = "";
  try {
    osUser = os.userInfo().username || "";
  } catch {
    osUser = process.env.USERNAME || process.env.USER || "";
  }
  if (osUser && !GENERIC_USERNAMES.has(osUser.toLowerCase())) {
    return { name: osUser, source: "os-user", host };
  }

  if (host) {
    return { name: host, source: "hostname", host };
  }

  return { name: osUser || "Unknown", source: "fallback", host };
}

export function formatSenderLabel(
  { from, includeSender, includeMachine } = {},
  config = loadConfig()
) {
  const shouldInclude =
    includeSender !== undefined ? Boolean(includeSender) : config.includeSender;
  if (!shouldInclude) return "";

  const sender = resolveSender(config, from);
  if (!sender.name) return "";

  const showMachine =
    includeMachine !== undefined ? Boolean(includeMachine) : config.includeMachine;
  return showMachine &&
    sender.host &&
    sender.host.toLowerCase() !== sender.name.toLowerCase()
    ? `**${sender.name}** (\`${sender.host}\`)`
    : `**${sender.name}**`;
}

export function formatWithSender(
  content,
  { from, includeSender, includeMachine } = {},
  config = loadConfig()
) {
  const text = String(content ?? "");
  const label = formatSenderLabel({ from, includeSender, includeMachine }, config);
  if (!label) return text;
  if (!text.trim()) return `${label}:`;
  if (text.startsWith(`${label}:`)) return text;

  const isMultilineOrCode =
    text.includes("\n") || text.trimStart().startsWith("```");
  return isMultilineOrCode ? `${label}:\n${text}` : `${label}: ${text}`;
}

export function setSender({
  name,
  clearName = false,
  includeSender,
  includeMachine,
} = {}) {
  const config = loadConfig();
  if (clearName) {
    config.senderName = "";
  } else if (name !== undefined) {
    config.senderName = String(name).trim();
  }
  if (includeSender !== undefined) {
    config.includeSender = Boolean(includeSender);
  }
  if (includeMachine !== undefined) {
    config.includeMachine = Boolean(includeMachine);
  }
  saveConfig(config);
  const resolved = resolveSender(config);
  return {
    senderName: config.senderName,
    effectiveSender: resolved.name,
    source: resolved.source,
    host: resolved.host,
    includeSender: config.includeSender,
    includeMachine: config.includeMachine,
  };
}

export function cleanToken(rawToken) {
  return String(rawToken || "")
    .trim()
    .replace(/^Bot\s+/i, "");
}

export function hasToken() {
  if (process.env.T3_DISCORD_TOKEN?.trim()) return true;
  if (process.env.DISCORD_BOT_TOKEN?.trim()) return true;
  const tokPath = getTokenPath();
  if (fs.existsSync(tokPath)) {
    return fs.readFileSync(tokPath, "utf8").trim().length > 0;
  }
  return false;
}

export function getToken() {
  const fromT3Env = process.env.T3_DISCORD_TOKEN?.trim();
  if (fromT3Env) return cleanToken(fromT3Env);
  const fromEnv = process.env.DISCORD_BOT_TOKEN?.trim();
  if (fromEnv) return cleanToken(fromEnv);
  const tokPath = getTokenPath();
  if (fs.existsSync(tokPath)) {
    const fromFile = fs.readFileSync(tokPath, "utf8").trim();
    if (fromFile) return cleanToken(fromFile);
  }
  throw new Error(
    `Discord bot token is not configured. Save your bot token to ${tokPath} (or set T3_DISCORD_TOKEN).`
  );
}

export function lockDownTokenFile(tokPath = getTokenPath()) {
  if (!fs.existsSync(tokPath)) return { ok: false, warning: "Token file not found." };
  try {
    if (process.platform === "win32") {
      const user = process.env.USERNAME || os.userInfo().username;
      execFileSync(
        "icacls",
        [tokPath, "/inheritance:r", "/grant:r", `${user}:(R,W)`],
        { stdio: "ignore" }
      );
    } else {
      fs.chmodSync(tokPath, 0o600);
    }
    return { ok: true, warning: null };
  } catch (err) {
    return {
      ok: false,
      warning: `Could not tighten permissions on ${tokPath}: ${err.message}`,
    };
  }
}

export function saveToken(rawToken) {
  const token = cleanToken(rawToken);
  if (!token) {
    throw new Error("Bot token cannot be empty.");
  }
  ensureConfigDir();
  const tokPath = getTokenPath();
  const tmpPath = `${tokPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, token + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, tokPath);
  const acl = lockDownTokenFile(tokPath);
  return { tokenPath: tokPath, permissionWarning: acl.warning };
}

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,22}$/.test(value.trim());
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
}

function isPathInsideDir(targetPath, parentDir) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedParent = path.resolve(parentDir);
  const rel = path.relative(resolvedParent, resolvedTarget);
  return (
    rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  );
}

function assertSafeLocalFile(filePath, { checkSize = true } = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("File path must be a non-empty string.");
  }
  if (!path.isAbsolute(filePath)) {
    throw new Error(`File path must be absolute: ${filePath}`);
  }
  const resolved = path.resolve(filePath);
  if (
    resolved === path.resolve(getTokenPath()) ||
    isPathInsideDir(resolved, getConfigDir())
  ) {
    throw new Error(
      `Refusing to read or attach file inside t3-discord config directory: ${resolved}`
    );
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${resolved}`);
  }
  if (checkSize && stat.size > MAX_ATTACHMENT_BYTES) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File "${path.basename(resolved)}" (${mb} MiB) exceeds Discord's 10 MiB upload limit.`
    );
  }
  return resolved;
}

export async function discordRequest(method, endpoint, options = {}) {
  const {
    body,
    query,
    formData,
    retryCount = 0,
    tokenOverride,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;
  const token = tokenOverride ? cleanToken(tokenOverride) : getToken();

  let url = `${API_BASE}${endpoint}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };

  let fetchBody;
  if (formData) {
    fetchBody = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(
        `Discord API request timed out after ${Math.round(timeoutMs / 1000)}s (${method} ${endpoint}).`
      );
    }
    throw err;
  }

  // Always read the response body ONCE to avoid "Body is unusable" on 429 fallback
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (res.status === 429 && retryCount < 2) {
    let retryAfterSec = 1;
    if (typeof data?.retry_after === "number" && Number.isFinite(data.retry_after)) {
      retryAfterSec = data.retry_after;
    } else {
      const hdr = Number(res.headers.get("retry-after"));
      if (Number.isFinite(hdr) && hdr > 0) retryAfterSec = hdr;
    }
    if (retryAfterSec <= 5) {
      await new Promise((r) => setTimeout(r, Math.ceil(retryAfterSec * 1000) + 50));
      return discordRequest(method, endpoint, {
        ...options,
        retryCount: retryCount + 1,
      });
    }
  }

  if (!res.ok) {
    const apiMsg = data?.message || res.statusText || "Request failed";
    const apiCode = data?.code ? ` (Discord code ${data.code})` : "";
    let hint = "";
    if (res.status === 401) {
      hint =
        " — check that your Discord Bot Token (from Developer Portal → Bot → Reset Token, ~70 chars with 2 dots) is valid and not revoked.";
    } else if (res.status === 403) {
      hint =
        " — the bot lacks permission in that server/channel/thread (ensure View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files, and Read Message History are granted).";
    } else if (res.status === 404) {
      hint =
        " — the server, channel, or thread was not found or the bot does not have access to it.";
    }
    const err = new Error(`Discord API ${res.status}${apiCode}: ${apiMsg}${hint}`);
    err.status = res.status;
    err.code = data?.code;
    err.details = data;
    throw err;
  }

  return data;
}

export async function verifyBot(tokenOverride) {
  const me = await discordRequest("GET", "/users/@me", { tokenOverride });
  return {
    id: me.id,
    username: me.username,
    globalName: me.global_name || null,
    discriminator: me.discriminator || "0",
    bot: Boolean(me.bot),
    inviteUrl: buildInviteUrl(me.id),
  };
}

export async function verifyAndSaveToken(rawToken) {
  const candidate = cleanToken(rawToken);
  if (!candidate) {
    throw new Error("Bot token cannot be empty.");
  }
  const bot = await verifyBot(candidate);
  const guilds = await listGuilds(candidate);
  const saved = saveToken(candidate);
  return {
    ok: true,
    tokenPath: saved.tokenPath,
    permissionWarning: saved.permissionWarning,
    bot,
    guilds,
    inviteUrl: bot.inviteUrl,
  };
}

export async function listGuilds(tokenOverride) {
  const guilds = await discordRequest("GET", "/users/@me/guilds", { tokenOverride });
  return guilds.map((g) => ({
    id: g.id,
    name: g.name,
    owner: Boolean(g.owner),
  }));
}

async function lookupGuildName(guildId, fallback = "") {
  if (!guildId) return fallback;
  try {
    const guilds = await listGuilds();
    const found = guilds.find((g) => g.id === guildId);
    if (found) return found.name;
  } catch {
    // ignore
  }
  return fallback;
}

export async function getChannel(channelId) {
  return discordRequest("GET", `/channels/${channelId}`);
}

export async function listChannels(guildId) {
  const channels = await discordRequest("GET", `/guilds/${guildId}/channels`);
  const categories = new Map();
  for (const ch of channels) {
    if (ch.type === 4) {
      categories.set(ch.id, ch.name);
    }
  }
  return channels
    .filter((ch) => LISTABLE_CHANNEL_TYPES.has(ch.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: CHANNEL_TYPE_NAMES[ch.type] || String(ch.type),
      typeId: ch.type,
      category: ch.parent_id ? categories.get(ch.parent_id) || null : null,
      topic: ch.topic || null,
    }));
}

export async function listThreads({
  guildId,
  channelId,
  includeArchived = false,
} = {}) {
  const seen = new Map();

  if (guildId) {
    const active = await discordRequest("GET", `/guilds/${guildId}/threads/active`);
    for (const t of active?.threads || []) {
      if (channelId && t.parent_id !== channelId) continue;
      seen.set(t.id, t);
    }
  }

  if (includeArchived) {
    if (!channelId) {
      throw new Error(
        "Listing archived threads requires a channel (specify --channel / channel, or set a default channel)."
      );
    }
    try {
      const pub = await discordRequest(
        "GET",
        `/channels/${channelId}/threads/archived/public`,
        { query: { limit: 50 } }
      );
      for (const t of pub?.threads || []) {
        if (!seen.has(t.id)) seen.set(t.id, t);
      }
    } catch (err) {
      if (err.status !== 403 && err.status !== 400) throw err;
    }

    try {
      const priv = await discordRequest(
        "GET",
        `/channels/${channelId}/threads/archived/private`,
        { query: { limit: 50 } }
      );
      for (const t of priv?.threads || []) {
        if (!seen.has(t.id)) seen.set(t.id, t);
      }
    } catch (err) {
      if (err.status !== 403 && err.status !== 400) throw err;
    }
  }

  let channelNameMap = new Map();
  if (guildId) {
    try {
      const chs = await listChannels(guildId);
      channelNameMap = new Map(chs.map((c) => [c.id, c.name]));
    } catch {
      // ignore
    }
  }

  return Array.from(seen.values()).map((t) => ({
    id: t.id,
    name: t.name,
    parentId: t.parent_id || null,
    parentName: t.parent_id ? channelNameMap.get(t.parent_id) || null : null,
    type: CHANNEL_TYPE_NAMES[t.type] || String(t.type),
    archived: Boolean(t.thread_metadata?.archived),
    locked: Boolean(t.thread_metadata?.locked),
  }));
}

function matchByNameOrId(items, query, kindLabel) {
  const q = String(query || "").trim();
  if (!q) return null;

  if (isSnowflake(q)) {
    const byId = items.find((item) => item.id === q);
    if (byId) return byId;
    return { id: q, name: q, _rawId: true };
  }

  const norm = normalizeName(q);

  const exact = items.filter((item) => normalizeName(item.name) === norm);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const textPreferred = exact.filter(
      (i) => i.typeId === 0 || i.typeId === 5 || i.typeId === 15 || i.typeId === 16
    );
    if (textPreferred.length === 1) return textPreferred[0];
    const names = exact
      .map((i) => `${i.name} [${i.type || "unknown"}] (${i.id})`)
      .join(", ");
    throw new Error(
      `Multiple ${kindLabel}s match "${query}": ${names}. Please specify an ID or narrow by channel/server.`
    );
  }

  const prefix = items.filter((item) => normalizeName(item.name).startsWith(norm));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    const textPrefix = prefix.filter(
      (i) => i.typeId === 0 || i.typeId === 5 || i.typeId === 15 || i.typeId === 16
    );
    if (textPrefix.length === 1) return textPrefix[0];
    const names = prefix
      .slice(0, 8)
      .map((i) => `${i.name} (${i.id})`)
      .join(", ");
    throw new Error(`Ambiguous ${kindLabel} "${query}". Matches: ${names}.`);
  }

  // Substring matches are suggested rather than silently selected to avoid posting to the wrong channel
  const partial = items.filter((item) => normalizeName(item.name).includes(norm));
  if (partial.length > 0) {
    const suggestions = partial
      .slice(0, 6)
      .map((i) => `${i.name} (${i.id})`)
      .join(", ");
    throw new Error(
      `Could not find exact ${kindLabel} "${query}". Did you mean: ${suggestions}?`
    );
  }

  const available = items
    .slice(0, 12)
    .map((i) => i.name)
    .join(", ");
  throw new Error(
    `Could not find ${kindLabel} "${query}".${available ? ` Available: ${available}` : ""}`
  );
}

export async function resolveGuild(serverQuery, config = loadConfig()) {
  const guilds = await listGuilds();
  if (guilds.length === 0) {
    throw new Error(
      "The Discord bot is not a member of any server yet. Invite the bot to your private server first."
    );
  }

  if (serverQuery) {
    const matched = matchByNameOrId(guilds, serverQuery, "server");
    if (matched._rawId) {
      throw new Error(
        `Bot is not a member of server ID "${serverQuery}". Accessible servers: ${guilds
          .map((g) => `${g.name} (${g.id})`)
          .join(", ")}.`
      );
    }
    return matched;
  }

  if (config.defaultGuildId) {
    const found = guilds.find((g) => g.id === config.defaultGuildId);
    if (found) return found;
    return {
      id: config.defaultGuildId,
      name: config.defaultGuildName || config.defaultGuildId,
    };
  }

  if (guilds.length === 1) {
    return guilds[0];
  }

  const list = guilds.map((g) => `${g.name} (${g.id})`).join(", ");
  throw new Error(
    `Bot is in multiple servers (${list}). Specify a server or set a default server first.`
  );
}

export async function resolveTarget(opts = {}) {
  const config = loadConfig();
  let { alias, server, channel, thread, channelId, threadId } = opts;

  if (alias) {
    if (server || channel || channelId) {
      throw new Error(
        "Cannot combine --alias with --server or --channel. Use either --alias (optionally with --thread) or explicit --server/--channel."
      );
    }
    const aliasKey = Object.keys(config.aliases).find(
      (k) => k.toLowerCase() === String(alias).trim().toLowerCase()
    );
    if (!aliasKey) {
      const known = Object.keys(config.aliases);
      throw new Error(
        `Unknown alias "${alias}".${
          known.length
            ? ` Configured aliases: ${known.join(", ")}`
            : " No aliases configured yet."
        }`
      );
    }
    const entry = config.aliases[aliasKey];
    server = entry.guildId || "";
    channelId = entry.channelId || "";
    if (!thread && !threadId) {
      threadId = entry.threadId || "";
    }
  }

  // Validate explicit server constraint if provided alongside explicit IDs
  let expectedGuild = null;
  if (server && (threadId || channelId)) {
    expectedGuild = await resolveGuild(server, config);
  }

  // Explicit threadId
  if (threadId && isSnowflake(threadId)) {
    const ch = await getChannel(threadId);
    if (!THREAD_CHANNEL_TYPES.has(ch.type)) {
      throw new Error(
        `ID ${threadId} is a ${CHANNEL_TYPE_NAMES[ch.type] || ch.type} channel, not a thread.`
      );
    }
    if (expectedGuild && ch.guild_id && ch.guild_id !== expectedGuild.id) {
      throw new Error(
        `Thread ${threadId} belongs to a different server (${ch.guild_id}), not "${expectedGuild.name}" (${expectedGuild.id}).`
      );
    }
    if (channelId && isSnowflake(channelId) && ch.parent_id && ch.parent_id !== channelId) {
      throw new Error(
        `Thread ${threadId} belongs to channel ${ch.parent_id}, not ${channelId}.`
      );
    }
    const guildId = ch.guild_id || expectedGuild?.id || "";
    const guildName =
      expectedGuild?.name ||
      (guildId === config.defaultGuildId
        ? config.defaultGuildName
        : await lookupGuildName(guildId));
    return {
      guildId,
      guildName,
      channelId: ch.parent_id || channelId || ch.id,
      channelName: "",
      threadId: ch.id,
      threadName: ch.name || "",
      targetId: ch.id,
      targetType: CHANNEL_TYPE_NAMES[ch.type] || String(ch.type),
      targetTypeId: ch.type,
      archived: Boolean(ch.thread_metadata?.archived),
    };
  }

  // Explicit channelId (without thread override)
  if (channelId && isSnowflake(channelId) && !thread) {
    const ch = await getChannel(channelId);
    if (expectedGuild && ch.guild_id && ch.guild_id !== expectedGuild.id) {
      throw new Error(
        `Channel ${channelId} belongs to a different server (${ch.guild_id}), not "${expectedGuild.name}" (${expectedGuild.id}).`
      );
    }
    const guildId = ch.guild_id || expectedGuild?.id || "";
    const guildName =
      expectedGuild?.name ||
      (guildId === config.defaultGuildId
        ? config.defaultGuildName
        : await lookupGuildName(guildId));
    return {
      guildId,
      guildName,
      channelId: ch.id,
      channelName: ch.name || "",
      threadId: "",
      threadName: "",
      targetId: ch.id,
      targetType: CHANNEL_TYPE_NAMES[ch.type] || String(ch.type),
      targetTypeId: ch.type,
      archived: Boolean(ch.thread_metadata?.archived),
    };
  }

  // Default target when nothing is specified
  if (!server && !channel && !thread && !channelId && !threadId) {
    if (config.defaultThreadId) {
      try {
        const ch = await getChannel(config.defaultThreadId);
        return {
          guildId: ch.guild_id || config.defaultGuildId || "",
          guildName: config.defaultGuildName || "",
          channelId: ch.parent_id || config.defaultChannelId || "",
          channelName: config.defaultChannelName || "",
          threadId: ch.id,
          threadName: ch.name || config.defaultThreadName || "",
          targetId: ch.id,
          targetType: CHANNEL_TYPE_NAMES[ch.type] || String(ch.type),
          targetTypeId: ch.type,
          archived: Boolean(ch.thread_metadata?.archived),
        };
      } catch (err) {
        if (err.status === 404) {
          throw new Error(
            `Configured default thread "${config.defaultThreadName || config.defaultThreadId}" no longer exists (404). Update your default with set-default.`
          );
        }
        throw err;
      }
    }
    if (config.defaultChannelId) {
      const ch = await getChannel(config.defaultChannelId);
      return {
        guildId: ch.guild_id || config.defaultGuildId || "",
        guildName: config.defaultGuildName || "",
        channelId: ch.id,
        channelName: ch.name || config.defaultChannelName || "",
        threadId: "",
        threadName: "",
        targetId: ch.id,
        targetType: CHANNEL_TYPE_NAMES[ch.type] || String(ch.type),
        targetTypeId: ch.type,
        archived: false,
      };
    }
    throw new Error(
      "No destination specified and no default channel/thread is configured yet. Specify a channel/thread or set a default first."
    );
  }

  const guild = await resolveGuild(server, config);
  let resolvedChannel = null;

  if (channelId && isSnowflake(channelId)) {
    const raw = await getChannel(channelId);
    if (raw.guild_id && raw.guild_id !== guild.id) {
      throw new Error(
        `Channel ${channelId} does not belong to server "${guild.name}" (${guild.id}).`
      );
    }
    resolvedChannel = {
      id: raw.id,
      name: raw.name,
      type: CHANNEL_TYPE_NAMES[raw.type] || String(raw.type),
      typeId: raw.type,
    };
  } else if (channel) {
    const channels = await listChannels(guild.id);
    resolvedChannel = matchByNameOrId(channels, channel, "channel");
    if (resolvedChannel._rawId) {
      const raw = await getChannel(resolvedChannel.id);
      if (raw.guild_id && raw.guild_id !== guild.id) {
        throw new Error(
          `Channel ${raw.id} does not belong to server "${guild.name}" (${guild.id}).`
        );
      }
      resolvedChannel = {
        id: raw.id,
        name: raw.name,
        type: CHANNEL_TYPE_NAMES[raw.type] || String(raw.type),
        typeId: raw.type,
      };
    }
  } else if (
    config.defaultChannelId &&
    !thread &&
    (!config.defaultGuildId || config.defaultGuildId === guild.id)
  ) {
    // Only reuse default channel when it belongs to the resolved guild!
    const raw = await getChannel(config.defaultChannelId);
    if (!raw.guild_id || raw.guild_id === guild.id) {
      resolvedChannel = {
        id: raw.id,
        name: raw.name,
        type: CHANNEL_TYPE_NAMES[raw.type] || String(raw.type),
        typeId: raw.type,
      };
    }
  }

  if (thread) {
    if (isSnowflake(thread)) {
      const raw = await getChannel(thread);
      if (!THREAD_CHANNEL_TYPES.has(raw.type)) {
        throw new Error(
          `ID ${thread} is a ${CHANNEL_TYPE_NAMES[raw.type] || raw.type} channel, not a thread.`
        );
      }
      if (raw.guild_id && raw.guild_id !== guild.id) {
        throw new Error(
          `Thread ${thread} does not belong to server "${guild.name}" (${guild.id}).`
        );
      }
      if (resolvedChannel && raw.parent_id && raw.parent_id !== resolvedChannel.id) {
        throw new Error(
          `Thread ${thread} does not belong to channel "#${resolvedChannel.name}" (${resolvedChannel.id}).`
        );
      }
      return {
        guildId: raw.guild_id || guild.id,
        guildName: guild.name,
        channelId: raw.parent_id || resolvedChannel?.id || "",
        channelName: resolvedChannel?.name || "",
        threadId: raw.id,
        threadName: raw.name || "",
        targetId: raw.id,
        targetType: CHANNEL_TYPE_NAMES[raw.type] || String(raw.type),
        targetTypeId: raw.type,
        archived: Boolean(raw.thread_metadata?.archived),
      };
    }

    let threads = await listThreads({
      guildId: guild.id,
      channelId: resolvedChannel?.id,
      includeArchived: false,
    });

    let matchedThread = null;
    try {
      matchedThread = matchByNameOrId(threads, thread, "thread");
    } catch (activeErr) {
      const searchChannelId =
        resolvedChannel?.id ||
        (config.defaultGuildId === guild.id ? config.defaultChannelId : "");
      if (searchChannelId) {
        threads = await listThreads({
          guildId: guild.id,
          channelId: searchChannelId,
          includeArchived: true,
        });
        matchedThread = matchByNameOrId(threads, thread, "thread");
      } else {
        throw activeErr;
      }
    }

    return {
      guildId: guild.id,
      guildName: guild.name,
      channelId: matchedThread.parentId || resolvedChannel?.id || "",
      channelName: matchedThread.parentName || resolvedChannel?.name || "",
      threadId: matchedThread.id,
      threadName: matchedThread.name,
      targetId: matchedThread.id,
      targetType: matchedThread.type,
      targetTypeId: 11,
      archived: Boolean(matchedThread.archived),
    };
  }

  if (!resolvedChannel) {
    throw new Error(
      `Server "${guild.name}" selected, but no channel or thread was specified (and your default channel belongs to a different server or is unset). Specify --channel.`
    );
  }

  return {
    guildId: guild.id,
    guildName: guild.name,
    channelId: resolvedChannel.id,
    channelName: resolvedChannel.name,
    threadId: "",
    threadName: "",
    targetId: resolvedChannel.id,
    targetType: resolvedChannel.type,
    targetTypeId: resolvedChannel.typeId,
    archived: false,
  };
}

/**
 * Splits a single string into pieces <= maxLen code units without splitting UTF-16 surrogate pairs.
 */
function sliceSafeCodeUnits(str, maxLen) {
  const pieces = [];
  let i = 0;
  while (i < str.length) {
    let end = Math.min(i + maxLen, str.length);
    if (end < str.length) {
      const code = str.charCodeAt(end - 1);
      // Avoid cutting between a high surrogate (0xD800-0xDBFF) and its low surrogate
      if (code >= 0xd800 && code <= 0xdbff && end - 1 > i) {
        end -= 1;
      }
    }
    if (end === i) end = Math.min(i + 2, str.length);
    pieces.push(str.slice(i, end));
    i = end;
  }
  return pieces;
}

/**
 * Matches standalone fenced code delimiters (e.g. ```ts, ````md, ```) while ignoring inline ```code```.
 */
function parseFenceLine(line) {
  const trimmed = line.trim();
  const match = /^(`{3,})([^`]*)$/.exec(trimmed);
  if (!match) return null;
  const ticks = match[1];
  const info = match[2].trim();
  return { ticks, info, full: `${ticks}${info}` };
}

/**
 * Splits long text into <= maxLen chunks while preserving fenced code blocks and never exceeding maxLen.
 */
export function splitDiscordMessage(content, maxLen = MAX_MESSAGE_LEN) {
  const text = String(content ?? "");
  if (text.length <= maxLen) return [text];

  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  let openFence = null; // { ticks: "```", full: "```ts" }

  function closeStr(fence) {
    return fence ? `\n${fence.ticks}` : "";
  }

  function flushCurrent() {
    if (!current) return;
    if (openFence) {
      // Avoid pushing a useless empty code block
      if (current === openFence.full) {
        current = "";
        return;
      }
      chunks.push(current + closeStr(openFence));
      current = openFence.full;
    } else {
      chunks.push(current);
      current = "";
    }
  }

  for (const line of lines) {
    const parsedFence = parseFenceLine(line);
    const isOpening =
      openFence === null && parsedFence !== null;
    const isClosing =
      openFence !== null &&
      parsedFence !== null &&
      parsedFence.info === "" &&
      parsedFence.ticks.length >= openFence.ticks.length;

    const nextOpenFence = isOpening ? parsedFence : isClosing ? null : openFence;
    const reserveAfter = nextOpenFence ? closeStr(nextOpenFence).length : 0;

    // Check if adding this line fits in the current chunk along with any needed closing fence
    const sep = current ? "\n" : "";
    if (current.length + sep.length + line.length + reserveAfter <= maxLen) {
      current = current ? current + "\n" + line : line;
      openFence = nextOpenFence;
      continue;
    }

    // Doesn't fit in current chunk: flush what we have first
    if (current) {
      if (isClosing && current === openFence.full) {
        // Empty code block closing right away
        current = "";
        openFence = null;
        continue;
      }
      flushCurrent();
    }

    // Check if it fits now (possibly after reopening openFence)
    const sep2 = current ? "\n" : "";
    if (current.length + sep2.length + line.length + reserveAfter <= maxLen) {
      current = current ? current + "\n" + line : line;
      openFence = nextOpenFence;
      continue;
    }

    // Single line is too long for one chunk: hard-split safely on code unit boundaries
    const prefixLen = current ? current.length + 1 : 0;
    const budget = Math.max(1, maxLen - prefixLen - reserveAfter);
    const slices = sliceSafeCodeUnits(line, budget);
    for (let s = 0; s < slices.length; s++) {
      const part = slices[s];
      const partSep = current ? "\n" : "";
      if (current.length + partSep.length + part.length + reserveAfter > maxLen) {
        flushCurrent();
      }
      current = current ? current + "\n" + part : part;
      if (s < slices.length - 1) {
        flushCurrent();
      }
    }
    openFence = nextOpenFence;
  }

  if (current) {
    if (openFence) {
      if (current !== openFence.full) {
        chunks.push(current + closeStr(openFence));
      }
    } else {
      chunks.push(current);
    }
  }

  return chunks.length > 0 ? chunks : [""];
}

export function parseCodeFileArg(codeFile, linesSpec) {
  let filePath = String(codeFile || "").trim();
  let range = linesSpec ? String(linesSpec).trim() : "";

  // Support `path:40-80` or `C:\dir\file.ts:40-80`
  if (!range) {
    const colonMatch = /^(.*):(\d+(?:-\d+)?)$/.exec(filePath);
    if (colonMatch && colonMatch[1].length > 1) {
      filePath = colonMatch[1];
      range = colonMatch[2];
    }
  }

  const safePath = assertSafeLocalFile(filePath, { checkSize: true });
  const raw = fs.readFileSync(safePath, "utf8");
  const allLines = raw.split(/\r?\n/);

  let startLine = 1;
  let endLine = allLines.length;
  if (range) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(range);
    if (!m) {
      throw new Error(`Invalid line range "${range}". Use "40-80" or "42".`);
    }
    startLine = Math.max(1, Number(m[1]));
    endLine = m[2] ? Math.min(allLines.length, Number(m[2])) : startLine;
    if (endLine < startLine) {
      throw new Error(`Invalid line range "${range}": end line is before start line.`);
    }
  }

  const excerpt = allLines.slice(startLine - 1, endLine).join("\n");
  const base = path.basename(safePath);
  const ext = path.extname(safePath).toLowerCase();
  const lang = EXT_LANG_MAP[ext] || "";
  const fence = excerpt.includes("```") ? "````" : "```";
  const lineLabel = range
    ? startLine === endLine
      ? `line ${startLine}`
      : `lines ${startLine}-${endLine}`
    : `${allLines.length} lines`;

  return {
    fileName: base,
    ext: ext.replace(/^\./, "") || "txt",
    lang,
    header: `\`${base}\` (${lineLabel})`,
    markdown: `\`${base}\` (${lineLabel})\n${fence}${lang}\n${excerpt}\n${fence}`,
    rawExcerpt: excerpt,
  };
}

export function parseReplyTo(replyTo) {
  if (!replyTo) return null;
  const trimmed = String(replyTo).trim();
  if (isSnowflake(trimmed)) {
    return { messageId: trimmed, channelId: null };
  }
  const urlMatch =
    /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(
      trimmed
    );
  if (urlMatch) {
    return { guildId: urlMatch[1], channelId: urlMatch[2], messageId: urlMatch[3] };
  }
  throw new Error(
    `Invalid replyTo value "${replyTo}". Provide a Discord message ID or message link.`
  );
}

function buildFormDataWithPayload(payload, attachments) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  for (let i = 0; i < attachments.length; i++) {
    const item = attachments[i];
    form.append(`files[${i}]`, new Blob([item.bytes]), item.name);
  }
  return form;
}

async function postSingleMessage(
  targetId,
  content,
  { suppressEmbeds = false, attachments = [], replyToMessageId = null } = {}
) {
  const payload = {
    allowed_mentions: { parse: [] },
  };
  if (content) payload.content = content;
  if (suppressEmbeds) payload.flags = 1 << 2;
  if (replyToMessageId) {
    payload.message_reference = {
      message_id: replyToMessageId,
      fail_if_not_exists: false,
    };
  }

  if (attachments && attachments.length > 0) {
    return discordRequest("POST", `/channels/${targetId}/messages`, {
      formData: buildFormDataWithPayload(payload, attachments),
    });
  }

  return discordRequest("POST", `/channels/${targetId}/messages`, { body: payload });
}

export async function sendMessage({
  content = "",
  codeFile,
  lines,
  alias,
  server,
  channel,
  thread,
  channelId,
  threadId,
  createThreadName,
  replyTo,
  suppressEmbeds = false,
  attachLong = true,
  files = [],
  from,
  includeSender,
  includeMachine,
} = {}) {
  let rawContent = String(content ?? "");
  let codeSnippetInfo = null;

  if (codeFile) {
    codeSnippetInfo = parseCodeFileArg(codeFile, lines);
    rawContent = rawContent.trim()
      ? `${rawContent.trim()}\n\n${codeSnippetInfo.markdown}`
      : codeSnippetInfo.markdown;
  }

  const fileList = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!rawContent.trim() && fileList.length === 0) {
    throw new Error(
      "Message content cannot be empty unless attaching at least one file or providing codeFile."
    );
  }

  if (fileList.length > MAX_ATTACHMENTS) {
    throw new Error(
      `Too many attachments (${fileList.length}). Discord allows at most ${MAX_ATTACHMENTS} files per message.`
    );
  }

  // Guard against leaking the bot token inside message text
  const currentToken = getToken();
  if (currentToken && rawContent.includes(currentToken)) {
    throw new Error(
      "Message appears to contain your Discord bot token; refusing to send."
    );
  }

  // Pre-validate and load all attachments BEFORE creating threads or posting anything
  const attachments = fileList.map((fp) => {
    const safePath = assertSafeLocalFile(fp, { checkSize: true });
    return {
      name: path.basename(safePath),
      bytes: fs.readFileSync(safePath),
    };
  });

  const parsedReply = parseReplyTo(replyTo);

  const config = loadConfig();
  const formattedContent = rawContent.trim()
    ? formatWithSender(rawContent, { from, includeSender, includeMachine }, config)
    : formatSenderLabel({ from, includeSender, includeMachine }, config)
      ? `${formatSenderLabel({ from, includeSender, includeMachine }, config)}:`
      : "";

  const target = await resolveTarget({
    alias,
    server,
    channel,
    thread,
    channelId,
    threadId,
  });

  if (
    parsedReply?.channelId &&
    parsedReply.channelId !== target.targetId &&
    !createThreadName
  ) {
    throw new Error(
      `replyTo message belongs to channel ${parsedReply.channelId}, which does not match target ${target.targetId}.`
    );
  }

  let chunks = formattedContent ? splitDiscordMessage(formattedContent) : [""];
  let uploadedAsFile = false;

  // Auto-upload very long text (>3 chunks) as an inline text attachment instead of flooding
  if (
    attachLong !== false &&
    chunks.length > AUTO_ATTACH_CHUNK_THRESHOLD &&
    attachments.length === 0
  ) {
    const ext = codeSnippetInfo?.ext || "txt";
    const fileName = codeSnippetInfo
      ? codeSnippetInfo.fileName
      : `snippet.${ext}`;
    const bodyForFile = codeSnippetInfo ? codeSnippetInfo.rawExcerpt : rawContent;
    const summaryLine = codeSnippetInfo
      ? `Attached ${codeSnippetInfo.header}${content?.trim() ? ` — ${content.trim()}` : ""}`
      : `Attached long snippet (${rawContent.length} chars)`;
    const headerContent = formatWithSender(
      summaryLine,
      { from, includeSender, includeMachine },
      config
    );
    chunks = [headerContent.slice(0, MAX_MESSAGE_LEN)];
    attachments.push({
      name: fileName,
      bytes: Buffer.from(bodyForFile, "utf8"),
    });
    uploadedAsFile = true;
  }

  let postChannelId = target.targetId;
  let threadName = target.threadName;
  const sentMessages = [];
  let startIndex = 0;

  if (createThreadName) {
    if (FORUM_CHANNEL_TYPES.has(target.targetTypeId)) {
      const starterPayload = {
        name: createThreadName.slice(0, 100),
        auto_archive_duration: 1440,
        message: {
          content: chunks[0] || createThreadName,
          allowed_mentions: { parse: [] },
          ...(suppressEmbeds ? { flags: 1 << 2 } : {}),
        },
      };
      const created =
        attachments.length > 0
          ? await discordRequest("POST", `/channels/${target.channelId}/threads`, {
              formData: buildFormDataWithPayload(starterPayload, attachments),
            })
          : await discordRequest("POST", `/channels/${target.channelId}/threads`, {
              body: starterPayload,
            });
      postChannelId = created.id;
      threadName = created.name;
      const starterMsg = created.message || {
        id: created.last_message_id || created.id,
      };
      sentMessages.push(starterMsg);
      startIndex = 1;
    } else {
      const threadType = target.targetTypeId === 5 ? 10 : 11; // ANNOUNCEMENT_THREAD vs PUBLIC_THREAD
      const created = await discordRequest(
        "POST",
        `/channels/${target.channelId}/threads`,
        {
          body: {
            name: createThreadName.slice(0, 100),
            type: threadType,
            auto_archive_duration: 1440,
          },
        }
      );
      postChannelId = created.id;
      threadName = created.name;
    }
  } else {
    if (FORUM_CHANNEL_TYPES.has(target.targetTypeId)) {
      throw new Error(
        `Channel "#${target.channelName}" is a Forum channel. Specify an existing thread or pass createThreadName to start a new post.`
      );
    }
    if (!MESSAGEABLE_CHANNEL_TYPES.has(target.targetTypeId)) {
      throw new Error(
        `Target "${target.channelName || target.targetId}" (type: ${target.targetType}) does not accept text messages.`
      );
    }
    if (target.archived) {
      try {
        await discordRequest("PATCH", `/channels/${postChannelId}`, {
          body: { archived: false },
        });
      } catch {
        // Proceed anyway; Discord may auto-unarchive on message send
      }
    }
  }

  for (let i = startIndex; i < chunks.length; i++) {
    // Only attach files once (and never again if forum starter already uploaded them)
    const chunkAttachments =
      i === 0 && !FORUM_CHANNEL_TYPES.has(target.targetTypeId) ? attachments : [];
    const replyId = i === 0 && parsedReply ? parsedReply.messageId : null;
    try {
      const msg = await postSingleMessage(postChannelId, chunks[i], {
        suppressEmbeds,
        attachments: chunkAttachments,
        replyToMessageId: replyId,
      });
      sentMessages.push(msg);
    } catch (err) {
      if (sentMessages.length > 0) {
        err.partialMessageIds = sentMessages.map((m) => m.id).filter(Boolean);
        err.message = `${err.message} (Partial delivery: ${sentMessages.length}/${chunks.length} chunk(s) already posted; IDs: ${err.partialMessageIds.join(", ")})`;
      }
      throw err;
    }
  }

  const primaryMsg = sentMessages[0];
  const url =
    target.guildId && primaryMsg?.id
      ? `https://discord.com/channels/${target.guildId}/${postChannelId}/${primaryMsg.id}`
      : null;

  return {
    ok: true,
    guildId: target.guildId,
    guildName: target.guildName,
    channelId: target.channelId,
    channelName: target.channelName,
    threadId: createThreadName ? postChannelId : target.threadId,
    threadName,
    postedToId: postChannelId,
    messageIds: sentMessages.map((m) => m.id).filter(Boolean),
    chunksSent: sentMessages.length,
    uploadedAsFile,
    url,
  };
}

export async function readMessages({
  alias,
  server,
  channel,
  thread,
  channelId,
  threadId,
  limit = 10,
} = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const target = await resolveTarget({
    alias,
    server,
    channel,
    thread,
    channelId,
    threadId,
  });

  if (FORUM_CHANNEL_TYPES.has(target.targetTypeId)) {
    throw new Error(
      `Channel "#${target.channelName}" is a Forum channel. Specify a thread to read messages from.`
    );
  }

  const rawMessages = await discordRequest(
    "GET",
    `/channels/${target.targetId}/messages`,
    { query: { limit: safeLimit } }
  );

  const messages = (Array.isArray(rawMessages) ? rawMessages : [])
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      author: m.author?.global_name || m.author?.username || "unknown",
      bot: Boolean(m.author?.bot),
      timestamp: m.timestamp,
      content: m.content || "",
      attachments: (m.attachments || []).map((a) => ({
        filename: a.filename,
        size: a.size,
        url: a.url,
      })),
      url: target.guildId
        ? `https://discord.com/channels/${target.guildId}/${target.targetId}/${m.id}`
        : null,
    }));

  const hasEmptyHumanMessage = messages.some(
    (m) => !m.bot && !m.content && m.attachments.length === 0
  );

  return {
    guildId: target.guildId,
    guildName: target.guildName,
    channelId: target.channelId,
    channelName: target.channelName,
    threadId: target.threadId,
    threadName: target.threadName,
    count: messages.length,
    messages,
    note: hasEmptyHumanMessage
      ? "Some human messages returned empty content. Enable 'Message Content Intent' in Discord Developer Portal → Bot to read non-bot message text."
      : null,
  };
}

export async function setDefault({
  server,
  channel,
  thread,
  channelId,
  threadId,
} = {}) {
  const config = loadConfig();
  const target = await resolveTarget({
    server,
    channel,
    thread,
    channelId,
    threadId,
  });

  config.defaultGuildId = target.guildId || config.defaultGuildId;
  config.defaultGuildName = target.guildName || config.defaultGuildName;
  config.defaultChannelId = target.channelId || "";
  config.defaultChannelName = target.channelName || "";
  config.defaultThreadId = target.threadId || "";
  config.defaultThreadName = target.threadName || "";

  saveConfig(config);
  return {
    defaultGuildId: config.defaultGuildId,
    defaultGuildName: config.defaultGuildName,
    defaultChannelId: config.defaultChannelId,
    defaultChannelName: config.defaultChannelName,
    defaultThreadId: config.defaultThreadId,
    defaultThreadName: config.defaultThreadName,
  };
}

export async function setAlias({
  name,
  server,
  channel,
  thread,
  channelId,
  threadId,
  description = "",
} = {}) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Alias name is required.");

  const target = await resolveTarget({
    server,
    channel,
    thread,
    channelId,
    threadId,
  });

  const config = loadConfig();
  config.aliases[cleanName] = {
    guildId: target.guildId,
    guildName: target.guildName,
    channelId: target.channelId,
    channelName: target.channelName,
    threadId: target.threadId,
    threadName: target.threadName,
    description,
  };
  saveConfig(config);
  return { name: cleanName, ...config.aliases[cleanName] };
}

export function removeAlias(name) {
  const config = loadConfig();
  const key = Object.keys(config.aliases).find(
    (k) => k.toLowerCase() === String(name || "").trim().toLowerCase()
  );
  if (!key) {
    return { removed: false, name };
  }
  delete config.aliases[key];
  saveConfig(config);
  return { removed: true, name: key };
}

export async function getStatus() {
  const config = loadConfig();
  const configured = hasToken();
  let bot = null;
  let guilds = [];
  let error = null;

  if (configured) {
    try {
      bot = await verifyBot();
      guilds = await listGuilds();
    } catch (err) {
      error = err.message;
    }
  }

  const resolvedSender = resolveSender(config);

  return {
    version: APP_VERSION,
    configPath: getConfigPath(),
    tokenConfigured: configured,
    bot,
    guilds,
    sender: {
      configuredName: config.senderName,
      effectiveName: resolvedSender.name,
      source: resolvedSender.source,
      host: resolvedSender.host,
      includeSender: config.includeSender,
      includeMachine: config.includeMachine,
    },
    defaultTarget: {
      guildId: config.defaultGuildId,
      guildName: config.defaultGuildName,
      channelId: config.defaultChannelId,
      channelName: config.defaultChannelName,
      threadId: config.defaultThreadId,
      threadName: config.defaultThreadName,
    },
    aliases: config.aliases,
    error,
  };
}
