#!/usr/bin/env node
import readline from "node:readline";
import {
  getStatus,
  listGuilds,
  listChannels,
  listThreads,
  resolveGuild,
  resolveTarget,
  sendMessage,
  setDefault,
  setSender,
  setAlias,
  removeAlias,
  loadConfig,
} from "./lib/discord.mjs";

const SERVER_INFO = {
  name: "t3-discord",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "discord_status",
    description:
      "Check Discord bot connection status, accessible servers, current default channel/thread, and saved aliases.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "discord_list_servers",
    description: "List all Discord servers (guilds) the bot has joined.",
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
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Server name or ID (optional if a default server is set or bot is in 1 server).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_list_threads",
    description:
      "List active (and optionally archived) threads in a Discord server or within a specific channel.",
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
          description: "Also include archived threads (requires channel to be specified).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_send_message",
    description:
      "Send a message (code snippet, link, note, or optional file attachments) to Discord. Omit destination parameters to send to the configured default channel/thread, or target by alias, server, channel, and/or thread name/ID. Long messages (>2000 chars) are automatically split while preserving fenced code blocks.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Message text (supports Discord Markdown and fenced code blocks).",
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
          description: "Create a new thread with this name inside the target channel and post the message there (optional).",
        },
        suppressEmbeds: {
          type: "boolean",
          description: "Suppress link preview embeds (optional, default false).",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of absolute local file paths to attach.",
        },
        from: {
          type: "string",
          description: "Optional sender name override for this message (defaults to configured senderName or auto-detected git/machine name).",
        },
        includeSender: {
          type: "boolean",
          description: "Set to false to omit the sender name prefix on this message (optional).",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "discord_set_sender",
    description:
      "Configure who messages appear from when sharing a Discord bot across multiple machines/people. By default auto-detects from git user.name, OS username, or computer hostname.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Custom sender display name (e.g. 'Siposko' or 'Matelko').",
        },
        clearName: {
          type: "boolean",
          description: "Clear custom name and return to automatic git/machine detection.",
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
    name: "discord_set_default",
    description:
      "Set the default Discord server, channel, and/or thread used when sending messages without specifying a destination.",
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
          description: "Thread name or ID (optional; omit to default to the channel itself).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "discord_manage_alias",
    description:
      "List, set, or remove named Discord destination aliases (e.g. 'friend', 'snippets', 'backend').",
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

async function handleToolCall(name, args = {}) {
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
      let channelId;
      if (args.channel) {
        const target = await resolveTarget({ server: guild.id, channel: args.channel });
        channelId = target.channelId;
      }
      const threads = await listThreads({
        guildId: guild.id,
        channelId,
        includeArchived: Boolean(args.includeArchived),
      });
      return okResult({ guild, threads });
    }

    case "discord_send_message":
      return okResult(
        await sendMessage({
          content: args.content,
          alias: args.alias,
          server: args.server,
          channel: args.channel,
          thread: args.thread,
          createThreadName: args.createThreadName,
          suppressEmbeds: Boolean(args.suppressEmbeds),
          files: Array.isArray(args.files) ? args.files : [],
          from: args.from,
          includeSender: args.includeSender,
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

    case "discord_set_default":
      return okResult(
        await setDefault({
          server: args.server,
          channel: args.channel,
          thread: args.thread,
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
      const requestedVersion = params?.protocolVersion || "2024-11-05";
      sendJson({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: requestedVersion,
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
      const toolArgs = params?.arguments || {};
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
  handleRequest(parsed).catch((err) => {
    process.stderr.write(`[t3-discord-mcp] Unhandled error: ${err.message}\n`);
  });
});

process.stdin.on("end", () => {
  process.exit(0);
});
