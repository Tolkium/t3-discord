#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const IS_WIN = process.platform === "win32";
const INSTALL_DIR = path.join(HOME, ".config", "t3-discord");
const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has("--dry-run");
const NON_INTERACTIVE = ARGS.has("--non-interactive") || !process.stdin.isTTY;

function getFlagValue(flag) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return "";
}

function resolveStableNodePath() {
  const execPath = process.execPath;
  if (IS_WIN && execPath.toLowerCase().includes("fnm_multishells")) {
    const candidates = [
      process.env.FNM_DIR && path.join(process.env.FNM_DIR, "aliases", "default", "node.exe"),
      process.env.APPDATA && path.join(process.env.APPDATA, "fnm", "aliases", "default", "node.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "fnm", "aliases", "default", "node.exe"),
    ].filter(Boolean);
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return execPath;
}

function renderSkillMarkdown(launcherPath, tokenPath) {
  const invocation = IS_WIN
    ? `$dc = "${launcherPath}"\n\n# Send short message to default channel\n& $dc send "Your message and https://link-here"\n\n# Send multiline message / code snippet to default channel\n@'\nHere is the snippet:\n\`\`\`ts\nexport const ok = true;\n\`\`\`\n'@ | & $dc send --stdin\n\n# Target a specific channel, thread, alias, or create a new thread\n& $dc send "Message" --channel "chat"\n& $dc send "Message" --channel "code" --thread "auth-refactor"\n& $dc send "Message" --alias "friend"\n& $dc send "Message" --channel "code" --create-thread "api-v2"\n& $dc send "Here is the file" --file "C:\\path\\to\\file.ts"`
    : `dc="${launcherPath}"\n\n# Send short message to default channel\n"$dc" send "Your message and https://link-here"\n\n# Send multiline message / code snippet to default channel\n"$dc" send --stdin <<'EOF'\nHere is the snippet:\n\`\`\`ts\nexport const ok = true;\n\`\`\`\nEOF\n\n# Target a specific channel, thread, alias, or create a new thread\n"$dc" send "Message" --channel "chat"\n"$dc" send "Message" --channel "code" --thread "auth-refactor"\n"$dc" send "Message" --alias "friend"\n"$dc" send "Message" --channel "code" --create-thread "api-v2"\n"$dc" send "Here is the file" --file "/path/to/file.ts"`;

  const otherOps = IS_WIN
    ? `$dc = "${launcherPath}"\n& $dc status\n& $dc guilds\n& $dc channels [--server "<server>"]\n& $dc threads [--server "<server>"] [--channel "<channel>"] [--archived]\n& $dc set-default --channel "code" [--thread "<thread>"]\n& $dc set-sender "<name>" [--auto] [--enable|--disable]\n& $dc alias set friend --channel "chat" [--thread "<thread>"]\n& $dc alias list`
    : `dc="${launcherPath}"\n"$dc" status\n"$dc" guilds\n"$dc" channels [--server "<server>"]\n"$dc" threads [--server "<server>"] [--channel "<channel>"] [--archived]\n"$dc" set-default --channel "code" [--thread "<thread>"]\n"$dc" set-sender "<name>" [--auto] [--enable|--disable]\n"$dc" alias set friend --channel "chat" [--thread "<thread>"]\n"$dc" alias list`;

  const shellLang = IS_WIN ? "powershell" : "bash";

  return `---
name: discord-send
description: >-
  Send messages, code snippets, links, and file attachments to the user's private
  Discord server(s), channels, and threads, or manage default Discord destinations
  and aliases. Use whenever the user says "send this to Discord", "post to Discord",
  "share on Discord", "message my friend on Discord", or asks to configure a default
  Discord server/channel/thread.
---

# Discord Send (T3 Code)

Send messages, code snippets, links, or files to Discord via the local \`t3-discord\` integration.

## Fast Path (Always Prefer 1 Step!)

When the user asks to send something to Discord, **send it immediately in ONE call**:
- **Do NOT** call \`discord_status\`, \`discord_list_servers\`, or \`discord_list_channels\` first! The bot and default channel are already configured; \`send\` resolves everything automatically and gives a clear error if anything is missing.
- **If \`discord_send_message\` is directly callable (eager MCP tool)**: call it right away with \`{ content, channel?, thread?, alias?, createThreadName?, files? }\`.
- **If MCP tools are lazy-loaded or absent**: run the local CLI directly in one shell call (faster than reading multiple MCP schema files!):

\`\`\`${shellLang}
${invocation}
\`\`\`

## Other Operations (Only When Asked or on Error)

Use the matching MCP tool (\`discord_status\`, \`discord_list_servers\`, \`discord_list_channels\`, \`discord_list_threads\`, \`discord_set_default\`, \`discord_set_sender\`, \`discord_manage_alias\`) or CLI command:

\`\`\`${shellLang}
${otherOps}
\`\`\`

## Security & Formatting Rules

1. **NEVER** read, print, or echo \`${tokenPath}\` or \`DISCORD_BOT_TOKEN\`. If the token is missing/invalid, use \`request_secret\` (\`delivery: "file"\`) and run \`${launcherPath} set-token --token-file "<file>"\`.
2. **Sender attribution**: Messages automatically prepend the sender's name (from \`config.json\` \`senderName\`, or auto-detected from \`git config --global user.name\` -> OS user -> hostname), so multiple people can share one bot and still see who spoke. Use \`--from "<name>"\` or \`--no-sender\` (\`includeSender: false\`) only if the user explicitly asks to override or hide it.
3. **Default destination**: When the user doesn't name a specific channel/thread (note: phrases like *"with chat message ..."* mean the message text, NOT the \`#chat\` channel), omit destination flags so the configured default is used.
4. **Code snippets**: Wrap code in triple backticks with a language tag (e.g. \`\`\`ts). Messages >2000 chars are auto-split while keeping code fences valid.
5. **Confirmation**: Reply concisely with the destination channel/thread and the clickable Discord link returned by the tool.
`;
}

function writeJsonMcpEntry(filePath, entry, { createIfMissing = false } = {}) {
  const exists = fs.existsSync(filePath);
  if (!exists && !createIfMissing) return false;

  let data = {};
  if (exists) {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (raw) {
      data = JSON.parse(raw);
    }
  }
  if (!data.mcpServers || typeof data.mcpServers !== "object") {
    data.mcpServers = {};
  }
  data.mcpServers.discord = entry;

  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
  return true;
}

function registerCodexMcp(codexConfigPath, nodePath, mcpPath) {
  if (!fs.existsSync(path.dirname(codexConfigPath))) return false;
  let raw = fs.existsSync(codexConfigPath) ? fs.readFileSync(codexConfigPath, "utf8") : "";
  if (raw.includes("[mcp_servers.discord]")) {
    return "already";
  }
  const quoteToml = (s) => (IS_WIN ? `'${s.replace(/'/g, "''")}'` : JSON.stringify(s));
  const block = [
    "",
    "[mcp_servers.discord]",
    `command = ${quoteToml(nodePath)}`,
    `args = [${quoteToml(mcpPath)}]`,
    "",
  ].join("\n");
  if (!DRY_RUN) {
    fs.writeFileSync(codexConfigPath, raw.trimEnd() + "\n" + block, "utf8");
  }
  return true;
}

function lockDownTokenFile(tokenPath) {
  if (DRY_RUN || !fs.existsSync(tokenPath)) return;
  try {
    if (IS_WIN) {
      const user = process.env.USERNAME || os.userInfo().username;
      execFileSync("icacls", [tokenPath, "/inheritance:r", "/grant:r", `${user}:(R,W)`], {
        stdio: "ignore",
      });
    } else {
      fs.chmodSync(tokenPath, 0o600);
    }
  } catch {
    // non-fatal
  }
}

async function main() {
  const nodePath = resolveStableNodePath();
  const libDst = path.join(INSTALL_DIR, "lib", "discord.mjs");
  const cliDst = path.join(INSTALL_DIR, "cli.mjs");
  const mcpDst = path.join(INSTALL_DIR, "mcp-server.mjs");
  const tokenPath = path.join(INSTALL_DIR, "token.txt");
  const launcherPath = IS_WIN
    ? path.join(INSTALL_DIR, "discord-send.cmd")
    : path.join(INSTALL_DIR, "discord-send");

  console.log(`t3-discord installer${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`  Node:        ${nodePath}`);
  console.log(`  Install dir: ${INSTALL_DIR}`);

  // 1. Copy runtime files
  if (!DRY_RUN) {
    fs.mkdirSync(path.join(INSTALL_DIR, "lib"), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "lib", "discord.mjs"), libDst);
    fs.copyFileSync(path.join(__dirname, "cli.mjs"), cliDst);
    fs.copyFileSync(path.join(__dirname, "mcp-server.mjs"), mcpDst);

    if (IS_WIN) {
      fs.writeFileSync(launcherPath, `@echo off\r\n"${nodePath}" "${cliDst}" %*\r\n`, "utf8");
    } else {
      fs.writeFileSync(launcherPath, `#!/usr/bin/env sh\nexec "${nodePath}" "${cliDst}" "$@"\n`, "utf8");
      fs.chmodSync(launcherPath, 0o755);
    }
  }
  console.log(`[OK] Installed CLI & MCP server to ${INSTALL_DIR}`);

  // 2. Install global SKILL.md across Antigravity, Claude, Codex, and .agents
  const skillMd = renderSkillMarkdown(launcherPath, tokenPath);
  const skillDirs = [
    path.join(HOME, ".gemini", "config", "skills", "discord-send"),
    path.join(HOME, ".gemini", "skills", "discord-send"),
    path.join(HOME, ".claude", "skills", "discord-send"),
    path.join(HOME, ".codex", "skills", "discord-send"),
    path.join(HOME, ".agents", "skills", "discord-send"),
  ];
  for (const dir of skillDirs) {
    if (!DRY_RUN) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd, "utf8");
    }
  }
  console.log(`[OK] Installed global skill "discord-send" (${skillDirs.length} locations)`);

  // 3. Register MCP server across detected T3 Code providers
  const registered = [];

  // Antigravity global
  if (
    writeJsonMcpEntry(
      path.join(HOME, ".gemini", "config", "mcp_config.json"),
      { command: nodePath, args: [mcpDst] },
      { createIfMissing: true }
    )
  ) {
    registered.push("Antigravity (~/.gemini/config/mcp_config.json)");
  }

  // T3 Code per-provider Antigravity configs
  const t3AgyRoot = path.join(HOME, ".t3", "userdata", "providers", "antigravity");
  if (fs.existsSync(t3AgyRoot)) {
    for (const entry of fs.readdirSync(t3AgyRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgDir = path.join(t3AgyRoot, entry.name, "config");
      if (fs.existsSync(cfgDir)) {
        writeJsonMcpEntry(
          path.join(cfgDir, "mcp_config.json"),
          { command: nodePath, args: [mcpDst] },
          { createIfMissing: true }
        );
        registered.push(`T3 Code Antigravity (${entry.name.slice(0, 8)}...)`);
      }
    }
  }

  // Claude
  const claudeJson = path.join(HOME, ".claude.json");
  if (fs.existsSync(claudeJson) || fs.existsSync(path.join(HOME, ".claude"))) {
    writeJsonMcpEntry(
      claudeJson,
      { type: "stdio", command: nodePath, args: [mcpDst] },
      { createIfMissing: true }
    );
    registered.push("Claude (~/.claude.json)");
  }

  // Codex
  const codexToml = path.join(HOME, ".codex", "config.toml");
  const codexRes = registerCodexMcp(codexToml, nodePath, mcpDst);
  if (codexRes) {
    registered.push(
      codexRes === "already" ? "Codex (already configured)" : "Codex (~/.codex/config.toml)"
    );
  }

  console.log(`[OK] Registered MCP server "discord" in: ${registered.join(", ")}`);

  if (DRY_RUN) {
    console.log("\nDry run complete. No files were modified.");
    return;
  }

  // 4. Optional token / sender / default channel setup
  const discord = await import(pathToFileURL(libDst).href);

  const tokenFileFlag = getFlagValue("--token-file");
  if (tokenFileFlag) {
    discord.saveToken(fs.readFileSync(tokenFileFlag, "utf8"));
    lockDownTokenFile(tokenPath);
    console.log("[OK] Saved bot token from --token-file");
  }

  const senderFlag = getFlagValue("--sender");
  if (senderFlag) {
    discord.setSender({ name: senderFlag, includeSender: true, includeMachine: false });
    console.log(`[OK] Sender set to "${senderFlag}"`);
  }

  const channelFlag = getFlagValue("--channel");
  if (channelFlag && discord.hasToken()) {
    const def = await discord.setDefault({ channel: channelFlag });
    console.log(`[OK] Default channel set to ${def.defaultGuildName} / #${def.defaultChannelName}`);
  }

  if (NON_INTERACTIVE) {
    console.log("\nInstall complete! Run `discord-send status` to verify.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n--- Quick Setup ---");

    if (!discord.hasToken()) {
      const token = (await rl.question("Paste Discord Bot Token (or press Enter to set later): ")).trim();
      if (token) {
        discord.saveToken(token);
        lockDownTokenFile(tokenPath);
        const bot = await discord.verifyBot();
        console.log(`[OK] Connected as bot "${bot.username}" (${bot.id})`);
      }
    } else {
      console.log("[OK] Existing bot token found (keeping it).");
    }

    const detected = discord.resolveSender();
    const senderAnswer = (
      await rl.question(`Your display name in Discord [Enter for auto: "${detected.name}"]: `)
    ).trim();
    if (senderAnswer) {
      discord.setSender({ name: senderAnswer, includeSender: true, includeMachine: false });
      console.log(`[OK] Messages will show as **${senderAnswer}**: ...`);
    } else {
      console.log(`[OK] Using auto-detected name: **${detected.name}** (${detected.source})`);
    }

    if (discord.hasToken()) {
      const cfg = discord.loadConfig();
      if (!cfg.defaultChannelId) {
        const guilds = await discord.listGuilds();
        if (guilds.length > 0) {
          const guild = guilds[0];
          const channels = await discord.listChannels(guild.id);
          const textChannels = channels.filter((c) => c.type === "text");
          console.log(`\nChannels in "${guild.name}": ${textChannels.map((c) => "#" + c.name).join(", ")}`);
          const suggested = textChannels.find((c) => c.name.toLowerCase() === "code")?.name || textChannels[0]?.name || "";
          const chAnswer = (
            await rl.question(`Default channel [Enter for #${suggested}]: `)
          ).trim();
          const chosen = chAnswer || suggested;
          if (chosen) {
            const def = await discord.setDefault({ server: guild.id, channel: chosen });
            console.log(`[OK] Default channel set to ${def.defaultGuildName} / #${def.defaultChannelName}`);
          }
        }
      }
    }

    console.log('\nAll set! Open T3 Code and say: "Send hello to Discord"');
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`\nInstall error: ${err.message}`);
  process.exit(1);
});
