import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

export const CONFIG_DIR =
  process.env.T3_DISCORD_CONFIG_DIR ||
  path.join(os.homedir(), ".config", "t3-discord");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token.txt");

const API_BASE = "https://discord.com/api/v10";
const MAX_MESSAGE_LEN = 2000;
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

export function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_PATH)) {
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
  const raw = fs.readFileSync(CONFIG_PATH, "utf8").trim();
  if (!raw) {
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
  const parsed = JSON.parse(raw);
  return {
    defaultGuildId: parsed.defaultGuildId || "",
    defaultGuildName: parsed.defaultGuildName || "",
    defaultChannelId: parsed.defaultChannelId || "",
    defaultChannelName: parsed.defaultChannelName || "",
    defaultThreadId: parsed.defaultThreadId || "",
    defaultThreadName: parsed.defaultThreadName || "",
    senderName: parsed.senderName || "",
    includeSender: parsed.includeSender !== undefined ? Boolean(parsed.includeSender) : true,
    includeMachine: Boolean(parsed.includeMachine),
    aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {},
  };
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

export function formatWithSender(content, { from, includeSender, includeMachine } = {}, config = loadConfig()) {
  const text = String(content ?? "");
  const shouldInclude = includeSender !== undefined ? Boolean(includeSender) : config.includeSender;
  if (!shouldInclude || !text.trim()) return text;

  const sender = resolveSender(config, from);
  if (!sender.name) return text;

  const showMachine = includeMachine !== undefined ? Boolean(includeMachine) : config.includeMachine;
  const label =
    showMachine && sender.host && sender.host.toLowerCase() !== sender.name.toLowerCase()
      ? `**${sender.name}** (\`${sender.host}\`)`
      : `**${sender.name}**`;

  if (text.startsWith(`${label}:`)) return text;

  const isMultilineOrCode = text.includes("\n") || text.trimStart().startsWith("```");
  return isMultilineOrCode ? `${label}:\n${text}` : `${label}: ${text}`;
}

export function setSender({ name, clearName = false, includeSender, includeMachine } = {}) {
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

export function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function hasToken() {
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN.trim()) {
    return true;
  }
  if (fs.existsSync(TOKEN_PATH)) {
    const val = fs.readFileSync(TOKEN_PATH, "utf8").trim();
    return val.length > 0;
  }
  return false;
}

export function getToken() {
  const fromEnv = process.env.DISCORD_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(TOKEN_PATH)) {
    const fromFile = fs.readFileSync(TOKEN_PATH, "utf8").trim();
    if (fromFile) return fromFile;
  }
  throw new Error(
    `Discord bot token is not configured. Save your bot token to ${TOKEN_PATH} (or set DISCORD_BOT_TOKEN).`
  );
}

export function saveToken(rawToken) {
  const token = String(rawToken || "").trim().replace(/^Bot\s+/i, "");
  if (!token) {
    throw new Error("Bot token cannot be empty.");
  }
  ensureConfigDir();
  fs.writeFileSync(TOKEN_PATH, token + "\n", { encoding: "utf8", mode: 0o600 });
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

export async function discordRequest(method, endpoint, options = {}) {
  const token = getToken();
  const { body, query, formData, retryCount = 0 } = options;

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
    "User-Agent": "t3-discord (https://t3.codes, 1.0.0)",
  };

  let fetchBody;
  if (formData) {
    fetchBody = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: fetchBody,
  });

  if (res.status === 429 && retryCount < 2) {
    let retryAfterSec = 1;
    try {
      const data = await res.json();
      if (typeof data.retry_after === "number") {
        retryAfterSec = data.retry_after;
      }
    } catch {
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

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const apiMsg = data?.message || res.statusText || "Request failed";
    const apiCode = data?.code ? ` (Discord code ${data.code})` : "";
    let hint = "";
    if (res.status === 401) {
      hint = " — check that your Discord Bot Token is valid and not revoked.";
    } else if (res.status === 403) {
      hint =
        " — the bot lacks permission in that server/channel/thread (ensure View Channel, Send Messages, Send Messages in Threads, and Read Message History are granted).";
    } else if (res.status === 404) {
      hint = " — the server, channel, or thread was not found or the bot does not have access to it.";
    }
    const err = new Error(`Discord API ${res.status}${apiCode}: ${apiMsg}${hint}`);
    err.status = res.status;
    err.code = data?.code;
    err.details = data;
    throw err;
  }

  return data;
}

export async function verifyBot() {
  const me = await discordRequest("GET", "/users/@me");
  return {
    id: me.id,
    username: me.username,
    globalName: me.global_name || null,
    discriminator: me.discriminator || "0",
    bot: Boolean(me.bot),
  };
}

export async function listGuilds() {
  const guilds = await discordRequest("GET", "/users/@me/guilds");
  return guilds.map((g) => ({
    id: g.id,
    name: g.name,
    owner: Boolean(g.owner),
  }));
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

export async function listThreads({ guildId, channelId, includeArchived = false } = {}) {
  const seen = new Map();

  if (guildId) {
    const active = await discordRequest("GET", `/guilds/${guildId}/threads/active`);
    for (const t of active?.threads || []) {
      if (channelId && t.parent_id !== channelId) continue;
      seen.set(t.id, t);
    }
  }

  if (includeArchived && channelId) {
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
    // Prefer text/announcement/forum channels over voice/stage when names collide (e.g. #gaming vs #Gaming voice)
    const textPreferred = exact.filter((i) => i.typeId === 0 || i.typeId === 5 || i.typeId === 15 || i.typeId === 16);
    if (textPreferred.length === 1) return textPreferred[0];
    const names = exact.map((i) => `${i.name} [${i.type || "unknown"}] (${i.id})`).join(", ");
    throw new Error(`Multiple ${kindLabel}s match "${query}": ${names}. Please specify an ID or narrow by channel/server.`);
  }

  const prefix = items.filter((item) => normalizeName(item.name).startsWith(norm));
  if (prefix.length === 1) return prefix[0];

  const partial = items.filter((item) => normalizeName(item.name).includes(norm));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    const names = partial.slice(0, 8).map((i) => `${i.name} (${i.id})`).join(", ");
    throw new Error(`Ambiguous ${kindLabel} "${query}". Matches: ${names}.`);
  }

  const available = items.slice(0, 12).map((i) => i.name).join(", ");
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
    return matchByNameOrId(guilds, serverQuery, "server");
  }

  if (config.defaultGuildId) {
    const found = guilds.find((g) => g.id === config.defaultGuildId);
    if (found) return found;
    return { id: config.defaultGuildId, name: config.defaultGuildName || config.defaultGuildId };
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
    const aliasKey = Object.keys(config.aliases).find(
      (k) => k.toLowerCase() === String(alias).trim().toLowerCase()
    );
    if (!aliasKey) {
      const known = Object.keys(config.aliases);
      throw new Error(
        `Unknown alias "${alias}".${known.length ? ` Configured aliases: ${known.join(", ")}` : " No aliases configured yet."}`
      );
    }
    const entry = config.aliases[aliasKey];
    server = server || entry.guildId;
    channelId = channelId || entry.channelId;
    threadId = threadId || entry.threadId;
  }

  // If explicit threadId given, fetch metadata for nicer reporting
  if (threadId && isSnowflake(threadId)) {
    const ch = await getChannel(threadId);
    return {
      guildId: ch.guild_id || server || config.defaultGuildId || "",
      guildName: config.defaultGuildName || "",
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

  // If explicit channelId given and no thread name requested
  if (channelId && isSnowflake(channelId) && !thread) {
    const ch = await getChannel(channelId);
    return {
      guildId: ch.guild_id || server || config.defaultGuildId || "",
      guildName: config.defaultGuildName || "",
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

  // No explicit target at all -> use defaults
  if (!server && !channel && !thread && !channelId && !threadId) {
    if (config.defaultThreadId) {
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
      resolvedChannel = {
        id: raw.id,
        name: raw.name,
        type: CHANNEL_TYPE_NAMES[raw.type] || String(raw.type),
        typeId: raw.type,
      };
    }
  } else if (config.defaultChannelId && !thread) {
    const raw = await getChannel(config.defaultChannelId);
    resolvedChannel = {
      id: raw.id,
      name: raw.name,
      type: CHANNEL_TYPE_NAMES[raw.type] || String(raw.type),
      typeId: raw.type,
    };
  }

  if (thread) {
    if (isSnowflake(thread)) {
      const raw = await getChannel(thread);
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

    // Search active threads first (scoped to channel if provided)
    let threads = await listThreads({
      guildId: guild.id,
      channelId: resolvedChannel?.id,
      includeArchived: false,
    });

    let matchedThread = null;
    try {
      matchedThread = matchByNameOrId(threads, thread, "thread");
    } catch (activeErr) {
      // If a parent channel is known (or default channel), also search archived threads
      const searchChannelId = resolvedChannel?.id || config.defaultChannelId;
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
      `Server "${guild.name}" selected, but no channel or thread was specified and no default channel is configured.`
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
 * Splits long text into <= 2000-char chunks while preserving fenced code blocks.
 */
export function splitDiscordMessage(content, maxLen = MAX_MESSAGE_LEN) {
  const text = String(content ?? "");
  if (text.length <= maxLen) return [text];

  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  let openFence = null; // e.g. "```ts"

  function updateFenceState(line) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (openFence === null) {
        openFence = trimmed;
      } else {
        openFence = null;
      }
    }
  }

  function flushChunk() {
    if (!current) return;
    if (openFence !== null) {
      chunks.push(current + "\n```");
      current = openFence;
    } else {
      chunks.push(current);
      current = "";
    }
  }

  for (const line of lines) {
    const isClosingFence = openFence !== null && line.trimStart().startsWith("```");
    const closingReserve = openFence !== null && !isClosingFence ? 4 : 0; // "\n```"
    const sep = current ? "\n" : "";

    // If a single line is longer than maxLen, hard-split it
    if (line.length + closingReserve + 10 > maxLen) {
      if (current && current !== openFence) {
        flushChunk();
      }
      let remaining = line;
      while (remaining.length > 0) {
        const prefix = current ? current + "\n" : "";
        const budget = maxLen - prefix.length - (openFence !== null ? 4 : 0);
        const take = Math.max(1, budget);
        const slice = remaining.slice(0, take);
        remaining = remaining.slice(take);
        current = prefix + slice;
        if (remaining.length > 0) {
          flushChunk();
        }
      }
      updateFenceState(line);
      continue;
    }

    if (current.length + sep.length + line.length + closingReserve > maxLen) {
      flushChunk();
    }

    current = current ? current + "\n" + line : line;
    updateFenceState(line);
  }

  if (current && current !== openFence) {
    if (openFence !== null) {
      chunks.push(current + "\n```");
    } else {
      chunks.push(current);
    }
  }

  return chunks.length > 0 ? chunks : [""];
}

async function postSingleMessage(targetId, content, { suppressEmbeds = false, files = [] } = {}) {
  const payload = {};
  if (content) payload.content = content;
  if (suppressEmbeds) payload.flags = 1 << 2; // SUPPRESS_EMBEDS

  if (files && files.length > 0) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      if (!fs.existsSync(filePath)) {
        throw new Error(`Attachment file not found: ${filePath}`);
      }
      const bytes = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      form.append(`files[${i}]`, new Blob([bytes]), fileName);
    }
    return discordRequest("POST", `/channels/${targetId}/messages`, { formData: form });
  }

  return discordRequest("POST", `/channels/${targetId}/messages`, { body: payload });
}

export async function sendMessage({
  content = "",
  alias,
  server,
  channel,
  thread,
  channelId,
  threadId,
  createThreadName,
  suppressEmbeds = false,
  files = [],
  from,
  includeSender,
  includeMachine,
} = {}) {
  const rawContent = String(content ?? "");
  if (!rawContent.trim() && (!files || files.length === 0)) {
    throw new Error("Message content cannot be empty unless attaching at least one file.");
  }

  const config = loadConfig();
  const formattedContent = rawContent.trim()
    ? formatWithSender(rawContent, { from, includeSender, includeMachine }, config)
    : "";

  const target = await resolveTarget({
    alias,
    server,
    channel,
    thread,
    channelId,
    threadId,
  });

  const chunks = formattedContent ? splitDiscordMessage(formattedContent) : [""];
  let postChannelId = target.targetId;
  let threadName = target.threadName;
  let firstMsg = null;
  let startIndex = 0;

  if (createThreadName) {
    if (FORUM_CHANNEL_TYPES.has(target.targetTypeId)) {
      const created = await discordRequest("POST", `/channels/${target.channelId}/threads`, {
        body: {
          name: createThreadName.slice(0, 100),
          auto_archive_duration: 1440,
          message: {
            content: chunks[0] || createThreadName,
            ...(suppressEmbeds ? { flags: 1 << 2 } : {}),
          },
        },
      });
      postChannelId = created.id;
      threadName = created.name;
      firstMsg = created.message || { id: created.last_message_id || created.id };
      startIndex = 1;
      if (files && files.length > 0) {
        await postSingleMessage(postChannelId, "", { suppressEmbeds, files });
      }
    } else {
      const created = await discordRequest("POST", `/channels/${target.channelId}/threads`, {
        body: {
          name: createThreadName.slice(0, 100),
          type: 11, // PUBLIC_THREAD
          auto_archive_duration: 1440,
        },
      });
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

  const sentMessages = firstMsg ? [firstMsg] : [];
  for (let i = startIndex; i < chunks.length; i++) {
    const chunkFiles = i === startIndex ? files : [];
    const msg = await postSingleMessage(postChannelId, chunks[i], {
      suppressEmbeds,
      files: chunkFiles,
    });
    sentMessages.push(msg);
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
    url,
  };
}

export async function setDefault({ server, channel, thread, channelId, threadId } = {}) {
  const config = loadConfig();

  // If clearing thread explicitly when only channel is changed
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
    configPath: CONFIG_PATH,
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
