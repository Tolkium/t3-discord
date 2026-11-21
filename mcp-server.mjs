#!/usr/bin/env node
import readline from "node:readline";
import {
  APP_VERSION,
  getStatus,
  listGuilds,
  listChannels,
  listThreads,
  resolveGuild,
  resolveTarget,
  sendMessage,
  readMessages,
  setDefault,
  setSender,
  setAlias,
  removeAlias,
  loadConfig,
} from "./lib/discord.mjs";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "t3-discord",
  version: APP_VERSION,
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const CONFIG_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const TOOLS = [
  {
    name: "discord_status",
    description:
      "Check Discord bot connection status, accessible servers, sender name, current default channel/thread, and saved aliases.",
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "discord_list_servers",
    description: "List all Discord servers (guilds) the bot has joined.",
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "discord_list_channels",
    description:
      "List channels (text, announcement, forum, etc.) in a Discord server. Omit server to use the default or sole server.",
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description:
            "Server name or ID (optional if a default server is set or bot is in 1 server).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_list_threads",
    description:
      "List active (and optionally archived) threads in a Discord server or within a specific channel.",
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Server name or ID (optional).",
        },
        channel: {
          type: "string",
          description: "Filter threads to this parent channel name or ID (optional).",
        },
        includeArchived: {
          type: "boolean",
          description:
            "Also include archived threads (uses channel or configured default channel).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_read_messages",
    description:
      "Read recent messages (default 10, max 25) from the default Discord channel/thread or a specified alias, channel, or thread. Useful for checking what a friend pasted (note: reading non-bot human messages requires Message Content Intent enabled in Discord Developer Portal).",
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        alias: {
          type: "string",
          description: "Saved destination alias name (optional).",
        },
        server: {
          type: "string",
          description: "Server name or ID (optional).",
        },
        channel: {
          type: "string",
          description: "Channel name (with or without #) or ID (optional).",
        },
        thread: {
          type: "string",
          description: "Thread name or ID (optional).",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Number of recent messages to fetch (1-25, default 10).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_send_message",
    description:
      "Send a message, code file excerpt, link, or file attachments to Discord. Omit destination parameters to send to the configured default channel/thread, or target by alias, server, channel, and/or thread. Supports replying to a message, sending a file line range via codeFile/lines, auto-splitting >2000 chars with intact code fences, and auto-uploading >3-chunk snippets as an attachment.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "Message text (Discord Markdown / fenced code blocks). Optional if files or codeFile is provided.",
        },
        codeFile: {
          type: "string",
          description:
            "Absolute path to a local source file (optionally with :start-end suffix, e.g. /abs/path/app.ts:40-80) to format and send as a code block.",
        },
        lines: {
          type: "string",
          description:
            "Optional line range for codeFile (e.g. '40-80' or '42').",
        },
        alias: {
          type: "string",
          description: "Saved destination alias name (optional).",
        },
        server: {
          type: "string",
          description: "Server (guild) name or ID (optional).",
        },
        channel: {
          type: "string",
          description: "Channel name (with or without #) or channel ID (optional).",
        },
        thread: {
          type: "string",
          description: "Thread name or thread ID (optional).",
        },
        createThreadName: {
          type: "string",
          description:
            "Create a new thread with this name inside the target channel and post the message there (optional).",
        },
        replyTo: {
          type: "string",
          description:
            "Optional Discord message ID or full message URL to reply to.",
        },
        suppressEmbeds: {
          type: "boolean",
          description: "Suppress link preview embeds (optional, default false).",
        },
        attachLong: {
          type: "boolean",
          description:
            "When true (default), messages longer than 3 chunks are uploaded as an inline text file instead of flooding the channel.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of absolute local file paths to attach (max 10 files, 10 MiB each).",
        },
        from: {
          type: "string",
          description:
            "Optional sender name override for this message (defaults to configured senderName or auto-detected git/OS/machine name).",
        },
        includeSender: {
          type: "boolean",
          description:
            "Set to false to omit the sender name prefix on this message (optional).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_set_default",
    description:
      "Set the default Discord server, channel, and/or thread used when sending or reading messages without specifying a destination.",
    annotations: CONFIG_WRITE_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Server name or ID (optional if bot is in 1 server).",
        },
        channel: {
          type: "string",
          description: "Channel name or ID.",
        },
        thread: {
          type: "string",
          description:
            "Thread name or ID (optional; omit to default to the channel itself).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_set_sender",
    description:
      "Configure who messages appear from when sharing a Discord bot across multiple machines/people. By default auto-detects from git user.name, OS username, or computer hostname.",
    annotations: CONFIG_WRITE_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Custom sender display name (e.g. 'Alice' or 'Bob').",
        },
        clearName: {
          type: "boolean",
          description:
            "Clear custom name and return to automatic git/machine detection.",
        },
        includeSender: {
          type: "boolean",
          description: "Enable or disable the sender prefix on outgoing messages.",
        },
        includeMachine: {
          type: "boolean",
          description: "Also include the computer hostname next to the sender name.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_manage_alias",
    description:
      "List, set, or remove named Discord destination aliases (e.g. 'friend', 'snippets', 'backend').",
    annotations: CONFIG_WRITE_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "set", "remove"],
          description: "Operation to perform.",
        },
        name: {
          type: "string",
          description: "Alias name (required for set and remove).",
        },
        server: {
          type: "string",
          description: "Server name or ID (for set).",
        },
        channel: {
          type: "string",
          description: "Channel name or ID (for set).",
        },
        thread: {
          type: "string",
          description: "Thread name or ID (for set, optional).",
        },
        description: {
          type: "string",
          description: "Short note about this alias (for set, optional).",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
];

function sendJson(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function okResult(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function validateArgs(toolName, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Invalid arguments for ${toolName}: expected an object.`);
  }
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) return;
  const allowed = new Set(Object.keys(tool.inputSchema?.properties || {}));
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown argument "${key}" for ${toolName}.`);
    }
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
      const channels = await listChannels(guild.id);
      return okResult({ guild, channels });
    }

    case "discord_list_threads": {
      const guild = await resolveGuild(args.server);
      const cfg = loadConfig();
      let channelId;
      if (args.channel) {
        const target = await resolveTarget({
          server: guild.id,
          channel: args.channel,
        });
        channelId = target.channelId;
      } else if (
        args.includeArchived &&
        cfg.defaultChannelId &&
        (!cfg.defaultGuildId || cfg.defaultGuildId === guild.id)
      ) {
        channelId = cfg.defaultChannelId;
      }
      const threads = await listThreads({
        guildId: guild.id,
        channelId,
        includeArchived: Boolean(args.includeArchived),
      });
      return okResult({ guild, threads });
    }

    case "discord_read_messages":
      return okResult(
        await readMessages({
          alias: args.alias,
          server: args.server,
          channel: args.channel,
          thread: args.thread,
          limit: args.limit,
        })
      );

    case "discord_send_message": {
      const res = await sendMessage({
        content: args.content,
        codeFile: args.codeFile,
        lines: args.lines,
        alias: args.alias,
        server: args.server,
        channel: args.channel,
        thread: args.thread,
        createThreadName: args.createThreadName,
        replyTo: args.replyTo,
        suppressEmbeds: Boolean(args.suppressEmbeds),
        attachLong: args.attachLong !== false,
        files: Array.isArray(args.files) ? args.files : [],
        from: args.from,
        includeSender: args.includeSender,
      });
      const dest = res.threadId
        ? `${res.guildName || res.guildId} / #${res.channelName || res.channelId} > "${res.threadName || res.threadId}"`
        : `${res.guildName || res.guildId} / #${res.channelName || res.channelId}`;
      const extra = res.uploadedAsFile
        ? " (uploaded as snippet file)"
        : res.chunksSent > 1
          ? ` (${res.chunksSent} messages)`
          : "";
      return okResult(`Sent to ${dest}${extra}${res.url ? ` -> ${res.url}` : ""}`);
    }

    case "discord_set_default":
      return okResult(
        await setDefault({
          server: args.server,
          channel: args.channel,
          thread: args.thread,
        })
      );

    case "discord_set_sender":
      return okResult(
        setSender({
          name: args.name,
          clearName: Boolean(args.clearName),
          includeSender: args.includeSender,
          includeMachine: args.includeMachine,
        })
      );

    case "discord_manage_alias": {
      if (args.action === "list") {
        return okResult(loadConfig().aliases);
      }
      if (args.action === "set") {
        return okResult(
          await setAlias({
            name: args.name,
            server: args.server,
            channel: args.channel,
            thread: args.thread,
            description: args.description || "",
          })
        );
      }
      if (args.action === "remove") {
        return okResult(removeAlias(args.name));
      }
      return errorResult(`Unknown alias action: ${args.action}`);
    }

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

async function handleRequest(req) {
  const { id, method, params } = req;

  // Notifications have no id
  if (id === undefined || id === null) {
    return;
  }

  try {
    if (method === "initialize") {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      sendJson({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    }

    if (method === "ping") {
      sendJson({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      sendJson({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      try {
        const result = await handleToolCall(toolName, toolArgs);
        sendJson({ jsonrpc: "2.0", id, result });
      } catch (err) {
        sendJson({
          jsonrpc: "2.0",
          id,
          result: errorResult(err?.message || String(err)),
        });
      }
      return;
    }

    if (method === "resources/list") {
      sendJson({ jsonrpc: "2.0", id, result: { resources: [] } });
      return;
    }

    if (method === "prompts/list") {
      sendJson({ jsonrpc: "2.0", id, result: { prompts: [] } });
      return;
    }

    sendJson({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  } catch (err) {
    sendJson({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err?.message || "Internal error",
      },
    });
  }
}

let pendingRequests = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && pendingRequests === 0) {
    process.exit(0);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    process.stderr.write(`[t3-discord-mcp] Invalid JSON: ${err.message}\n`);
    return;
  }
  pendingRequests++;
  handleRequest(parsed)
    .catch((err) => {
      process.stderr.write(`[t3-discord-mcp] Unhandled error: ${err.message}\n`);
    })
    .finally(() => {
      pendingRequests--;
      maybeExit();
    });
});

rl.on("close", () => {
  stdinEnded = true;
  maybeExit();
});
