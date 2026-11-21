import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = "https://discord.com/api/v10";
const MAX_MESSAGE_LEN = 2000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const AUTO_ATTACH_CHUNK_THRESHOLD = 3;

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
    );
    if (pkg?.version) return String(pkg.version);
  } catch {
    // fallback below
  }
  return "1.1.0";
}

export const APP_VERSION = readPackageVersion();
export const USER_AGENT = `DiscordBot (https://github.com/Tolkium/t3-discord, ${APP_VERSION})`;

// View Channels | Send Messages | Embed Links | Attach Files | Read History | Create Public Threads | Send in Threads
export const INVITE_PERMISSIONS = (
  1024n | 2048n | 16384n | 32768n | 65536n | (1n << 35n) | (1n << 38n)
).toString();

export const CHANNEL_TYPE_NAMES = {
  0: "text", 2: "voice", 4: "category", 5: "announcement",
  10: "announcement_thread", 11: "public_thread", 12: "private_thread",
  13: "stage", 15: "forum", 16: "media",
};

const MESSAGEABLE_TYPES = new Set([0, 2, 5, 10, 11, 12, 13]);
const LISTABLE_TYPES = new Set([0, 2, 5, 13, 15, 16]);
const TEXT_PREFERRED_TYPES = new Set([0, 5, 15, 16]);
const FORUM_TYPES = new Set([15, 16]);
const THREAD_TYPES = new Set([10, 11, 12]);
const GENERIC_USERS = new Set([
  "admin", "administrator", "user", "owner", "root", "default", "pc", "desktop", "laptop",
]);

const EXT_LANG = {
  ".ts": "ts", ".tsx": "tsx", ".mts": "ts", ".cts": "ts",
  ".js": "js", ".jsx": "jsx", ".mjs": "js", ".cjs": "js",
  ".py": "py", ".rb": "rb", ".rs": "rs", ".go": "go", ".java": "java", ".kt": "kotlin",
  ".cs": "csharp", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp", ".c": "c", ".h": "c",
  ".php": "php", ".swift": "swift", ".sh": "bash", ".bash": "bash", ".zsh": "zsh",
  ".ps1": "powershell", ".cmd": "bat", ".bat": "bat",
  ".json": "json", ".jsonc": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".xml": "xml", ".html": "html", ".htm": "html", ".css": "css", ".scss": "scss",
  ".sql": "sql", ".md": "markdown", ".dockerfile": "dockerfile", ".vue": "vue", ".svelte": "svelte",
};

let cachedGitUser;

// --- Paths & Config ---

export const getConfigDir = () =>
  process.env.T3_DISCORD_CONFIG_DIR || path.join(os.homedir(), ".config", "t3-discord");
export const getConfigPath = () => path.join(getConfigDir(), "config.json");
export const getTokenPath = () => path.join(getConfigDir(), "token.txt");
export const buildInviteUrl = (botId) =>
  `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(String(botId))}&scope=bot&permissions=${INVITE_PERMISSIONS}`;

function defaultConfig() {
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

function atomicWrite(filePath, content, options = "utf8") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, options);
  fs.renameSync(tmpPath, filePath);
}

export function loadConfig() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) return defaultConfig();
  const raw = fs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!raw) return defaultConfig();
  const p = JSON.parse(raw);
  return {
    ...defaultConfig(),
    defaultGuildId: p.defaultGuildId || "",
    defaultGuildName: p.defaultGuildName || "",
    defaultChannelId: p.defaultChannelId || "",
    defaultChannelName: p.defaultChannelName || "",
    defaultThreadId: p.defaultThreadId || "",
    defaultThreadName: p.defaultThreadName || "",
    senderName: p.senderName || "",
    includeSender: p.includeSender !== undefined ? Boolean(p.includeSender) : true,
    includeMachine: Boolean(p.includeMachine),
    aliases: p.aliases && typeof p.aliases === "object" && !Array.isArray(p.aliases) ? p.aliases : {},
  };
}

export function saveConfig(config) {
  atomicWrite(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

// --- Sender Attribution ---

function getGitUserName() {
  if (cachedGitUser !== undefined) return cachedGitUser;
  try {
    cachedGitUser = execFileSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
  } catch {
    cachedGitUser = "";
  }
  return cachedGitUser;
}

export function resolveSender(config = loadConfig(), overrideName = "") {
  const host = os.hostname() || "";
  const explicit = String(overrideName || "").trim();
  if (explicit) return { name: explicit, source: "override", host };

  const fromEnv = process.env.T3_DISCORD_SENDER?.trim();
  if (fromEnv) return { name: fromEnv, source: "env", host };

  if (config.senderName?.trim()) return { name: config.senderName.trim(), source: "config", host };

  const gitName = getGitUserName();
  if (gitName) return { name: gitName, source: "git", host };

  let osUser = "";
  try {
    osUser = os.userInfo().username || "";
  } catch {
    osUser = process.env.USERNAME || process.env.USER || "";
  }
  if (osUser && !GENERIC_USERS.has(osUser.toLowerCase())) {
    return { name: osUser, source: "os-user", host };
  }
  if (host) return { name: host, source: "hostname", host };
  return { name: osUser || "Unknown", source: "fallback", host };
}

export function formatSenderLabel({ from, includeSender, includeMachine } = {}, config = loadConfig()) {
  const enabled = includeSender !== undefined ? Boolean(includeSender) : config.includeSender;
  if (!enabled) return "";
  const sender = resolveSender(config, from);
  if (!sender.name) return "";
  const showHost = includeMachine !== undefined ? Boolean(includeMachine) : config.includeMachine;
  return showHost && sender.host && sender.host.toLowerCase() !== sender.name.toLowerCase()
    ? `**${sender.name}** (\`${sender.host}\`)`
    : `**${sender.name}**`;
}

export function formatWithSender(content, opts = {}, config = loadConfig()) {
  const text = String(content ?? "");
  const label = formatSenderLabel(opts, config);
  if (!label) return text;
  if (!text.trim()) return `${label}:`;
  if (text.startsWith(`${label}:`)) return text;
  const multiline = text.includes("\n") || text.trimStart().startsWith("```");
  return multiline ? `${label}:\n${text}` : `${label}: ${text}`;
}

export function setSender({ name, clearName = false, includeSender, includeMachine } = {}) {
  const config = loadConfig();
  if (clearName) config.senderName = "";
  else if (name !== undefined) config.senderName = String(name).trim();
  if (includeSender !== undefined) config.includeSender = Boolean(includeSender);
  if (includeMachine !== undefined) config.includeMachine = Boolean(includeMachine);
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

// --- Token Management ---

export const cleanToken = (raw) => String(raw || "").trim().replace(/^Bot\s+/i, "");

function readSavedToken() {
  const tokPath = getTokenPath();
  return fs.existsSync(tokPath) ? cleanToken(fs.readFileSync(tokPath, "utf8")) : "";
}

export function hasToken() {
  return Boolean(
    process.env.T3_DISCORD_TOKEN?.trim() ||
    process.env.DISCORD_BOT_TOKEN?.trim() ||
    readSavedToken()
  );
}

export function getToken() {
  const tok =
    cleanToken(process.env.T3_DISCORD_TOKEN) ||
    cleanToken(process.env.DISCORD_BOT_TOKEN) ||
    readSavedToken();
  if (tok) return tok;
  throw new Error(
    `Discord bot token is not configured. Save your bot token to ${getTokenPath()} (or set T3_DISCORD_TOKEN).`
  );
}

export function lockDownTokenFile(tokPath = getTokenPath()) {
  if (!fs.existsSync(tokPath)) return { ok: false, warning: "Token file not found." };
  try {
    if (process.platform === "win32") {
      const user = process.env.USERNAME || os.userInfo().username;
      execFileSync("icacls", [tokPath, "/inheritance:r", "/grant:r", `${user}:(R,W)`], {
        stdio: "ignore",
      });
    } else {
      fs.chmodSync(tokPath, 0o600);
    }
    return { ok: true, warning: null };
  } catch (err) {
    return { ok: false, warning: `Could not tighten permissions on ${tokPath}: ${err.message}` };
  }
}

export function saveToken(rawToken) {
  const token = cleanToken(rawToken);
  if (!token) throw new Error("Bot token cannot be empty.");
  const tokPath = getTokenPath();
  atomicWrite(tokPath, token + "\n", { encoding: "utf8", mode: 0o600 });
  const acl = lockDownTokenFile(tokPath);
  return { tokenPath: tokPath, permissionWarning: acl.warning };
}

// --- Helpers & HTTP ---

const isSnowflake = (v) => typeof v === "string" && /^\d{17,22}$/.test(v.trim());
const normalizeName = (v) => String(v || "").trim().replace(/^#/, "").toLowerCase();

export function formatDestination(target) {
  const guild = target.guildName || target.guildId || "";
  const channel = `#${target.channelName || target.channelId || "?"}`;
  const base = guild ? `${guild} / ${channel}` : channel;
  return target.threadId ? `${base} > "${target.threadName || target.threadId}"` : base;
}

function isInsideDir(targetPath, parentDir) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertSafeLocalFile(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("File path must be a non-empty string.");
  }
  if (!path.isAbsolute(filePath)) {
    throw new Error(`File path must be absolute: ${filePath}`);
  }
  const resolved = path.resolve(filePath);
  if (resolved === path.resolve(getTokenPath()) || isInsideDir(resolved, getConfigDir())) {
    throw new Error(`Refusing to read or attach file inside t3-discord config directory: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Path is not a regular file: ${resolved}`);
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `File "${path.basename(resolved)}" (${(stat.size / (1024 * 1024)).toFixed(1)} MiB) exceeds Discord's 10 MiB upload limit.`
    );
  }
  return resolved;
}

export async function discordRequest(method, endpoint, options = {}) {
  const { body, query, formData, retryCount = 0, tokenOverride, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const token = tokenOverride ? cleanToken(tokenOverride) : getToken();

  let url = `${API_BASE}${endpoint}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT };
  let fetchBody;
  if (formData) {
    fetchBody = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: fetchBody, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`Discord API request timed out after ${Math.round(timeoutMs / 1000)}s (${method} ${endpoint}).`);
    }
    throw err;
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  if (res.status === 429 && retryCount < 2) {
    const retryAfter =
      typeof data?.retry_after === "number" && Number.isFinite(data.retry_after)
        ? data.retry_after
        : Number(res.headers.get("retry-after")) || 1;
    if (retryAfter <= 5) {
      await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 50));
      return discordRequest(method, endpoint, { ...options, retryCount: retryCount + 1 });
    }
  }

  if (!res.ok) {
    const msg = data?.message || res.statusText || "Request failed";
    const code = data?.code ? ` (Discord code ${data.code})` : "";
    const hints = {
      401: " — check that your Discord Bot Token (Developer Portal -> Bot -> Reset Token, ~70 chars with 2 dots) is valid and not revoked.",
      403: " — the bot lacks permission in that server/channel/thread (View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Read Message History).",
      404: " — the server, channel, or thread was not found or the bot does not have access to it.",
    };
    const err = new Error(`Discord API ${res.status}${code}: ${msg}${hints[res.status] || ""}`);
    err.status = res.status;
    err.code = data?.code;
    err.details = data;
    throw err;
  }
  return data;
}

// --- Discovery & Target Resolution ---

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

export async function listGuilds(tokenOverride) {
  const guilds = await discordRequest("GET", "/users/@me/guilds", { tokenOverride });
  return guilds.map((g) => ({ id: g.id, name: g.name, owner: Boolean(g.owner) }));
}

export async function verifyAndSaveToken(rawToken) {
  const candidate = cleanToken(rawToken);
  if (!candidate) throw new Error("Bot token cannot be empty.");
  const bot = await verifyBot(candidate);
  const guilds = await listGuilds(candidate);
  const saved = saveToken(candidate);
  return { ok: true, ...saved, bot, guilds, inviteUrl: bot.inviteUrl };
}

export const getChannel = (channelId) => discordRequest("GET", `/channels/${channelId}`);

export async function listChannels(guildId) {
  const raw = await discordRequest("GET", `/guilds/${guildId}/channels`);
  const categories = new Map(raw.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  return raw
    .filter((c) => LISTABLE_TYPES.has(c.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: CHANNEL_TYPE_NAMES[c.type] || String(c.type),
      typeId: c.type,
      category: c.parent_id ? categories.get(c.parent_id) || null : null,
      topic: c.topic || null,
    }));
}

export async function listThreads({ guildId, channelId, includeArchived = false } = {}) {
  const seen = new Map();
  if (guildId) {
    const active = await discordRequest("GET", `/guilds/${guildId}/threads/active`);
    for (const t of active?.threads || []) {
      if (!channelId || t.parent_id === channelId) seen.set(t.id, t);
    }
  }

  if (includeArchived) {
    if (!channelId) {
      throw new Error("Listing archived threads requires a channel (specify --channel or set a default channel).");
    }
    for (const visibility of ["public", "private"]) {
      try {
        const res = await discordRequest("GET", `/channels/${channelId}/threads/archived/${visibility}`, {
          query: { limit: 50 },
        });
        for (const t of res?.threads || []) {
          if (!seen.has(t.id)) seen.set(t.id, t);
        }
      } catch (err) {
        if (err.status !== 403 && err.status !== 400) throw err;
      }
    }
  }

  let channelNames = new Map();
  if (guildId) {
    try {
      channelNames = new Map((await listChannels(guildId)).map((c) => [c.id, c.name]));
    } catch {
      // non-fatal
    }
  }

  return Array.from(seen.values()).map((t) => ({
    id: t.id,
    name: t.name,
    parentId: t.parent_id || null,
    parentName: t.parent_id ? channelNames.get(t.parent_id) || null : null,
    type: CHANNEL_TYPE_NAMES[t.type] || String(t.type),
    archived: Boolean(t.thread_metadata?.archived),
    locked: Boolean(t.thread_metadata?.locked),
  }));
}

export async function listThreadsForQuery({ server, channel, includeArchived = false } = {}) {
  const guild = await resolveGuild(server);
  const cfg = loadConfig();
  let channelId;
  if (channel) {
    channelId = (await resolveTarget({ server: guild.id, channel })).channelId;
  } else if (includeArchived && cfg.defaultChannelId && (!cfg.defaultGuildId || cfg.defaultGuildId === guild.id)) {
    channelId = cfg.defaultChannelId;
  }
  const threads = await listThreads({ guildId: guild.id, channelId, includeArchived });
  return { guild, threads };
}

function pickBestMatch(matches, query, kind) {
  if (matches.length === 1) return matches[0];
  const textOnly = matches.filter((m) => TEXT_PREFERRED_TYPES.has(m.typeId));
  if (textOnly.length === 1) return textOnly[0];
  const list = matches.slice(0, 8).map((i) => `${i.name} (${i.id})`).join(", ");
  throw new Error(`Ambiguous ${kind} "${query}". Matches: ${list}.`);
}

function matchByNameOrId(items, query, kind) {
  const q = String(query || "").trim();
  if (!q) return null;
  if (isSnowflake(q)) return items.find((i) => i.id === q) || { id: q, name: q, _rawId: true };

  const norm = normalizeName(q);
  const exact = items.filter((i) => normalizeName(i.name) === norm);
  if (exact.length > 0) return pickBestMatch(exact, query, kind);

  const prefix = items.filter((i) => normalizeName(i.name).startsWith(norm));
  if (prefix.length > 0) return pickBestMatch(prefix, query, kind);

  const partial = items.filter((i) => normalizeName(i.name).includes(norm));
  if (partial.length > 0) {
    const hints = partial.slice(0, 6).map((i) => `${i.name} (${i.id})`).join(", ");
    throw new Error(`Could not find exact ${kind} "${query}". Did you mean: ${hints}?`);
  }

  const avail = items.slice(0, 12).map((i) => i.name).join(", ");
  throw new Error(`Could not find ${kind} "${query}".${avail ? ` Available: ${avail}` : ""}`);
}

export async function resolveGuild(serverQuery, config = loadConfig()) {
  const guilds = await listGuilds();
  if (guilds.length === 0) {
    throw new Error("The Discord bot is not a member of any server yet. Invite the bot first.");
  }
  if (serverQuery) {
    const matched = matchByNameOrId(guilds, serverQuery, "server");
    if (matched._rawId) {
      throw new Error(
        `Bot is not a member of server ID "${serverQuery}". Accessible: ${guilds.map((g) => `${g.name} (${g.id})`).join(", ")}.`
      );
    }
    return matched;
  }
  if (config.defaultGuildId) {
    return guilds.find((g) => g.id === config.defaultGuildId) || {
      id: config.defaultGuildId,
      name: config.defaultGuildName || config.defaultGuildId,
    };
  }
  if (guilds.length === 1) return guilds[0];
  throw new Error(
    `Bot is in multiple servers (${guilds.map((g) => `${g.name} (${g.id})`).join(", ")}). Specify a server or set a default.`
  );
}

async function resolveGuildName(guildId, config, knownName = "") {
  if (knownName) return knownName;
  if (!guildId) return "";
  if (guildId === config.defaultGuildId && config.defaultGuildName) return config.defaultGuildName;
  try {
    return (await listGuilds()).find((g) => g.id === guildId)?.name || "";
  } catch {
    return "";
  }
}

function makeTarget({ guildId = "", guildName = "", channelId = "", channelName = "", threadId = "", threadName = "", typeId, archived = false }) {
  return {
    guildId,
    guildName,
    channelId,
    channelName,
    threadId,
    threadName,
    targetId: threadId || channelId,
    targetType: CHANNEL_TYPE_NAMES[typeId] || String(typeId),
    targetTypeId: typeId,
    archived: Boolean(archived),
  };
}

async function fetchAndVerifyChannel(id, { expectedGuild, expectedParentId, requireThread = false } = {}) {
  const ch = await getChannel(id);
  const kind = requireThread ? "Thread" : "Channel";
  if (requireThread && !THREAD_TYPES.has(ch.type)) {
    throw new Error(`ID ${id} is a ${CHANNEL_TYPE_NAMES[ch.type] || ch.type} channel, not a thread.`);
  }
  if (expectedGuild && ch.guild_id && ch.guild_id !== expectedGuild.id) {
    throw new Error(`${kind} ${id} belongs to server ${ch.guild_id}, not "${expectedGuild.name}" (${expectedGuild.id}).`);
  }
  if (expectedParentId && ch.parent_id && ch.parent_id !== expectedParentId) {
    throw new Error(`Thread ${id} belongs to channel ${ch.parent_id}, not ${expectedParentId}.`);
  }
  return ch;
}

export async function resolveTarget(opts = {}) {
  const config = loadConfig();
  let { alias, server, channel, thread, channelId, threadId } = opts;

  if (alias) {
    if (server || channel || channelId) {
      throw new Error("Cannot combine --alias with --server or --channel.");
    }
    const key = Object.keys(config.aliases).find((k) => k.toLowerCase() === String(alias).trim().toLowerCase());
    if (!key) {
      const known = Object.keys(config.aliases);
      throw new Error(`Unknown alias "${alias}".${known.length ? ` Configured: ${known.join(", ")}` : " No aliases configured."}`);
    }
    const entry = config.aliases[key];
    server = entry.guildId || "";
    channelId = entry.channelId || "";
    if (!thread && !threadId) threadId = entry.threadId || "";
  }

  // No explicit destination -> use configured default
  if (!server && !channel && !thread && !channelId && !threadId) {
    if (config.defaultThreadId) {
      try {
        const ch = await getChannel(config.defaultThreadId);
        return makeTarget({
          guildId: ch.guild_id || config.defaultGuildId,
          guildName: config.defaultGuildName,
          channelId: ch.parent_id || config.defaultChannelId,
          channelName: config.defaultChannelName,
          threadId: ch.id,
          threadName: ch.name || config.defaultThreadName,
          typeId: ch.type,
          archived: ch.thread_metadata?.archived,
        });
      } catch (err) {
        if (err.status === 404) {
          throw new Error(`Default thread "${config.defaultThreadName || config.defaultThreadId}" no longer exists (404). Update with set-default.`);
        }
        throw err;
      }
    }
    if (config.defaultChannelId) {
      const ch = await getChannel(config.defaultChannelId);
      return makeTarget({
        guildId: ch.guild_id || config.defaultGuildId,
        guildName: config.defaultGuildName,
        channelId: ch.id,
        channelName: ch.name || config.defaultChannelName,
        typeId: ch.type,
      });
    }
    throw new Error("No destination specified and no default channel/thread is configured yet.");
  }

  // Fast path for explicit snowflake threadId or channelId (when not resolving a thread by name)
  if ((threadId && isSnowflake(threadId)) || (channelId && isSnowflake(channelId) && !thread)) {
    const expectedGuild = server ? await resolveGuild(server, config) : null;
    const isThread = Boolean(threadId && isSnowflake(threadId));
    const ch = await fetchAndVerifyChannel(isThread ? threadId : channelId, {
      expectedGuild,
      expectedParentId: isThread && isSnowflake(channelId) ? channelId : undefined,
      requireThread: isThread,
    });
    const guildId = ch.guild_id || expectedGuild?.id || "";
    const guildName = await resolveGuildName(guildId, config, expectedGuild?.name);
    return makeTarget({
      guildId,
      guildName,
      channelId: isThread ? (ch.parent_id || channelId || ch.id) : ch.id,
      channelName: isThread ? "" : (ch.name || ""),
      threadId: isThread ? ch.id : "",
      threadName: isThread ? (ch.name || "") : "",
      typeId: ch.type,
      archived: ch.thread_metadata?.archived,
    });
  }

  // Name-based resolution within a guild
  const guild = await resolveGuild(server, config);
  let resolvedCh = null;

  if (channelId && isSnowflake(channelId)) {
    const raw = await fetchAndVerifyChannel(channelId, { expectedGuild: guild });
    resolvedCh = { id: raw.id, name: raw.name, typeId: raw.type };
  } else if (channel) {
    const matched = matchByNameOrId(await listChannels(guild.id), channel, "channel");
    if (matched._rawId) {
      const raw = await fetchAndVerifyChannel(matched.id, { expectedGuild: guild });
      resolvedCh = { id: raw.id, name: raw.name, typeId: raw.type };
    } else {
      resolvedCh = matched;
    }
  } else if (config.defaultChannelId && !thread && (!config.defaultGuildId || config.defaultGuildId === guild.id)) {
    const raw = await getChannel(config.defaultChannelId);
    if (!raw.guild_id || raw.guild_id === guild.id) {
      resolvedCh = { id: raw.id, name: raw.name, typeId: raw.type };
    }
  }

  if (thread) {
    if (isSnowflake(thread)) {
      const raw = await fetchAndVerifyChannel(thread, {
        expectedGuild: guild,
        expectedParentId: resolvedCh?.id,
        requireThread: true,
      });
      return makeTarget({
        guildId: raw.guild_id || guild.id,
        guildName: guild.name,
        channelId: raw.parent_id || resolvedCh?.id || "",
        channelName: resolvedCh?.name || "",
        threadId: raw.id,
        threadName: raw.name || "",
        typeId: raw.type,
        archived: raw.thread_metadata?.archived,
      });
    }

    let matched;
    try {
      const active = await listThreads({ guildId: guild.id, channelId: resolvedCh?.id });
      matched = matchByNameOrId(active, thread, "thread");
    } catch (activeErr) {
      const archiveChId = resolvedCh?.id || (config.defaultGuildId === guild.id ? config.defaultChannelId : "");
      if (!archiveChId) throw activeErr;
      const all = await listThreads({ guildId: guild.id, channelId: archiveChId, includeArchived: true });
      matched = matchByNameOrId(all, thread, "thread");
    }

    return makeTarget({
      guildId: guild.id,
      guildName: guild.name,
      channelId: matched.parentId || resolvedCh?.id || "",
      channelName: matched.parentName || resolvedCh?.name || "",
      threadId: matched.id,
      threadName: matched.name,
      typeId: 11,
      archived: matched.archived,
    });
  }

  if (!resolvedCh) {
    throw new Error(
      `Server "${guild.name}" selected, but no channel or thread was specified. Specify --channel.`
    );
  }

  return makeTarget({
    guildId: guild.id,
    guildName: guild.name,
    channelId: resolvedCh.id,
    channelName: resolvedCh.name,
    typeId: resolvedCh.typeId,
  });
}

// --- Message Splitting & Formatting ---

function sliceSafeCodeUnits(str, maxLen) {
  const pieces = [];
  for (let i = 0; i < str.length; ) {
    let end = Math.min(i + maxLen, str.length);
    if (end < str.length) {
      const code = str.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff && end - 1 > i) end -= 1;
    }
    if (end === i) end = Math.min(i + 2, str.length);
    pieces.push(str.slice(i, end));
    i = end;
  }
  return pieces;
}

function parseFenceLine(line) {
  const m = /^(`{3,})([^`]*)$/.exec(line.trim());
  return m ? { ticks: m[1], info: m[2].trim(), full: `${m[1]}${m[2].trim()}` } : null;
}

export function splitDiscordMessage(content, maxLen = MAX_MESSAGE_LEN) {
  const text = String(content ?? "");
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let current = "";
  let openFence = null;
  const closeStr = (f) => (f ? `\n${f.ticks}` : "");

  const flush = () => {
    if (!current) return;
    if (openFence) {
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
  };

  for (const line of text.split("\n")) {
    const parsed = parseFenceLine(line);
    const isOpening = openFence === null && parsed !== null;
    const isClosing = openFence !== null && parsed !== null && parsed.info === "" && parsed.ticks.length >= openFence.ticks.length;
    const nextFence = isOpening ? parsed : isClosing ? null : openFence;
    const reserve = closeStr(nextFence).length;

    const fits = (cur) => cur.length + (cur ? 1 : 0) + line.length + reserve <= maxLen;
    if (fits(current)) {
      current = current ? `${current}\n${line}` : line;
      openFence = nextFence;
      continue;
    }

    if (current) {
      if (isClosing && current === openFence.full) {
        current = "";
        openFence = null;
        continue;
      }
      flush();
    }

    if (fits(current)) {
      current = current ? `${current}\n${line}` : line;
      openFence = nextFence;
      continue;
    }

    const budget = Math.max(1, maxLen - (current ? current.length + 1 : 0) - reserve);
    const parts = sliceSafeCodeUnits(line, budget);
    for (let s = 0; s < parts.length; s++) {
      if (current.length + (current ? 1 : 0) + parts[s].length + reserve > maxLen) flush();
      current = current ? `${current}\n${parts[s]}` : parts[s];
      if (s < parts.length - 1) flush();
    }
    openFence = nextFence;
  }

  if (current && (!openFence || current !== openFence.full)) {
    chunks.push(current + closeStr(openFence));
  }
  return chunks.length > 0 ? chunks : [""];
}

export function parseCodeFileArg(codeFile, linesSpec) {
  let filePath = String(codeFile || "").trim();
  let range = linesSpec ? String(linesSpec).trim() : "";

  if (!range) {
    const m = /^(.*):(\d+(?:-\d+)?)$/.exec(filePath);
    if (m && m[1].length > 1) {
      filePath = m[1];
      range = m[2];
    }
  }

  const safePath = assertSafeLocalFile(filePath);
  const allLines = fs.readFileSync(safePath, "utf8").split(/\r?\n/);

  let start = 1;
  let end = allLines.length;
  if (range) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(range);
    if (!m) throw new Error(`Invalid line range "${range}". Use "40-80" or "42".`);
    start = Number(m[1]);
    if (start < 1) throw new Error(`Invalid line range "${range}": line numbers start at 1.`);
    if (start > allLines.length) {
      throw new Error(`Start line ${start} exceeds file length (${allLines.length} lines).`);
    }
    end = m[2] ? Math.min(allLines.length, Number(m[2])) : start;
    if (end < start) throw new Error(`Invalid line range "${range}": end line is before start line.`);
  }

  const excerpt = allLines.slice(start - 1, end).join("\n");
  const base = path.basename(safePath);
  const ext = path.extname(safePath).toLowerCase();
  const lang = EXT_LANG[ext] || "";
  const fence = excerpt.includes("```") ? "````" : "```";
  const lineLabel = range ? (start === end ? `line ${start}` : `lines ${start}-${end}`) : `${allLines.length} lines`;

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
  if (isSnowflake(trimmed)) return { messageId: trimmed, channelId: null };
  const m = /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(trimmed);
  if (m) return { guildId: m[1], channelId: m[2], messageId: m[3] };
  throw new Error(`Invalid replyTo "${replyTo}". Provide a Discord message ID or link.`);
}

// --- Sending & Reading ---

function buildFormData(payload, attachments) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  attachments.forEach((att, i) => form.append(`files[${i}]`, new Blob([att.bytes]), att.name));
  return form;
}

async function postSingleMessage(targetId, content, { suppressEmbeds = false, attachments = [], replyToId = null } = {}) {
  const payload = { allowed_mentions: { parse: [] } };
  if (content) payload.content = content;
  if (suppressEmbeds) payload.flags = 1 << 2;
  if (replyToId) payload.message_reference = { message_id: replyToId, fail_if_not_exists: false };

  return attachments.length > 0
    ? discordRequest("POST", `/channels/${targetId}/messages`, { formData: buildFormData(payload, attachments) })
    : discordRequest("POST", `/channels/${targetId}/messages`, { body: payload });
}

export async function sendMessage({
  content = "", codeFile, lines, alias, server, channel, thread, channelId, threadId,
  createThreadName, replyTo, suppressEmbeds = false, attachLong = true,
  files = [], from, includeSender, includeMachine,
} = {}) {
  if (createThreadName && replyTo) {
    throw new Error("Cannot combine createThreadName with replyTo.");
  }

  let rawContent = String(content ?? "");
  let codeInfo = null;
  if (codeFile) {
    codeInfo = parseCodeFileArg(codeFile, lines);
    rawContent = rawContent.trim() ? `${rawContent.trim()}\n\n${codeInfo.markdown}` : codeInfo.markdown;
  }

  const fileList = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!rawContent.trim() && fileList.length === 0) {
    throw new Error("Message content cannot be empty unless attaching a file or providing codeFile.");
  }
  if (fileList.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments (${fileList.length}). Discord allows at most ${MAX_ATTACHMENTS}.`);
  }

  const currentToken = getToken();
  if (currentToken && rawContent.includes(currentToken)) {
    throw new Error("Message appears to contain your Discord bot token; refusing to send.");
  }

  // Pre-validate and load attachments before creating threads or sending anything
  const attachments = fileList.map((fp) => {
    const safePath = assertSafeLocalFile(fp);
    return { name: path.basename(safePath), bytes: fs.readFileSync(safePath) };
  });

  const parsedReply = parseReplyTo(replyTo);
  const config = loadConfig();
  const senderOpts = { from, includeSender, includeMachine };
  const formattedContent = formatWithSender(rawContent, senderOpts, config);

  const target = await resolveTarget({ alias, server, channel, thread, channelId, threadId });
  if (parsedReply?.channelId && parsedReply.channelId !== target.targetId) {
    throw new Error(`replyTo message belongs to channel ${parsedReply.channelId}, not target ${target.targetId}.`);
  }

  let chunks = formattedContent ? splitDiscordMessage(formattedContent) : [""];
  let uploadedAsFile = false;

  if (attachLong !== false && chunks.length > AUTO_ATTACH_CHUNK_THRESHOLD && attachments.length === 0) {
    const fileName = codeInfo ? codeInfo.fileName : "snippet.txt";
    const noteText = content?.trim() || "";
    const shortNote = noteText.length > 200 ? `${noteText.slice(0, 197)}...` : noteText;
    const bodyForFile = codeInfo && noteText.length <= 200 ? codeInfo.rawExcerpt : rawContent;
    const summary = codeInfo
      ? `Attached ${codeInfo.header}${shortNote ? ` — ${shortNote}` : ""}`
      : `Attached long snippet (${rawContent.length} chars)`;
    chunks = [formatWithSender(summary, senderOpts, config).slice(0, MAX_MESSAGE_LEN)];
    attachments.push({ name: fileName, bytes: Buffer.from(bodyForFile, "utf8") });
    uploadedAsFile = true;
  }

  let postChannelId = target.targetId;
  let threadName = target.threadName;
  const sentMessages = [];
  let startIndex = 0;

  if (createThreadName) {
    if (FORUM_TYPES.has(target.targetTypeId)) {
      const starterPayload = {
        name: createThreadName.slice(0, 100),
        auto_archive_duration: 1440,
        message: {
          content: chunks[0] || createThreadName,
          allowed_mentions: { parse: [] },
          ...(suppressEmbeds ? { flags: 1 << 2 } : {}),
        },
      };
      const created = attachments.length > 0
        ? await discordRequest("POST", `/channels/${target.channelId}/threads`, {
            formData: buildFormData(starterPayload, attachments),
          })
        : await discordRequest("POST", `/channels/${target.channelId}/threads`, { body: starterPayload });
      postChannelId = created.id;
      threadName = created.name;
      sentMessages.push(created.message || { id: created.last_message_id || created.id });
      startIndex = 1;
    } else {
      const created = await discordRequest("POST", `/channels/${target.channelId}/threads`, {
        body: {
          name: createThreadName.slice(0, 100),
          type: target.targetTypeId === 5 ? 10 : 11,
          auto_archive_duration: 1440,
        },
      });
      postChannelId = created.id;
      threadName = created.name;
    }
  } else {
    if (FORUM_TYPES.has(target.targetTypeId)) {
      throw new Error(`Channel "#${target.channelName}" is a Forum channel. Specify a thread or pass createThreadName.`);
    }
    if (!MESSAGEABLE_TYPES.has(target.targetTypeId)) {
      throw new Error(`Target "${target.channelName || target.targetId}" (${target.targetType}) does not accept text messages.`);
    }
    if (target.archived) {
      try { await discordRequest("PATCH", `/channels/${postChannelId}`, { body: { archived: false } }); } catch { /* Discord may auto-unarchive */ }
    }
  }

  for (let i = startIndex; i < chunks.length; i++) {
    const chunkFiles = i === 0 && !FORUM_TYPES.has(target.targetTypeId) ? attachments : [];
    const replyToId = i === 0 && parsedReply ? parsedReply.messageId : null;
    try {
      sentMessages.push(await postSingleMessage(postChannelId, chunks[i], { suppressEmbeds, attachments: chunkFiles, replyToId }));
    } catch (err) {
      if (sentMessages.length > 0) {
        err.partialMessageIds = sentMessages.map((m) => m.id).filter(Boolean);
        err.message += ` (Partial delivery: ${sentMessages.length}/${chunks.length} posted; IDs: ${err.partialMessageIds.join(", ")})`;
      }
      throw err;
    }
  }

  const primaryId = sentMessages[0]?.id;
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
    url: target.guildId && primaryId ? `https://discord.com/channels/${target.guildId}/${postChannelId}/${primaryId}` : null,
  };
}

export async function readMessages({ alias, server, channel, thread, channelId, threadId, limit = 10 } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const target = await resolveTarget({ alias, server, channel, thread, channelId, threadId });
  if (FORUM_TYPES.has(target.targetTypeId)) {
    throw new Error(`Channel "#${target.channelName}" is a Forum channel. Specify a thread to read messages.`);
  }

  const raw = await discordRequest("GET", `/channels/${target.targetId}/messages`, { query: { limit: safeLimit } });
  const messages = (Array.isArray(raw) ? raw : []).slice().reverse().map((m) => ({
    id: m.id,
    author: m.author?.global_name || m.author?.username || "unknown",
    bot: Boolean(m.author?.bot),
    timestamp: m.timestamp,
    content: m.content || "",
    attachments: (m.attachments || []).map((a) => ({ filename: a.filename, size: a.size, url: a.url })),
    url: target.guildId ? `https://discord.com/channels/${target.guildId}/${target.targetId}/${m.id}` : null,
  }));

  const hasEmptyHuman = messages.some((m) => !m.bot && !m.content && m.attachments.length === 0);
  return {
    guildId: target.guildId,
    guildName: target.guildName,
    channelId: target.channelId,
    channelName: target.channelName,
    threadId: target.threadId,
    threadName: target.threadName,
    count: messages.length,
    messages,
    note: hasEmptyHuman
      ? "Some human messages returned empty content. Enable 'Message Content Intent' in Discord Developer Portal -> Bot to read non-bot text."
      : null,
  };
}

// --- Defaults, Aliases & Status ---

export async function setDefault({ server, channel, thread, channelId, threadId } = {}) {
  const config = loadConfig();
  const target = await resolveTarget({ server, channel, thread, channelId, threadId });
  Object.assign(config, {
    defaultGuildId: target.guildId || config.defaultGuildId,
    defaultGuildName: target.guildName || config.defaultGuildName,
    defaultChannelId: target.channelId || "",
    defaultChannelName: target.channelName || "",
    defaultThreadId: target.threadId || "",
    defaultThreadName: target.threadName || "",
  });
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

export async function setAlias({ name, server, channel, thread, channelId, threadId, description = "" } = {}) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Alias name is required.");
  const target = await resolveTarget({ server, channel, thread, channelId, threadId });
  const config = loadConfig();
  // Replace case-insensitive duplicate key so we never keep both "Friend" and "friend"
  for (const existing of Object.keys(config.aliases)) {
    if (existing.toLowerCase() === cleanName.toLowerCase() && existing !== cleanName) {
      delete config.aliases[existing];
    }
  }
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
  const key = Object.keys(config.aliases).find((k) => k.toLowerCase() === String(name || "").trim().toLowerCase());
  if (!key) return { removed: false, name };
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

  const sender = resolveSender(config);
  return {
    version: APP_VERSION,
    configPath: getConfigPath(),
    tokenConfigured: configured,
    bot,
    guilds,
    sender: {
      configuredName: config.senderName,
      effectiveName: sender.name,
      source: sender.source,
      host: sender.host,
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
