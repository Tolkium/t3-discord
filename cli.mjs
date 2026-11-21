#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION,
  getConfigDir,
  getConfigPath,
  getTokenPath,
  getStatus,
  listGuilds,
  listChannels,
  listThreadsForQuery,
  resolveGuild,
  resolveTarget,
  formatDestination,
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
  "json", "stdin", "archived", "suppress-embeds", "no-attach-long",
  "no-sender", "include-machine", "no-machine", "enable", "disable", "auto", "help", "version",
]);

const VALUE_FLAGS = new Set([
  "alias", "server", "channel", "channel-id", "thread", "thread-id", "create-thread",
  "message-file", "code-file", "lines", "reply-to", "file", "from", "description", "token-file", "limit",
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
    if (arg === "-h") { flags.help = true; continue; }
    if (arg === "-v") { flags.version = true; continue; }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let val;

    if (eq !== -1) {
      if (BOOL_FLAGS.has(key)) throw new Error(`Flag --${key} does not take a value.`);
      if (!VALUE_FLAGS.has(key)) throw new Error(`Unknown flag: --${key}. Run with --help to see valid flags.`);
      val = arg.slice(eq + 1);
    } else if (BOOL_FLAGS.has(key)) {
      val = true;
    } else if (VALUE_FLAGS.has(key)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`Flag --${key} requires a value.`);
      val = argv[++i];
    } else {
      throw new Error(`Unknown flag: --${key}. Run with --help to see valid flags.`);
    }

    if (key === "file") flags.file.push(val);
    else flags[key] = val;
  }
  return { positional, flags };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function printHelp() {
  console.log(`t3-discord v${APP_VERSION} — Send & read Discord messages from AI coding tools

Usage:
  discord-send status | doctor | invite | guilds [--json]
  discord-send channels [--server <name|id>] [--json]
  discord-send threads [--server <name|id>] [--channel <name|id>] [--archived] [--json]
  discord-send read [--alias <name> | --server <s> --channel <c> --thread <t>] [--limit <1-25>] [--json]
  discord-send send [message] [options]
    --alias <name>              Use a saved destination alias
    --server <name|id>          Target server name or ID
    --channel <name|id>         Target channel name or ID
    --thread <name|id>          Target thread name or ID
    --create-thread <name>      Create a new thread in the target channel
    --reply-to <id|url>         Reply to a Discord message ID or link
    --code-file <path[:a-b]>    Format a local file (or line range) as a code block
    --lines <start-end>         Line range for --code-file (e.g. 40-80)
    --message-file <path>       Read message text from a UTF-8 file
    --stdin                     Read message text from stdin
    --file <path>               Attach a local file (absolute path, repeatable, max 10)
    --no-attach-long            Split >3-chunk messages instead of uploading as snippet file
    --from <name>               Override sender name for this message
    --no-sender                 Send without prepending sender name
    --suppress-embeds           Disable link preview embeds
    --json                      Output JSON
  discord-send set-default [--server <s>] [--channel <c>] [--thread <t>] [--json]
  discord-send set-sender [name] [--auto] [--include-machine|--no-machine] [--enable|--disable] [--json]
  discord-send alias list | set <name> [...] | remove <name> [--json]
  discord-send set-token (--token-file <path> | --stdin) [--json]`);
}

function output(data, asJson, format) {
  console.log(asJson ? JSON.stringify(data, null, 2) : format(data));
}

async function runDoctor() {
  const checks = [];
  const majorNode = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: majorNode >= 18, detail: `v${process.versions.node} (${process.execPath})` });

  const tokPath = getTokenPath();
  const tokenPresent = hasToken();
  const tokSource = process.env.T3_DISCORD_TOKEN
    ? "T3_DISCORD_TOKEN env"
    : process.env.DISCORD_BOT_TOKEN
      ? "DISCORD_BOT_TOKEN env"
      : tokPath;
  checks.push({ name: "token", ok: tokenPresent, detail: tokenPresent ? tokSource : `Missing (${tokPath})` });

  let bot = null;
  if (tokenPresent) {
    try {
      bot = await verifyBot();
      const guilds = await listGuilds();
      checks.push({ name: "discord-api", ok: true, detail: `Connected as "${bot.username}" (${bot.id}), ${guilds.length} server(s)` });
    } catch (err) {
      checks.push({ name: "discord-api", ok: false, detail: err.message });
    }
  }

  const cfg = loadConfig();
  if (cfg.defaultChannelId || cfg.defaultThreadId) {
    try {
      checks.push({ name: "default-target", ok: true, detail: formatDestination(await resolveTarget({})) });
    } catch (err) {
      checks.push({ name: "default-target", ok: false, detail: err.message });
    }
  } else {
    checks.push({ name: "default-target", ok: false, detail: "No default channel set (run set-default)" });
  }

  const cfgDir = getConfigDir();
  const mcpExists = fs.existsSync(path.join(cfgDir, "mcp-server.mjs"));
  checks.push({ name: "installed-files", ok: mcpExists, detail: mcpExists ? cfgDir : `mcp-server.mjs not found in ${cfgDir}` });

  return { ok: checks.every((c) => c.ok), version: APP_VERSION, configPath: getConfigPath(), inviteUrl: bot?.inviteUrl || null, checks };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const asJson = Boolean(flags.json);

  if (flags.version) return console.log(APP_VERSION);
  if (!cmd || cmd === "help" || flags.help) return printHelp();

  switch (cmd) {
    case "status": {
      const s = await getStatus();
      return output(s, asJson, () => {
        const d = s.defaultTarget;
        const lines = [
          `t3-discord v${s.version}`,
          `Token configured: ${s.tokenConfigured ? "yes" : "no"}`,
          ...(s.bot ? [`Bot: ${s.bot.username} (${s.bot.id})`] : []),
          ...(s.error ? [`Error: ${s.error}`] : []),
          s.guilds.length
            ? `Servers (${s.guilds.length}): ${s.guilds.map((g) => `${g.name} (${g.id})`).join(", ")}`
            : s.bot?.inviteUrl
              ? `Servers (0): Invite bot -> ${s.bot.inviteUrl}`
              : "Servers (0)",
          d.channelId || d.threadId
            ? `Default: ${formatDestination({ guildId: d.guildId, guildName: d.guildName, channelId: d.channelId, channelName: d.channelName, threadId: d.threadId, threadName: d.threadName })} (${d.threadId || d.channelId})`
            : "Default: (not set)",
          `Aliases (${Object.keys(s.aliases).length}): ${Object.keys(s.aliases).join(", ") || "(none)"}`,
          `Sender: ${!s.sender.includeSender ? "disabled" : `${s.sender.effectiveName}${s.sender.includeMachine && s.sender.host ? ` (${s.sender.host})` : ""} [source: ${s.sender.source}]`}`,
          `Config: ${s.configPath}`,
        ];
        return lines.join("\n");
      });
    }

    case "doctor": {
      const r = await runDoctor();
      output(r, asJson, () => [
        `t3-discord doctor (v${r.version})`,
        ...r.checks.map((c) => `  [${c.ok ? "OK" : "FAIL"}] ${c.name}: ${c.detail}`),
        ...(r.inviteUrl ? [`  Invite URL: ${r.inviteUrl}`] : []),
      ].join("\n"));
      if (!r.ok) process.exitCode = 1;
      return;
    }

    case "invite": {
      const bot = await verifyBot();
      return output({ botId: bot.id, username: bot.username, inviteUrl: bot.inviteUrl }, asJson, (r) =>
        `Bot: ${r.username} (${r.botId})\nInvite URL: ${r.inviteUrl}`
      );
    }

    case "set-token": {
      const rawToken = flags["token-file"]
        ? fs.readFileSync(flags["token-file"], "utf8")
        : flags.stdin
          ? await readStdin()
          : (() => { throw new Error("Use --token-file <path> or --stdin to save the bot token securely."); })();
      const r = await verifyAndSaveToken(rawToken);
      return output(r, asJson, () => {
        const servers = r.guilds.length
          ? r.guilds.map((g) => `${g.name} (${g.id})`).join(", ")
          : `(none yet — invite here: ${r.inviteUrl})`;
        return `Token verified and saved!\nBot: ${r.bot.username} (${r.bot.id})\nServers: ${servers}${r.permissionWarning ? `\nWarning: ${r.permissionWarning}` : ""}`;
      });
    }

    case "guilds":
    case "servers": {
      const gs = await listGuilds();
      return output(gs, asJson, () =>
        gs.length
          ? gs.map((g) => `${g.name}  (id: ${g.id})`).join("\n")
          : "No servers found. Invite your bot first (run `invite` for the URL)."
      );
    }

    case "channels": {
      const guild = await resolveGuild(flags.server);
      const channels = await listChannels(guild.id);
      return output({ guild, channels }, asJson, () =>
        channels.length === 0
          ? `No accessible channels in ${guild.name}.`
          : `Channels in ${guild.name} (${guild.id}):\n` +
            channels.map((c) => `  #${c.name} [${c.type}]${c.category ? ` (${c.category})` : ""} — id: ${c.id}`).join("\n")
      );
    }

    case "threads": {
      const res = await listThreadsForQuery({
        server: flags.server,
        channel: flags.channel,
        includeArchived: Boolean(flags.archived),
      });
      return output(res, asJson, ({ guild, threads }) =>
        threads.length === 0
          ? `No threads found in ${guild.name}.`
          : `Threads in ${guild.name}:\n` +
            threads.map((t) => `  "${t.name}" in #${t.parentName || t.parentId || "?"} [${t.archived ? "archived" : "active"}] — id: ${t.id}`).join("\n")
      );
    }

    case "read": {
      const r = await readMessages({
        alias: flags.alias,
        server: flags.server,
        channel: flags.channel,
        thread: flags.thread,
        channelId: flags["channel-id"],
        threadId: flags["thread-id"],
        limit: flags.limit ? Number(flags.limit) : 10,
      });
      return output(r, asJson, () => {
        const dest = formatDestination(r);
        if (r.messages.length === 0) return `No messages in ${dest}.`;
        const lines = [`Recent messages in ${dest} (${r.messages.length}):`];
        for (const m of r.messages) {
          const ts = m.timestamp ? m.timestamp.slice(0, 16).replace("T", " ") : "";
          const att = m.attachments.length ? ` [attachments: ${m.attachments.map((a) => a.filename).join(", ")}]` : "";
          lines.push(`  [${ts}] ${m.author} (${m.id}): ${m.content || "(empty)"}${att}`);
        }
        if (r.note) lines.push(`\nNote: ${r.note}`);
        return lines.join("\n");
      });
    }

    case "send": {
      const content = flags["message-file"]
        ? fs.readFileSync(flags["message-file"], "utf8")
        : flags.stdin
          ? await readStdin()
          : positional.slice(1).join(" ");
      const r = await sendMessage({
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
        includeMachine: flags["include-machine"] ? true : flags["no-machine"] ? false : undefined,
      });
      return output(r, asJson, () => {
        const extra = r.uploadedAsFile ? " (uploaded as snippet file)" : r.chunksSent > 1 ? ` (${r.chunksSent} messages)` : "";
        return `Sent to ${formatDestination(r)}${extra}${r.url ? `\nLink: ${r.url}` : ""}`;
      });
    }

    case "set-sender": {
      const nameArg = positional.slice(1).join(" ").trim();
      const r = setSender({
        name: nameArg || undefined,
        clearName: Boolean(flags.auto),
        includeSender: flags.disable ? false : flags.enable ? true : undefined,
        includeMachine: flags["include-machine"] ? true : flags["no-machine"] ? false : undefined,
      });
      return output(r, asJson, () =>
        !r.includeSender
          ? "Sender prefix disabled."
          : `Sender set to **${r.effectiveSender}**${r.includeMachine && r.host ? ` (${r.host})` : ""} (source: ${r.source})`
      );
    }

    case "set-default": {
      const d = await setDefault({
        server: flags.server,
        channel: flags.channel,
        thread: flags.thread,
        channelId: flags["channel-id"],
        threadId: flags["thread-id"],
      });
      return output(d, asJson, () =>
        `Default set to ${formatDestination({
          guildId: d.defaultGuildId, guildName: d.defaultGuildName,
          channelId: d.defaultChannelId, channelName: d.defaultChannelName,
          threadId: d.defaultThreadId, threadName: d.defaultThreadName,
        })} (${d.defaultThreadId || d.defaultChannelId})`
      );
    }

    case "alias": {
      const sub = positional[1] || "list";
      if (sub === "list") {
        const aliases = loadConfig().aliases;
        return output(aliases, asJson, () => {
          const entries = Object.entries(aliases);
          if (entries.length === 0) return "No aliases configured.";
          return entries.map(([n, a]) => `  ${n} -> ${formatDestination(a)}${a.description ? ` — ${a.description}` : ""}`).join("\n");
        });
      }
      if (sub === "set") {
        const a = await setAlias({
          name: positional[2],
          server: flags.server,
          channel: flags.channel,
          thread: flags.thread,
          channelId: flags["channel-id"],
          threadId: flags["thread-id"],
          description: flags.description || "",
        });
        return output(a, asJson, () => `Alias "${a.name}" saved -> ${formatDestination(a)}`);
      }
      if (sub === "remove" || sub === "rm" || sub === "delete") {
        const r = removeAlias(positional[2]);
        return output(r, asJson, () => (r.removed ? `Removed alias "${r.name}".` : `Alias "${r.name}" not found.`));
      }
      throw new Error(`Unknown alias subcommand "${sub}". Use list, set, or remove.`);
    }

    default:
      throw new Error(`Unknown command "${cmd}". Run with --help for usage.`);
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
