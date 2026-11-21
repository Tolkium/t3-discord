#!/usr/bin/env node
import readline from "node:readline";
import {
  APP_VERSION,
  getStatus,
  listGuilds,
  listChannels,
  listThreadsForQuery,
  resolveGuild,
  formatDestination,
  sendMessage,
  readMessages,
  setDefault,
  setSender,
  setAlias,
  removeAlias,
  loadConfig,
} from "./lib/discord.mjs";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "t3-discord", version: APP_VERSION };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const CONFIG_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const DEST_PROPS = {
  alias: { type: "string", description: "Saved destination alias name (optional)." },
  server: { type: "string", description: "Server (guild) name or ID (optional)." },
  channel: { type: "string", description: "Channel name (with or without #) or ID (optional)." },
  thread: { type: "string", description: "Thread name or ID (optional)." },
};

const TOOLS = [
  {
    name: "discord_status",
    description: "Check Discord bot connection, accessible servers, sender name, default channel/thread, and aliases.",
    annotations: READ_ONLY,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "discord_list_servers",
    description: "List all Discord servers (guilds) the bot has joined.",
    annotations: READ_ONLY,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "discord_list_channels",
    description: "List channels in a Discord server. Omit server to use the default or sole server.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: { server: DEST_PROPS.server },
      additionalProperties: false,
    },
  },
  {
    name: "discord_list_threads",
    description: "List active (and optionally archived) threads in a server or channel.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        server: DEST_PROPS.server,
        channel: DEST_PROPS.channel,
        includeArchived: { type: "boolean", description: "Include archived threads (uses channel or default channel)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_read_messages",
    description:
      "Read recent messages (1-25, default 10) from the default or specified Discord channel/thread. Note: reading non-bot human messages requires Message Content Intent in Discord Developer Portal.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        ...DEST_PROPS,
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Number of recent messages (1-25, default 10)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_send_message",
    description:
      "Send a message, source file line range (codeFile/lines), link, or file attachments to Discord. Omit destination to use the configured default. Auto-splits >2000 chars with intact code fences and auto-uploads >3-chunk snippets as an attachment.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message text (optional if files or codeFile is provided)." },
        codeFile: { type: "string", description: "Absolute path to a local file (optionally with :start-end, e.g. /abs/app.ts:40-80)." },
        lines: { type: "string", description: "Optional line range for codeFile (e.g. '40-80' or '42')." },
        ...DEST_PROPS,
        createThreadName: { type: "string", description: "Create a new thread in the target channel and post there." },
        replyTo: { type: "string", description: "Discord message ID or full message URL to reply to." },
        suppressEmbeds: { type: "boolean", description: "Disable link preview embeds (default false)." },
        attachLong: { type: "boolean", description: "Upload >3-chunk messages as an inline text attachment (default true)." },
        files: { type: "array", items: { type: "string" }, description: "Absolute local file paths to attach (max 10, 10 MiB each)." },
        from: { type: "string", description: "Override sender name for this message." },
        includeSender: { type: "boolean", description: "Set false to omit sender name prefix." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_set_default",
    description: "Set the default Discord server, channel, and/or thread.",
    annotations: CONFIG_WRITE,
    inputSchema: {
      type: "object",
      properties: { server: DEST_PROPS.server, channel: DEST_PROPS.channel, thread: DEST_PROPS.thread },
      additionalProperties: false,
    },
  },
  {
    name: "discord_set_sender",
    description: "Configure sender display name for shared-bot attribution (defaults to auto-detected git/OS/hostname).",
    annotations: CONFIG_WRITE,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Custom sender display name (e.g. 'Alice')." },
        clearName: { type: "boolean", description: "Clear custom name and return to auto-detection." },
        includeSender: { type: "boolean", description: "Enable or disable sender prefix." },
        includeMachine: { type: "boolean", description: "Also include computer hostname next to sender name." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_manage_alias",
    description: "List, set, or remove named Discord destination aliases (e.g. 'friend', 'snippets').",
    annotations: CONFIG_WRITE,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set", "remove"] },
        name: { type: "string", description: "Alias name (required for set/remove)." },
        server: DEST_PROPS.server,
        channel: DEST_PROPS.channel,
        thread: DEST_PROPS.thread,
        description: { type: "string", description: "Optional note for set." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
const sendJson = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const okResult = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const errorResult = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });

function validateArgs(toolName, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Invalid arguments for ${toolName}: expected an object.`);
  }
  const tool = TOOL_MAP.get(toolName);
  if (!tool) return;
  const allowed = tool.inputSchema.properties || {};
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(allowed, key)) throw new Error(`Unknown argument "${key}" for ${toolName}.`);
  }
}

async function handleToolCall(name, args = {}) {
  validateArgs(name, args);

  switch (name) {
    case "discord_status":
      return okResult(await getStatus());
    case "discord_list_servers":
      return okResult(await listGuilds());
    case "discord_list_channels": {
      const guild = await resolveGuild(args.server);
      return okResult({ guild, channels: await listChannels(guild.id) });
    }
    case "discord_list_threads":
      return okResult(await listThreadsForQuery({
        server: args.server,
        channel: args.channel,
        includeArchived: Boolean(args.includeArchived),
      }));
    case "discord_read_messages":
      return okResult(await readMessages(args));
    case "discord_send_message": {
      const res = await sendMessage({
        ...args,
        suppressEmbeds: Boolean(args.suppressEmbeds),
        attachLong: args.attachLong !== false,
        files: Array.isArray(args.files) ? args.files : [],
      });
      const extra = res.uploadedAsFile ? " (uploaded as snippet file)" : res.chunksSent > 1 ? ` (${res.chunksSent} messages)` : "";
      return okResult(`Sent to ${formatDestination(res)}${extra}${res.url ? ` -> ${res.url}` : ""}`);
    }
    case "discord_set_default":
      return okResult(await setDefault(args));
    case "discord_set_sender":
      return okResult(setSender({ ...args, clearName: Boolean(args.clearName) }));
    case "discord_manage_alias":
      if (args.action === "list") return okResult(loadConfig().aliases);
      if (args.action === "set") return okResult(await setAlias(args));
      if (args.action === "remove") return okResult(removeAlias(args.name));
      return errorResult(`Unknown alias action: ${args.action}`);
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function handleRequest(req) {
  const { id, method, params } = req;
  if (id === undefined || id === null) return; // JSON-RPC notification

  try {
    if (method === "initialize") {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
      return sendJson({ jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
    }
    if (method === "ping") return sendJson({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return sendJson({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "resources/list") return sendJson({ jsonrpc: "2.0", id, result: { resources: [] } });
    if (method === "prompts/list") return sendJson({ jsonrpc: "2.0", id, result: { prompts: [] } });
    if (method === "tools/call") {
      try {
        const result = await handleToolCall(params?.name, params?.arguments ?? {});
        return sendJson({ jsonrpc: "2.0", id, result });
      } catch (err) {
        return sendJson({ jsonrpc: "2.0", id, result: errorResult(err?.message || String(err)) });
      }
    }
    sendJson({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    sendJson({ jsonrpc: "2.0", id, error: { code: -32603, message: err?.message || "Internal error" } });
  }
}

let pending = 0;
let stdinClosed = false;
const maybeExit = () => { if (stdinClosed && pending === 0) process.exit(0); };

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch (err) {
    process.stderr.write(`[t3-discord-mcp] Invalid JSON: ${err.message}\n`);
    return;
  }
  pending++;
  handleRequest(parsed)
    .catch((err) => process.stderr.write(`[t3-discord-mcp] Unhandled error: ${err.message}\n`))
    .finally(() => { pending--; maybeExit(); });
});
rl.on("close", () => { stdinClosed = true; maybeExit(); });
