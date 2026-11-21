#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const SERVER_KEY = "t3-discord";
const LEGACY_KEY = "discord";

const BOOL_FLAGS = new Set([
  "help", "dry-run", "non-interactive", "list-clients", "uninstall", "purge", "all", "no-skills", "force",
]);
const LIST_FLAGS = new Set(["clients", "client", "skip", "exclude"]);
const VALUE_FLAGS = new Set(["config-path", "node", "token-file", "sender", "channel", "server"]);

export function parseInstallerArgs(argv) {
  const opts = {
    dryRun: false, nonInteractive: !process.stdin.isTTY, listClients: false,
    uninstall: false, purge: false, all: false, noSkills: false, force: false, help: false,
    clients: [], skip: [], configPath: "", nodePath: "", tokenFile: "", sender: "", channel: "", server: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") { opts.help = true; continue; }
    if (arg === "install") continue;
    if (arg === "uninstall") { opts.uninstall = true; continue; }
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);

    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);

    if (BOOL_FLAGS.has(key)) {
      if (eq !== -1) throw new Error(`Flag --${key} does not take a value.`);
      const prop = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[prop] = true;
      continue;
    }

    if (!LIST_FLAGS.has(key) && !VALUE_FLAGS.has(key)) {
      throw new Error(`Unknown flag: --${key}. Run with --help for usage.`);
    }

    let val;
    if (eq !== -1) {
      val = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`Flag --${key} requires a value.`);
      val = argv[++i];
    }

    if (key === "clients" || key === "client") {
      opts.clients.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else if (key === "skip" || key === "exclude") {
      opts.skip.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else if (key === "node") {
      opts.nodePath = val;
    } else {
      const prop = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[prop] = val;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`t3-discord installer

Usage:
  node install.mjs [options]

Options:
  --list-clients            Show detected AI clients and config paths (no writes)
  --dry-run                 Preview all changes without writing any files
  --clients=a,b             Install into named clients (creates missing config files)
                            Supported: antigravity, t3-antigravity, claude-code, claude-desktop,
                            cursor, windsurf, vscode, gemini-cli, codex, zed, opencode
  --skip=a,b                Skip specific auto-detected clients
  --all                     Install into all detected clients without confirmation
  --config-path=<path>      Override config file path (requires single --clients=<id>)
  --node=<path>             Override absolute Node.js binary path
  --no-skills               Skip installing global SKILL.md files
  --non-interactive         Skip interactive token/sender/channel prompts
  --token-file=<path>       Read and verify bot token from a file
  --sender=<name>           Set display name for outgoing messages
  --server=<name|id>        Set default server (with --channel)
  --channel=<name|id>       Set default channel
  --force                   Overwrite conflicting MCP entries
  --uninstall [--purge]     Remove t3-discord MCP entries and skills (--purge also deletes token/config)
  -h, --help                Show this help`);
}

export function resolveStableNodePath(override = "") {
  if (override) return path.resolve(override);
  const home = os.homedir();
  const execPath = process.execPath;

  if (IS_WIN) {
    if (execPath.toLowerCase().includes("fnm_multishells")) {
      const bases = [process.env.FNM_DIR, process.env.APPDATA && path.join(process.env.APPDATA, "fnm"), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "fnm")].filter(Boolean);
      for (const b of bases) {
        const c = path.join(b, "aliases", "default", "node.exe");
        if (fs.existsSync(c)) return c;
      }
    }
    const volta = path.join(home, ".volta", "bin", "node.exe");
    if (execPath.toLowerCase().includes("volta") && fs.existsSync(volta)) return volta;
    return execPath;
  }

  const volta = path.join(home, ".volta", "bin", "node");
  if (execPath.includes("volta") && fs.existsSync(volta)) return volta;

  if (execPath.includes("fnm_multishells")) {
    const bases = [
      process.env.FNM_DIR,
      path.join(home, ".local", "share", "fnm"),
      path.join(home, "Library", "Application Support", "fnm"),
      path.join(home, ".fnm"),
    ].filter(Boolean);
    for (const b of bases) {
      const c = path.join(b, "aliases", "default", "bin", "node");
      if (fs.existsSync(c)) return c;
    }
  }

  if (execPath.includes("/Cellar/node")) {
    for (const c of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
      if (fs.existsSync(c)) return c;
    }
  }
  return execPath;
}

function getInstallDir() {
  return process.env.T3_DISCORD_CONFIG_DIR || path.join(os.homedir(), ".config", "t3-discord");
}

function appDataDir(home) {
  if (IS_WIN && process.env.APPDATA) return process.env.APPDATA;
  if (IS_MAC) return path.join(home, "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(home, ".config");
}

function existingOrFirst(candidates) {
  const present = candidates.filter((p) => fs.existsSync(path.dirname(p)));
  return present.length > 0 ? present : candidates.slice(0, 1);
}

function findClaudeDesktopPaths(home) {
  const paths = [path.join(appDataDir(home), "Claude", "claude_desktop_config.json")];
  if (IS_WIN && process.env.LOCALAPPDATA) {
    const pkgs = path.join(process.env.LOCALAPPDATA, "Packages");
    if (fs.existsSync(pkgs)) {
      try {
        for (const e of fs.readdirSync(pkgs, { withFileTypes: true })) {
          if (e.isDirectory() && e.name.startsWith("Claude_")) {
            const p = path.join(pkgs, e.name, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json");
            if (fs.existsSync(path.dirname(p))) paths.push(p);
          }
        }
      } catch { /* ignore */ }
    }
  }
  return paths;
}

function findVSCodePaths(home) {
  const base = appDataDir(home);
  const stable = path.join(base, "Code", "User", "mcp.json");
  const insiders = path.join(base, "Code - Insiders", "User", "mcp.json");
  return fs.existsSync(path.dirname(insiders)) ? [stable, insiders] : [stable];
}

function findT3AntigravityPaths(home) {
  const root = path.join(home, ".t3", "userdata", "providers", "antigravity");
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "config")))
      .map((e) => path.join(root, e.name, "config", "mcp_config.json"));
  } catch {
    return [];
  }
}

/**
 * Snapshot-detects all supported AI clients BEFORE creating any directories or files.
 */
export function discoverClients(nodePath, mcpPath, configPathOverride = "", singleClientId = "") {
  const home = os.homedir();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const claudeJson = process.env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, ".claude.json") : path.join(home, ".claude.json");
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");

  const t3AgyPaths = findT3AntigravityPaths(home);
  const claudeDesktopAll = findClaudeDesktopPaths(home);
  const vscodeAll = findVSCodePaths(home);
  const stdioEntry = { command: nodePath, args: [mcpPath] };
  const typedStdio = { type: "stdio", command: nodePath, args: [mcpPath] };

  const defs = [
    {
      id: "antigravity",
      label: "Antigravity",
      rootKey: "mcpServers",
      paths: [path.join(home, ".gemini", "config", "mcp_config.json")],
      detected: fs.existsSync(path.join(home, ".gemini", "config")) || fs.existsSync(path.join(home, ".gemini", "antigravity")) || t3AgyPaths.length > 0,
      entry: stdioEntry,
      skillDirs: [
        path.join(home, ".gemini", "config", "skills", "discord-send"),
        ...(fs.existsSync(path.join(home, ".gemini", "skills")) ? [path.join(home, ".gemini", "skills", "discord-send")] : []),
      ],
    },
    {
      id: "t3-antigravity",
      label: "T3 Code (Antigravity provider)",
      rootKey: "mcpServers",
      paths: t3AgyPaths,
      detected: t3AgyPaths.length > 0,
      entry: stdioEntry,
    },
    {
      id: "claude-code",
      label: "Claude Code",
      rootKey: "mcpServers",
      paths: [claudeJson],
      detected: fs.existsSync(claudeJson) || fs.existsSync(claudeDir),
      entry: typedStdio,
      skillDirs: [path.join(claudeDir, "skills", "discord-send")],
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      rootKey: "mcpServers",
      paths: existingOrFirst(claudeDesktopAll),
      detected: claudeDesktopAll.some((p) => fs.existsSync(path.dirname(p))),
      entry: stdioEntry,
    },
    {
      id: "cursor",
      label: "Cursor",
      rootKey: "mcpServers",
      paths: [path.join(home, ".cursor", "mcp.json")],
      detected: fs.existsSync(path.join(home, ".cursor")),
      entry: stdioEntry,
    },
    {
      id: "windsurf",
      label: "Windsurf",
      rootKey: "mcpServers",
      paths: [path.join(home, ".codeium", "windsurf", "mcp_config.json")],
      detected: fs.existsSync(path.join(home, ".codeium", "windsurf")),
      entry: stdioEntry,
    },
    {
      id: "vscode",
      label: "VS Code (Copilot)",
      rootKey: "servers",
      paths: existingOrFirst(vscodeAll),
      detected: vscodeAll.some((p) => fs.existsSync(path.dirname(p))),
      entry: typedStdio,
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      rootKey: "mcpServers",
      paths: [path.join(home, ".gemini", "settings.json")],
      detected: fs.existsSync(path.join(home, ".gemini", "settings.json")),
      entry: stdioEntry,
    },
    {
      id: "codex",
      label: "Codex CLI",
      format: "toml",
      rootKey: "mcp_servers",
      paths: [path.join(codexHome, "config.toml")],
      detected: fs.existsSync(codexHome),
      entry: stdioEntry,
      skillDirs: [path.join(codexHome, "skills", "discord-send")],
    },
    {
      id: "zed",
      label: "Zed (opt-in)",
      rootKey: "context_servers",
      optInOnly: true,
      paths: [path.join(xdg, "zed", "settings.json")],
      detected: fs.existsSync(path.join(xdg, "zed")),
      entry: { command: { path: nodePath, args: [mcpPath] } },
    },
    {
      id: "opencode",
      label: "OpenCode (opt-in)",
      rootKey: "mcp",
      optInOnly: true,
      paths: [path.join(xdg, "opencode", "opencode.json")],
      detected: fs.existsSync(path.join(xdg, "opencode")),
      entry: { type: "local", command: [nodePath, mcpPath] },
    },
  ].map((d) => ({ format: "json", optInOnly: false, skillDirs: [], ...d }));

  if (configPathOverride && singleClientId) {
    const target = defs.find((d) => d.id === singleClientId);
    if (target) target.paths = [path.resolve(configPathOverride)];
  }
  return defs;
}

// --- Safe Config Readers/Writers ---

function isOurEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const s = JSON.stringify(entry).toLowerCase();
  return s.includes("t3-discord") && s.includes("mcp-server.mjs");
}

function atomicWriteWithBackup(filePath, content, backup = true) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (backup && fs.existsSync(filePath)) {
    const bak = `${filePath}.t3-discord.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(filePath, bak);
  }
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

export function upsertJsonMcp(filePath, rootKey, entry, { dryRun = false, force = false } = {}) {
  const exists = fs.existsSync(filePath);
  const raw = exists ? fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "") : "";
  const snippet = () => JSON.stringify({ [rootKey]: { [SERVER_KEY]: entry } }, null, 2);

  let data = {};
  if (raw.trim()) {
    try { data = JSON.parse(raw); } catch {
      return { status: "skipped", reason: "JSONC comments or invalid JSON — not overwritten", manualSnippet: snippet() };
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "skipped", reason: "Root JSON value is not an object", manualSnippet: snippet() };
  }
  if (data[rootKey] !== undefined && (typeof data[rootKey] !== "object" || data[rootKey] === null || Array.isArray(data[rootKey]))) {
    return { status: "conflict", reason: `Expected "${rootKey}" to be a JSON object`, manualSnippet: snippet() };
  }

  const bucket = (data[rootKey] ||= {});
  let migrated = false;
  if (bucket[LEGACY_KEY] && isOurEntry(bucket[LEGACY_KEY])) {
    if (!bucket[SERVER_KEY]) bucket[SERVER_KEY] = bucket[LEGACY_KEY];
    delete bucket[LEGACY_KEY];
    migrated = true;
  }

  const prev = bucket[SERVER_KEY];
  if (prev && !isOurEntry(prev) && !force) {
    return { status: "conflict", reason: `Existing "${SERVER_KEY}" belongs to another server (use --force)`, manualSnippet: snippet() };
  }

  const next = prev ? { ...prev, ...entry } : entry;
  if (!migrated && prev && JSON.stringify(prev) === JSON.stringify(next)) return { status: "unchanged" };

  bucket[SERVER_KEY] = next;
  if (!dryRun) atomicWriteWithBackup(filePath, JSON.stringify(data, null, 2) + "\n", exists);
  return { status: migrated ? "migrated" : prev ? "updated" : "added" };
}

export function removeJsonMcp(filePath, rootKey, { dryRun = false } = {}) {
  if (!fs.existsSync(filePath)) return { status: "absent" };
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) return { status: "absent" };
  let data;
  try { data = JSON.parse(raw); } catch {
    return { status: "skipped", reason: "Unparseable JSON/JSONC — remove manually" };
  }
  const bucket = data?.[rootKey];
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return { status: "absent" };

  let removed = false;
  for (const key of [SERVER_KEY, LEGACY_KEY]) {
    if (bucket[key] && isOurEntry(bucket[key])) { delete bucket[key]; removed = true; }
  }
  if (!removed) return { status: "absent" };
  if (!dryRun) atomicWriteWithBackup(filePath, JSON.stringify(data, null, 2) + "\n", true);
  return { status: "removed" };
}

function findTomlSection(lines, header) {
  const target = `[${header}]`;
  const start = lines.findIndex((l) => l.trim() === target);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[.+\]$/.test(lines[i].trim())) { end = i; break; }
  }
  return { start, end };
}

export function upsertCodexToml(filePath, nodePath, mcpPath, { dryRun = false } = {}) {
  const exists = fs.existsSync(filePath);
  const raw = exists ? fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "") : "";
  const lines = raw ? raw.split(/\r?\n/) : [];
  const section = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(nodePath)}`,
    `args = [${JSON.stringify(mcpPath)}]`,
  ];

  let migrated = false;
  const legacy = findTomlSection(lines, `mcp_servers.${LEGACY_KEY}`);
  if (legacy) {
    const text = lines.slice(legacy.start, legacy.end).join("\n").toLowerCase();
    if (text.includes("t3-discord") && text.includes("mcp-server.mjs")) {
      lines.splice(legacy.start, legacy.end - legacy.start);
      migrated = true;
    }
  }

  const existing = findTomlSection(lines, `mcp_servers.${SERVER_KEY}`);
  let status = migrated ? "migrated" : "added";
  if (existing) {
    const oldBlock = lines.slice(existing.start, existing.end).filter((l) => l.trim()).join("\n");
    if (!migrated && oldBlock === section.join("\n")) return { status: "unchanged" };
    lines.splice(existing.start, existing.end - existing.start, ...section, "");
    status = migrated ? "migrated" : "updated";
  } else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push("");
    lines.push(...section);
  }

  if (!dryRun) atomicWriteWithBackup(filePath, lines.join("\n").trimEnd() + "\n", exists);
  return { status };
}

export function removeCodexToml(filePath, { dryRun = false } = {}) {
  if (!fs.existsSync(filePath)) return { status: "absent" };
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  let removed = false;
  for (const key of [SERVER_KEY, LEGACY_KEY]) {
    const range = findTomlSection(lines, `mcp_servers.${key}`);
    if (range) {
      const text = lines.slice(range.start, range.end).join("\n").toLowerCase();
      if (text.includes("t3-discord") && text.includes("mcp-server.mjs")) {
        lines.splice(range.start, range.end - range.start);
        removed = true;
      }
    }
  }
  if (!removed) return { status: "absent" };
  if (!dryRun) atomicWriteWithBackup(filePath, lines.join("\n").trimEnd() + "\n", true);
  return { status: "removed" };
}

// --- Skill Template & Interactive Prompts ---

function renderSkillMarkdown(nodePath, cliPath, tokenPath) {
  const lang = IS_WIN ? "powershell" : "bash";
  const cliBlock = IS_WIN
    ? `$node = "${nodePath}"\n$cli = "${cliPath}"\n\n& $node $cli send "Your message and https://link-here"\n& $node $cli send --code-file "C:\\path\\to\\file.ts:40-80"\n\n# Multiline or non-ASCII text safely via UTF-8 temp file\n$tmp = Join-Path $env:TEMP "discord-msg.txt"\nSet-Content -Path $tmp -Encoding utf8NoBOM -Value @'\n\`\`\`ts\nexport const ok = true;\n\`\`\`\n'@\n& $node $cli send --message-file $tmp; Remove-Item $tmp -ErrorAction SilentlyContinue\n\n& $node $cli send "Msg" --channel "chat" [--thread "topic"] [--alias "friend"] [--reply-to "https://discord.com/channels/..."]\n& $node $cli read --limit 10`
    : `node_bin="${nodePath}"\ncli="${cliPath}"\n\n"$node_bin" "$cli" send "Your message and https://link-here"\n"$node_bin" "$cli" send --code-file "/abs/path/file.ts:40-80"\n"$node_bin" "$cli" send --stdin <<'EOF'\n\`\`\`ts\nexport const ok = true;\n\`\`\`\nEOF\n"$node_bin" "$cli" send "Msg" --channel "chat" [--thread "topic"] [--alias "friend"] [--reply-to "https://discord.com/channels/..."]\n"$node_bin" "$cli" read --limit 10`;

  return `---
name: discord-send
description: >-
  Send messages, code snippets, file slices, links, and attachments to Discord
  servers, channels, and threads, read recent messages, or manage default Discord
  destinations and aliases. Use whenever the user says "send this to Discord",
  "post to Discord", "check Discord", "share on Discord", or asks to configure a
  default Discord channel/thread.
---

# Discord Send (t3-discord)

## Fast Path (Always Prefer 1 Step)

- **Do NOT** call \`discord_status\`, \`discord_list_servers\`, or \`discord_list_channels\` before sending. Go straight to sending; defaults resolve automatically.
- **If \`discord_send_message\` is an eager MCP tool**: call it directly with \`{ content?, codeFile?, lines?, channel?, thread?, alias?, createThreadName?, replyTo?, files? }\`.
- **If MCP tools are lazy-loaded or absent**: run \`node cli.mjs\` directly in one shell call (avoids reading multiple MCP schema files and avoids Windows \`cmd.exe\` quoting issues):

\`\`\`${lang}
${cliBlock}
\`\`\`

Other commands (only when asked or on error): \`status\`, \`doctor\`, \`channels\`, \`threads\`, \`set-default\`, \`set-sender\`, \`alias set|list|remove\` (or matching \`discord_*\` MCP tools).

## Rules

1. **NEVER** read, print, or echo \`${tokenPath}\`, \`T3_DISCORD_TOKEN\`, or \`DISCORD_BOT_TOKEN\`. If missing/invalid, use \`request_secret\` (\`delivery: "file"\`) when available, or ask the user to run \`node "${cliPath}" set-token --stdin\`.
2. **Sender attribution**: Prepends sender name automatically (config or git/OS/hostname). Only pass \`--from\` / \`--no-sender\` if asked.
3. **Default destination**: Omit destination flags when no channel/thread is named (phrases like *"with chat message ..."* mean message text, not \`#chat\`).
4. **Code**: Prefer \`codeFile\` + \`lines\` for local files. Messages >2000 chars auto-split with valid fences; >3 chunks auto-upload as a snippet file.
5. **Confirmation**: Reply concisely with the destination and returned Discord link.
`;
}

function askPrompt(promptText, { hidden = false } = {}) {
  return new Promise((resolve) => {
    let muted = false;
    const output = hidden
      ? new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } })
      : process.stdout;
    const rl = readline.createInterface({ input: process.stdin, output, terminal: hidden });
    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      process.exit(130);
    });
    rl.question(promptText, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
    if (hidden) muted = true;
  });
}

// --- Main Installer ---

async function main() {
  const opts = parseInstallerArgs(process.argv.slice(2));
  if (opts.help) return printHelp();
  if (opts.configPath && opts.clients.length !== 1) {
    throw new Error("--config-path requires exactly one client via --clients=<id>.");
  }

  const home = os.homedir();
  const installDir = getInstallDir();
  const nodePath = resolveStableNodePath(opts.nodePath);
  const libDst = path.join(installDir, "lib", "discord.mjs");
  const cliDst = path.join(installDir, "cli.mjs");
  const mcpDst = path.join(installDir, "mcp-server.mjs");
  const tokenPath = path.join(installDir, "token.txt");
  const launcherPath = path.join(installDir, IS_WIN ? "discord-send.cmd" : "discord-send");

  // Snapshot ALL clients BEFORE writing anything
  const allClients = discoverClients(nodePath, mcpDst, opts.configPath, opts.clients.length === 1 ? opts.clients[0] : "");
  const validIds = new Set(allClients.map((c) => c.id));
  for (const id of [...opts.clients, ...opts.skip]) {
    if (!validIds.has(id)) throw new Error(`Unknown client "${id}". Valid: ${Array.from(validIds).join(", ")}`);
  }

  if (opts.listClients) {
    console.log(`t3-discord client detection (Node: ${nodePath})\n`);
    for (const c of allClients) {
      const tag = c.detected ? (c.optInOnly ? "detected (opt-in)" : "detected") : "not found";
      console.log(`  ${c.id.padEnd(16)} [${tag}]  ${c.label} -> ${c.paths.join(", ") || "(none)"}`);
    }
    return;
  }

  const skipSet = new Set(opts.skip);
  let selected = opts.clients.length > 0
    ? allClients.filter((c) => opts.clients.includes(c.id) && !skipSet.has(c.id))
    : allClients.filter((c) => c.detected && !c.optInOnly && !skipSet.has(c.id));

  // Uninstall flow
  if (opts.uninstall) {
    console.log(`t3-discord uninstaller${opts.dryRun ? " (DRY RUN)" : ""}`);
    for (const c of opts.clients.length ? selected : allClients) {
      for (const fp of c.paths) {
        const res = c.format === "toml"
          ? removeCodexToml(fp, { dryRun: opts.dryRun })
          : removeJsonMcp(fp, c.rootKey, { dryRun: opts.dryRun });
        if (res.status !== "absent") {
          console.log(`  [${res.status.toUpperCase()}] ${c.label}: ${fp}${res.reason ? ` (${res.reason})` : ""}`);
        }
      }
      for (const dir of c.skillDirs) {
        if (fs.existsSync(path.join(dir, "SKILL.md"))) {
          if (!opts.dryRun) fs.rmSync(dir, { recursive: true, force: true });
          console.log(`  [REMOVED] Skill: ${dir}`);
        }
      }
    }
    const agentsSkill = path.join(home, ".agents", "skills", "discord-send");
    if (fs.existsSync(agentsSkill)) {
      if (!opts.dryRun) fs.rmSync(agentsSkill, { recursive: true, force: true });
      console.log(`  [REMOVED] Skill: ${agentsSkill}`);
    }
    if (opts.purge && fs.existsSync(installDir)) {
      if (!opts.dryRun) fs.rmSync(installDir, { recursive: true, force: true });
      console.log(`  [PURGED] ${installDir}`);
    } else {
      console.log(`  Kept config & token in ${installDir} (pass --purge to remove).`);
    }
    return;
  }

  console.log(`t3-discord installer${opts.dryRun ? " (DRY RUN)" : ""}`);
  console.log(`  Node:        ${nodePath}`);
  console.log(`  Install dir: ${installDir}`);
  if (/v\d+\.\d+\.\d+/.test(nodePath) && !nodePath.toLowerCase().includes("aliases")) {
    console.log("  [NOTE] Node path contains a version number; re-run `node install.mjs` if you upgrade Node.");
  }

  if (!opts.nonInteractive && !opts.all && !opts.dryRun && opts.clients.length === 0 && selected.length > 0) {
    console.log("\nDetected AI clients:");
    for (const c of selected) console.log(`  - ${c.label} (${c.paths.join(", ")})`);
    const ans = (await askPrompt("Register t3-discord MCP server in these clients? [Y/n]: ")).trim().toLowerCase();
    if (ans === "n" || ans === "no") {
      selected = [];
      console.log("Skipped MCP client registration (CLI still installed).");
    }
  }

  // 1. Copy runtime files
  if (!opts.dryRun) {
    fs.mkdirSync(path.join(installDir, "lib"), { recursive: true });
    for (const rel of ["lib/discord.mjs", "cli.mjs", "mcp-server.mjs", "package.json"]) {
      const src = path.join(__dirname, rel);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(installDir, rel));
    }
    if (IS_WIN) {
      fs.writeFileSync(launcherPath, `@echo off\r\n"${nodePath}" "${cliDst}" %*\r\n`, "utf8");
    } else {
      fs.writeFileSync(launcherPath, `#!/usr/bin/env sh\nexec "${nodePath}" "${cliDst}" "$@"\n`, "utf8");
      fs.chmodSync(launcherPath, 0o755);
    }
  }
  console.log(`[OK] Runtime files -> ${installDir}`);

  // 2. Register MCP entries per client
  const manualSnippets = [];
  if (selected.length === 0) {
    console.log("[INFO] No MCP clients registered (use --list-clients or --clients=<id>).");
  } else {
    console.log("MCP client registrations:");
    for (const c of selected) {
      for (const fp of c.paths) {
        try {
          const res = c.format === "toml"
            ? upsertCodexToml(fp, nodePath, mcpDst, { dryRun: opts.dryRun })
            : upsertJsonMcp(fp, c.rootKey, c.entry, { dryRun: opts.dryRun, force: opts.force });
          console.log(`  [${res.status.toUpperCase()}] ${c.label}: ${fp}${res.reason ? ` (${res.reason})` : ""}`);
          if (res.manualSnippet) manualSnippets.push({ label: c.label, fp, snippet: res.manualSnippet });
        } catch (err) {
          console.log(`  [ERROR] ${c.label}: ${fp} (${err.message})`);
          manualSnippets.push({ label: c.label, fp, snippet: JSON.stringify({ [c.rootKey]: { [SERVER_KEY]: c.entry } }, null, 2) });
        }
      }
    }
  }

  // 3. Install SKILL.md only for selected skill-capable clients
  if (!opts.noSkills) {
    const skillDirs = new Set(selected.flatMap((c) => c.skillDirs));
    if (opts.clients.length === 0 && fs.existsSync(path.join(home, ".agents"))) {
      skillDirs.add(path.join(home, ".agents", "skills", "discord-send"));
    }
    if (skillDirs.size > 0) {
      const md = renderSkillMarkdown(nodePath, cliDst, tokenPath);
      if (!opts.dryRun) {
        for (const dir of skillDirs) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "SKILL.md"), md, "utf8");
        }
      }
      console.log(`[OK] Global skill "discord-send" -> ${skillDirs.size} location(s)`);
    }
  }

  if (manualSnippets.length > 0) {
    console.log("\nManual paste snippets for skipped/protected configs:");
    for (const item of manualSnippets) console.log(`\n--- ${item.label} (${item.fp}) ---\n${item.snippet}`);
  }

  if (opts.dryRun) return console.log("\nDry run complete. No files were modified.");

  // 4. Optional token / sender / default channel setup
  const discord = await import(pathToFileURL(libDst).href);

  if (opts.tokenFile) {
    const res = await discord.verifyAndSaveToken(fs.readFileSync(opts.tokenFile, "utf8"));
    console.log(`[OK] Verified & saved bot token for "${res.bot.username}" (${res.bot.id})`);
    if (res.permissionWarning) console.log(`[WARN] ${res.permissionWarning}`);
  }
  if (opts.sender) {
    discord.setSender({ name: opts.sender, includeSender: true, includeMachine: false });
    console.log(`[OK] Sender set to "${opts.sender}"`);
  }
  if (opts.channel && discord.hasToken()) {
    const def = await discord.setDefault({ server: opts.server, channel: opts.channel });
    console.log(`[OK] Default channel set to ${def.defaultGuildName} / #${def.defaultChannelName}`);
  }

  if (opts.nonInteractive) {
    return console.log(`\nInstall complete! Verify anytime with:\n  "${launcherPath}" doctor`);
  }

  console.log("\n--- Quick Setup ---");
  let verifiedBot = null;

  if (!discord.hasToken()) {
    const token = (await askPrompt("Paste Discord Bot Token (hidden, or Enter to skip): ", { hidden: true })).trim();
    if (token) {
      const res = await discord.verifyAndSaveToken(token);
      verifiedBot = res.bot;
      console.log(`[OK] Connected as bot "${res.bot.username}" (${res.bot.id})`);
      if (res.permissionWarning) console.log(`[WARN] ${res.permissionWarning}`);
      if (res.guilds.length === 0) console.log(`\nYour bot isn't in a server yet! Invite it here:\n  ${res.inviteUrl}\n`);
    }
  } else {
    console.log("[OK] Existing bot token found (keeping it).");
  }

  const detected = discord.resolveSender();
  const senderAns = (await askPrompt(`Your display name in Discord [Enter for auto: "${detected.name}"]: `)).trim();
  if (senderAns) {
    discord.setSender({ name: senderAns, includeSender: true, includeMachine: false });
    console.log(`[OK] Messages will show as **${senderAns}**: ...`);
  } else {
    console.log(`[OK] Using auto-detected name: **${detected.name}** (${detected.source})`);
  }

  if (discord.hasToken() && !discord.loadConfig().defaultChannelId) {
    const guilds = await discord.listGuilds();
    if (guilds.length === 0) {
      const bot = verifiedBot || (await discord.verifyBot());
      console.log(`Invite your bot to a server first:\n  ${bot.inviteUrl}`);
    } else {
      let guild = guilds[0];
      if (guilds.length > 1) {
        console.log("\nServers your bot belongs to:");
        guilds.forEach((g, idx) => console.log(`  ${idx + 1}. ${g.name} (${g.id})`));
        const gIdx = Number((await askPrompt(`Select server [1-${guilds.length}, Enter for 1]: `)).trim() || "1") - 1;
        if (Number.isInteger(gIdx) && gIdx >= 0 && gIdx < guilds.length) guild = guilds[gIdx];
      }
      const textChannels = (await discord.listChannels(guild.id)).filter((c) => c.type === "text");
      if (textChannels.length > 0) {
        console.log(`\nChannels in "${guild.name}": ${textChannels.map((c) => "#" + c.name).join(", ")}`);
        const suggested = textChannels.find((c) => c.name.toLowerCase() === "code")?.name || textChannels[0].name;
        const chosen = (await askPrompt(`Default channel [Enter for #${suggested}]: `)).trim() || suggested;
        const def = await discord.setDefault({ server: guild.id, channel: chosen });
        console.log(`[OK] Default channel set to ${def.defaultGuildName} / #${def.defaultChannelName}`);
      }
    }
  }

  console.log(`\nAll set! Verify anytime with:\n  "${launcherPath}" doctor`);
  console.log("Restart desktop apps (Claude Desktop / Cursor / VS Code) to load the new MCP server.");
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
    console.error(`\nInstall error: ${err.message}`);
    process.exit(1);
  });
}
