#!/usr/bin/env node
import fs from "node:fs";
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
  saveToken,
  verifyBot,
  TOKEN_PATH,
} from "./lib/discord.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = { file: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      let key;
      let val;
      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        val = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
        const boolFlags = new Set([
          "json",
          "stdin",
          "archived",
          "suppress-embeds",
          "no-sender",
          "include-machine",
          "no-machine",
          "enable",
          "disable",
          "auto",
          "help",
        ]);
        if (boolFlags.has(key)) {
          val = true;
        } else {
          val = argv[++i];
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
  console.log(`t3-discord — Send Discord messages from T3 Code (CLI & shared config)

Usage:
  discord-send status [--json]
  discord-send guilds [--json]
  discord-send channels [--server <name|id>] [--json]
  discord-send threads [--server <name|id>] [--channel <name|id>] [--archived] [--json]
  discord-send send [message] [options]
    --alias <name>            Use a saved destination alias
    --server <name|id>        Target server (guild) name or ID
    --channel <name|id>       Target channel name or ID
    --thread <name|id>        Target thread name or ID
    --create-thread <name>    Create a new thread in the target channel
    --message-file <path>     Read message text from a UTF-8 file
    --stdin                   Read message text from stdin
    --file <path>             Attach a file (repeatable)
    --from <name>             Override sender name for this message
    --no-sender               Send without prepending sender name
    --suppress-embeds         Disable link preview embeds
    --json                    Output JSON
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

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const asJson = Boolean(flags.json);

  if (!cmd || cmd === "help" || flags.help) {
    printHelp();
    return;
  }

  if (cmd === "status") {
    const status = await getStatus();
    output(status, asJson, (s) => {
      const lines = [];
      lines.push(`Token configured: ${s.tokenConfigured ? "yes" : "no"}`);
      if (s.bot) {
        lines.push(`Bot: ${s.bot.username} (${s.bot.id})`);
      }
      if (s.error) {
        lines.push(`Error: ${s.error}`);
      }
      if (s.guilds.length > 0) {
        lines.push(`Servers (${s.guilds.length}): ${s.guilds.map((g) => `${g.name} (${g.id})`).join(", ")}`);
      }
      const d = s.defaultTarget;
      if (d.threadId) {
        lines.push(`Default: ${d.guildName || d.guildId} / #${d.channelName || d.channelId} > thread "${d.threadName || d.threadId}" (${d.threadId})`);
      } else if (d.channelId) {
        lines.push(`Default: ${d.guildName || d.guildId} / #${d.channelName || d.channelId} (${d.channelId})`);
      } else {
        lines.push("Default: (not set)");
      }
      const aliasNames = Object.keys(s.aliases);
      lines.push(`Aliases (${aliasNames.length}): ${aliasNames.length ? aliasNames.join(", ") : "(none)"}`);
      if (s.sender) {
        const mode = !s.sender.includeSender
          ? "disabled"
          : `${s.sender.effectiveName}${s.sender.includeMachine && s.sender.host ? ` (${s.sender.host})` : ""} [source: ${s.sender.source}]`;
        lines.push(`Sender: ${mode}`);
      }
      lines.push(`Config: ${s.configPath}`);
      return lines.join("\n");
    });
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
      throw new Error("Use --token-file <path> or --stdin to save the bot token securely.");
    }
    saveToken(rawToken);
    const bot = await verifyBot();
    const guilds = await listGuilds();
    output({ ok: true, tokenPath: TOKEN_PATH, bot, guilds }, asJson, (r) => {
      const serverList = r.guilds.length
        ? r.guilds.map((g) => `${g.name} (${g.id})`).join(", ")
        : "(none yet — invite the bot to your server)";
      return `Token saved and verified!\nBot: ${r.bot.username} (${r.bot.id})\nServers: ${serverList}`;
    });
    return;
  }

  if (cmd === "guilds" || cmd === "servers") {
    const guilds = await listGuilds();
    output(guilds, asJson, (gs) =>
      gs.length
        ? gs.map((g) => `${g.name}  (id: ${g.id})`).join("\n")
        : "No servers found. Invite your bot to your Discord server first."
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
    let channelId;
    if (flags.channel) {
      const target = await resolveTarget({ server: guild.id, channel: flags.channel });
      channelId = target.channelId;
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
              `  "${t.name}" in #${t.parentName || t.parentId || "?"} [${t.archived ? "archived" : "active"}] — id: ${t.id}`
          )
          .join("\n")
      );
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
      alias: flags.alias,
      server: flags.server,
      channel: flags.channel,
      thread: flags.thread,
      channelId: flags["channel-id"],
      threadId: flags["thread-id"],
      createThreadName: flags["create-thread"],
      suppressEmbeds: Boolean(flags["suppress-embeds"]),
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
      return `Sent (${r.chunksSent} message${r.chunksSent === 1 ? "" : "s"}) to ${dest}${r.url ? `\nLink: ${r.url}` : ""}`;
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
            return `  ${name} -> ${a.guildName || a.guildId} / ${target}${a.description ? ` — ${a.description}` : ""}`;
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

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
