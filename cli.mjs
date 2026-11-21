#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_VERSION,
  getConfigDir,
  getConfigPath,
  getTokenPath,
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
  verifyAndSaveToken,
  verifyBot,
  hasToken,
} from "./lib/discord.mjs";

const BOOL_FLAGS = new Set([
  "json",
  "stdin",
  "archived",
  "suppress-embeds",
  "no-attach-long",
  "no-sender",
  "include-machine",
  "no-machine",
  "enable",
  "disable",
  "auto",
  "help",
  "version",
]);

const VALUE_FLAGS = new Set([
  "alias",
  "server",
  "channel",
  "channel-id",
  "thread",
  "thread-id",
  "create-thread",
  "message-file",
  "code-file",
  "lines",
  "reply-to",
  "file",
  "from",
  "description",
  "token-file",
  "limit",
]);

export function parseArgs(argv) {
  const positional = [];
  const flags = { file: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "-v") {
      flags.version = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      let key;
      let val;
      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        val = arg.slice(eqIdx + 1);
        if (BOOL_FLAGS.has(key)) {
          throw new Error(`Flag --${key} does not take a value.`);
        }
        if (!VALUE_FLAGS.has(key)) {
          throw new Error(`Unknown flag: --${key}. Run with --help to see valid flags.`);
        }
      } else {
        key = arg.slice(2);
        if (BOOL_FLAGS.has(key)) {
          val = true;
        } else if (VALUE_FLAGS.has(key)) {
          const next = argv[i + 1];
          if (next === undefined || next.startsWith("--")) {
            throw new Error(`Flag --${key} requires a value.`);
          }
          val = argv[++i];
        } else {
          throw new Error(`Unknown flag: --${key}. Run with --help to see valid flags.`);
        }
      }

      if (key === "file") {
        flags.file.push(val);
      } else {
        flags[key] = val;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function printHelp() {
  console.log(`t3-discord v${APP_VERSION} — Send & read Discord messages from AI coding tools

Usage:
  discord-send status [--json]
  discord-send doctor [--json]
  discord-send invite [--json]
  discord-send guilds [--json]
  discord-send channels [--server <name|id>] [--json]
  discord-send threads [--server <name|id>] [--channel <name|id>] [--archived] [--json]
  discord-send read [--alias <name> | --server <s|id> --channel <c|id> --thread <t|id>] [--limit <1-25>] [--json]
  discord-send send [message] [options]
    --alias <name>              Use a saved destination alias
    --server <name|id>          Target server (guild) name or ID
    --channel <name|id>         Target channel name or ID
    --thread <name|id>          Target thread name or ID
    --create-thread <name>      Create a new thread in the target channel
    --reply-to <id|url>         Reply to a Discord message ID or link
    --code-file <path[:a-b]>    Read a local file (or line range) as a formatted code block
    --lines <start-end>         Line range for --code-file (e.g. 40-80)
    --message-file <path>       Read message text from a UTF-8 file
    --stdin                     Read message text from stdin
    --file <path>               Attach a local file (absolute path, repeatable, max 10)
    --no-attach-long            Split >3-chunk messages instead of uploading as snippet file
    --from <name>               Override sender name for this message
    --no-sender                 Send without prepending sender name
    --suppress-embeds           Disable link preview embeds
    --json                      Output JSON
  discord-send set-default [--server <name|id>] [--channel <name|id>] [--thread <name|id>] [--json]
  discord-send set-sender [name] [--auto] [--include-machine|--no-machine] [--enable|--disable] [--json]
  discord-send alias list [--json]
  discord-send alias set <name> [--server <name|id>] [--channel <name|id>] [--thread <name|id>] [--description <text>] [--json]
  discord-send alias remove <name> [--json]
  discord-send set-token --token-file <path> [--json]
`);
}

function output(data, asJson, humanFormatter) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(humanFormatter(data));
  }
}

async function runDoctor() {
  const checks = [];
  const majorNode = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: majorNode >= 18,
    detail: `v${process.versions.node} (${process.execPath})`,
  });

  const tokPath = getTokenPath();
  const tokenPresent = hasToken();
  checks.push({
    name: "token",
    ok: tokenPresent,
    detail: tokenPresent
      ? process.env.T3_DISCORD_TOKEN
        ? "T3_DISCORD_TOKEN env var"
        : process.env.DISCORD_BOT_TOKEN
          ? "DISCORD_BOT_TOKEN env var"
          : tokPath
      : `Missing (${tokPath})`,
  });

  let bot = null;
  let guilds = [];
  if (tokenPresent) {
    try {
      bot = await verifyBot();
      guilds = await listGuilds();
      checks.push({
        name: "discord-api",
        ok: true,
        detail: `Connected as "${bot.username}" (${bot.id}), ${guilds.length} server(s)`,
      });
    } catch (err) {
      checks.push({ name: "discord-api", ok: false, detail: err.message });
    }
  }

  const cfg = loadConfig();
  if (cfg.defaultChannelId || cfg.defaultThreadId) {
    try {
      const target = await resolveTarget({});
      const dest = target.threadId
        ? `${target.guildName || target.guildId} / #${target.channelName || target.channelId} > "${target.threadName}"`
        : `${target.guildName || target.guildId} / #${target.channelName || target.channelId}`;
      checks.push({ name: "default-target", ok: true, detail: dest });
    } catch (err) {
      checks.push({ name: "default-target", ok: false, detail: err.message });
    }
  } else {
    checks.push({
      name: "default-target",
      ok: false,
      detail: "No default channel set (run set-default)",
    });
  }

  const cfgDir = getConfigDir();
  const mcpExists = fs.existsSync(path.join(cfgDir, "mcp-server.mjs"));
  checks.push({
    name: "installed-files",
    ok: mcpExists,
    detail: mcpExists ? cfgDir : `mcp-server.mjs not found in ${cfgDir}`,
  });

  return {
    ok: checks.every((c) => c.ok),
    version: APP_VERSION,
    configPath: getConfigPath(),
    inviteUrl: bot?.inviteUrl || null,
    checks,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const asJson = Boolean(flags.json);

  if (flags.version) {
    console.log(APP_VERSION);
    return;
  }

  if (!cmd || cmd === "help" || flags.help) {
    printHelp();
    return;
  }

  if (cmd === "status") {
    const status = await getStatus();
    output(status, asJson, (s) => {
      const lines = [];
      lines.push(`t3-discord v${s.version}`);
      lines.push(`Token configured: ${s.tokenConfigured ? "yes" : "no"}`);
      if (s.bot) {
        lines.push(`Bot: ${s.bot.username} (${s.bot.id})`);
      }
      if (s.error) {
        lines.push(`Error: ${s.error}`);
      }
      if (s.guilds.length > 0) {
        lines.push(
          `Servers (${s.guilds.length}): ${s.guilds
            .map((g) => `${g.name} (${g.id})`)
            .join(", ")}`
        );
      } else if (s.bot?.inviteUrl) {
        lines.push(`Servers (0): Invite bot -> ${s.bot.inviteUrl}`);
      }
      const d = s.defaultTarget;
      if (d.threadId) {
        lines.push(
          `Default: ${d.guildName || d.guildId} / #${d.channelName || d.channelId} > thread "${d.threadName || d.threadId}" (${d.threadId})`
        );
      } else if (d.channelId) {
        lines.push(
          `Default: ${d.guildName || d.guildId} / #${d.channelName || d.channelId} (${d.channelId})`
        );
      } else {
        lines.push("Default: (not set)");
      }
      const aliasNames = Object.keys(s.aliases);
      lines.push(
        `Aliases (${aliasNames.length}): ${aliasNames.length ? aliasNames.join(", ") : "(none)"}`
      );
      if (s.sender) {
        const mode = !s.sender.includeSender
          ? "disabled"
          : `${s.sender.effectiveName}${
              s.sender.includeMachine && s.sender.host ? ` (${s.sender.host})` : ""
            } [source: ${s.sender.source}]`;
        lines.push(`Sender: ${mode}`);
      }
      lines.push(`Config: ${s.configPath}`);
      return lines.join("\n");
    });
    return;
  }

  if (cmd === "doctor") {
    const report = await runDoctor();
    output(report, asJson, (r) => {
      const lines = [`t3-discord doctor (v${r.version})`];
      for (const c of r.checks) {
        lines.push(`  [${c.ok ? "OK" : "FAIL"}] ${c.name}: ${c.detail}`);
      }
      if (r.inviteUrl) {
        lines.push(`  Invite URL: ${r.inviteUrl}`);
      }
      return lines.join("\n");
    });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "invite") {
    const bot = await verifyBot();
    output({ botId: bot.id, username: bot.username, inviteUrl: bot.inviteUrl }, asJson, (r) =>
      `Bot: ${r.username} (${r.botId})\nInvite URL: ${r.inviteUrl}`
    );
    return;
  }

  if (cmd === "set-token") {
    const tokenFile = flags["token-file"];
    let rawToken = "";
    if (tokenFile) {
      rawToken = fs.readFileSync(tokenFile, "utf8");
    } else if (flags.stdin) {
      rawToken = await readStdin();
    } else {
      throw new Error(
        "Use --token-file <path> or --stdin to save the bot token securely."
      );
    }
    const res = await verifyAndSaveToken(rawToken);
    output(res, asJson, (r) => {
      const serverList = r.guilds.length
        ? r.guilds.map((g) => `${g.name} (${g.id})`).join(", ")
        : `(none yet — invite here: ${r.inviteUrl})`;
      const warn = r.permissionWarning ? `\nWarning: ${r.permissionWarning}` : "";
      return `Token verified and saved!\nBot: ${r.bot.username} (${r.bot.id})\nServers: ${serverList}${warn}`;
    });
    return;
  }

  if (cmd === "guilds" || cmd === "servers") {
    const guilds = await listGuilds();
    output(guilds, asJson, (gs) =>
      gs.length
        ? gs.map((g) => `${g.name}  (id: ${g.id})`).join("\n")
        : "No servers found. Invite your bot to your Discord server first (run `invite` for the URL)."
    );
    return;
  }

  if (cmd === "channels") {
    const guild = await resolveGuild(flags.server);
    const channels = await listChannels(guild.id);
    output({ guild, channels }, asJson, ({ guild: g, channels: chs }) => {
      if (chs.length === 0) return `No accessible channels in ${g.name}.`;
      return (
        `Channels in ${g.name} (${g.id}):\n` +
        chs
          .map(
            (c) =>
              `  #${c.name} [${c.type}]${c.category ? ` (${c.category})` : ""} — id: ${c.id}`
          )
          .join("\n")
      );
    });
    return;
  }

  if (cmd === "threads") {
    const guild = await resolveGuild(flags.server);
    const cfg = loadConfig();
    let channelId;
    if (flags.channel) {
      const target = await resolveTarget({ server: guild.id, channel: flags.channel });
      channelId = target.channelId;
    } else if (flags.archived && cfg.defaultChannelId && (!cfg.defaultGuildId || cfg.defaultGuildId === guild.id)) {
      channelId = cfg.defaultChannelId;
    }
    const threads = await listThreads({
      guildId: guild.id,
      channelId,
      includeArchived: Boolean(flags.archived),
    });
    output({ guild, threads }, asJson, ({ guild: g, threads: ts }) => {
      if (ts.length === 0) return `No threads found in ${g.name}.`;
      return (
        `Threads in ${g.name}:\n` +
        ts
          .map(
            (t) =>
              `  "${t.name}" in #${t.parentName || t.parentId || "?"} [${
                t.archived ? "archived" : "active"
              }] — id: ${t.id}`
          )
          .join("\n")
      );
    });
    return;
  }

  if (cmd === "read") {
    const res = await readMessages({
      alias: flags.alias,
      server: flags.server,
      channel: flags.channel,
      thread: flags.thread,
      channelId: flags["channel-id"],
      threadId: flags["thread-id"],
      limit: flags.limit ? Number(flags.limit) : 10,
    });
    output(res, asJson, (r) => {
      const dest = r.threadId
        ? `${r.guildName || r.guildId} / #${r.channelName || r.channelId} > "${r.threadName || r.threadId}"`
        : `${r.guildName || r.guildId} / #${r.channelName || r.channelId}`;
      if (r.messages.length === 0) return `No messages in ${dest}.`;
      const lines = [`Recent messages in ${dest} (${r.messages.length}):`];
      for (const m of r.messages) {
        const ts = m.timestamp ? m.timestamp.slice(0, 16).replace("T", " ") : "";
        const att =
          m.attachments.length > 0
            ? ` [attachments: ${m.attachments.map((a) => a.filename).join(", ")}]`
            : "";
        lines.push(`  [${ts}] ${m.author} (${m.id}): ${m.content || "(empty)"}${att}`);
      }
      if (r.note) lines.push(`\nNote: ${r.note}`);
      return lines.join("\n");
    });
    return;
  }

  if (cmd === "send") {
    let content = "";
    if (flags["message-file"]) {
      content = fs.readFileSync(flags["message-file"], "utf8");
    } else if (flags.stdin) {
      content = await readStdin();
    } else {
      content = positional.slice(1).join(" ");
    }

    const res = await sendMessage({
      content,
      codeFile: flags["code-file"],
      lines: flags.lines,
      alias: flags.alias,
      server: flags.server,
      channel: flags.channel,
      thread: flags.thread,
      channelId: flags["channel-id"],
      threadId: flags["thread-id"],
      createThreadName: flags["create-thread"],
      replyTo: flags["reply-to"],
      suppressEmbeds: Boolean(flags["suppress-embeds"]),
      attachLong: !flags["no-attach-long"],
      files: flags.file,
      from: flags.from,
      includeSender: flags["no-sender"] ? false : undefined,
      includeMachine: flags["include-machine"]
        ? true
        : flags["no-machine"]
          ? false
          : undefined,
    });

    output(res, asJson, (r) => {
      const dest = r.threadId
        ? `${r.guildName || r.guildId} / #${r.channelName || r.channelId} > "${r.threadName || r.threadId}"`
        : `${r.guildName || r.guildId} / #${r.channelName || r.channelId}`;
      const suffix = r.uploadedAsFile
        ? " (uploaded as snippet file)"
        : r.chunksSent > 1
          ? ` (${r.chunksSent} messages)`
          : "";
      return `Sent to ${dest}${suffix}${r.url ? `\nLink: ${r.url}` : ""}`;
    });
    return;
  }

  if (cmd === "set-sender") {
    const nameArg = positional.slice(1).join(" ").trim();
    const res = setSender({
      name: nameArg ? nameArg : undefined,
      clearName: Boolean(flags.auto),
      includeSender: flags.disable ? false : flags.enable ? true : undefined,
      includeMachine: flags["include-machine"]
        ? true
        : flags["no-machine"]
          ? false
          : undefined,
    });
    output(res, asJson, (r) => {
      if (!r.includeSender) return "Sender prefix disabled.";
      const mach = r.includeMachine && r.host ? ` (${r.host})` : "";
      return `Sender set to **${r.effectiveSender}**${mach} (source: ${r.source})`;
    });
    return;
  }

  if (cmd === "set-default") {
    const res = await setDefault({
      server: flags.server,
      channel: flags.channel,
      thread: flags.thread,
      channelId: flags["channel-id"],
      threadId: flags["thread-id"],
    });
    output(res, asJson, (d) =>
      d.defaultThreadId
        ? `Default set to ${d.defaultGuildName || d.defaultGuildId} / #${d.defaultChannelName || d.defaultChannelId} > thread "${d.defaultThreadName}" (${d.defaultThreadId})`
        : `Default set to ${d.defaultGuildName || d.defaultGuildId} / #${d.defaultChannelName || d.defaultChannelId} (${d.defaultChannelId})`
    );
    return;
  }

  if (cmd === "alias") {
    const sub = positional[1];
    if (sub === "list" || !sub) {
      const cfg = loadConfig();
      output(cfg.aliases, asJson, (aliases) => {
        const entries = Object.entries(aliases);
        if (entries.length === 0) return "No aliases configured.";
        return entries
          .map(([name, a]) => {
            const target = a.threadId
              ? `#${a.channelName || a.channelId} > "${a.threadName || a.threadId}"`
              : `#${a.channelName || a.channelId}`;
            return `  ${name} -> ${a.guildName || a.guildId} / ${target}${
              a.description ? ` — ${a.description}` : ""
            }`;
          })
          .join("\n");
      });
      return;
    }
    if (sub === "set") {
      const name = positional[2];
      const res = await setAlias({
        name,
        server: flags.server,
        channel: flags.channel,
        thread: flags.thread,
        channelId: flags["channel-id"],
        threadId: flags["thread-id"],
        description: flags.description || "",
      });
      output(res, asJson, (a) => {
        const target = a.threadId
          ? `#${a.channelName || a.channelId} > "${a.threadName || a.threadId}"`
          : `#${a.channelName || a.channelId}`;
        return `Alias "${a.name}" saved -> ${a.guildName || a.guildId} / ${target}`;
      });
      return;
    }
    if (sub === "remove" || sub === "rm" || sub === "delete") {
      const name = positional[2];
      const res = removeAlias(name);
      output(res, asJson, (r) =>
        r.removed ? `Removed alias "${r.name}".` : `Alias "${r.name}" not found.`
      );
      return;
    }
    throw new Error(`Unknown alias subcommand "${sub}". Use list, set, or remove.`);
  }

  throw new Error(`Unknown command "${cmd}". Run with --help for usage.`);
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
