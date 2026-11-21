#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { Writable } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const SERVER_KEY = "t3-discord";
const LEGACY_SERVER_KEY = "discord";

function parseInstallerArgs(argv) {
  const opts = {
    dryRun: false,
    nonInteractive: !process.stdin.isTTY,
    listClients: false,
    uninstall: false,
    purge: false,
    all: false,
    noSkills: false,
    force: false,
    help: false,
    clients: [],
    skip: [],
    configPath: "",
    nodePath: "",
    tokenFile: "",
    sender: "",
    channel: "",
    server: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--non-interactive") opts.nonInteractive = true;
    else if (arg === "--list-clients") opts.listClients = true;
    else if (arg === "--uninstall") opts.uninstall = true;
    else if (arg === "--purge") opts.purge = true;
    else if (arg === "--all") opts.all = true;
    else if (arg === "--no-skills") opts.noSkills = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--clients" || arg === "--client") {
      const val = argv[++i];
      if (!val) throw new Error(`${arg} requires a value.`);
      opts.clients.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else if (arg.startsWith("--clients=") || arg.startsWith("--client=")) {
      const val = arg.slice(arg.indexOf("=") + 1);
      opts.clients.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else if (arg === "--skip" || arg === "--exclude") {
      const val = argv[++i];
      if (!val) throw new Error(`${arg} requires a value.`);
      opts.skip.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else if (arg.startsWith("--skip=") || arg.startsWith("--exclude=")) {
      const val = arg.slice(arg.indexOf("=") + 1);
      opts.skip.push(...val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } else if (arg === "--config-path") {
      opts.configPath = argv[++i] || "";
    } else if (arg.startsWith("--config-path=")) {
      opts.configPath = arg.slice("--config-path=".length);
    } else if (arg === "--node") {
      opts.nodePath = argv[++i] || "";
    } else if (arg.startsWith("--node=")) {
      opts.nodePath = arg.slice("--node=".length);
    } else if (arg === "--token-file") {
      opts.tokenFile = argv[++i] || "";
    } else if (arg.startsWith("--token-file=")) {
      opts.tokenFile = arg.slice("--token-file=".length);
    } else if (arg === "--sender") {
      opts.sender = argv[++i] || "";
    } else if (arg.startsWith("--sender=")) {
      opts.sender = arg.slice("--sender=".length);
    } else if (arg === "--channel") {
      opts.channel = argv[++i] || "";
    } else if (arg.startsWith("--channel=")) {
      opts.channel = arg.slice("--channel=".length);
    } else if (arg === "--server") {
      opts.server = argv[++i] || "";
    } else if (arg.startsWith("--server=")) {
      opts.server = arg.slice("--server=".length);
    } else if (arg === "install") {
      // Allow `npx t3-discord install`
    } else if (arg === "uninstall") {
      opts.uninstall = true;
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`t3-discord installer

Usage:
  node install.mjs [options]

Options:
  --list-clients            Show detected AI clients and their config paths (no writes)
  --dry-run                 Preview all changes without writing any files
  --clients=a,b             Explicitly install into named clients (creates missing config files)
                            Supported: antigravity, t3-antigravity, claude-code, claude-desktop,
                            cursor, windsurf, vscode, gemini-cli, codex, zed, opencode
  --skip=a,b                Skip specific auto-detected clients
  --all                     Install into all detected clients without confirmation
  --config-path=<path>      Override config file path (requires a single --clients=<id>)
  --node=<path>             Override absolute Node.js binary path
  --no-skills               Skip installing global SKILL.md files
  --non-interactive         Skip interactive token/sender/channel prompts
  --token-file=<path>       Read and verify bot token from a file
  --sender=<name>           Set display name for outgoing messages
  --server=<name|id>        Set default server (with --channel)
  --channel=<name|id>       Set default channel
  --force                   Overwrite conflicting MCP entries
  --uninstall               Remove t3-discord MCP entries and global skills
  --purge                   With --uninstall, also remove ~/.config/t3-discord (including token)
  -h, --help                Show this help
`);
}

export function resolveStableNodePath(override = "") {
  if (override) return path.resolve(override);
  const execPath = process.execPath;

  if (IS_WIN) {
    if (execPath.toLowerCase().includes("fnm_multishells")) {
      const candidates = [
        process.env.FNM_DIR && path.join(process.env.FNM_DIR, "aliases", "default", "node.exe"),
        process.env.APPDATA && path.join(process.env.APPDATA, "fnm", "aliases", "default", "node.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "fnm", "aliases", "default", "node.exe"),
      ].filter(Boolean);
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
    const voltaWin = path.join(HOME, ".volta", "bin", "node.exe");
    if (execPath.toLowerCase().includes("volta") && fs.existsSync(voltaWin)) {
      return voltaWin;
    }
    return execPath;
  }

  // POSIX (macOS / Linux): avoid ephemeral fnm_multishells or versioned Homebrew Cellar paths
  const voltaPosix = path.join(HOME, ".volta", "bin", "node");
  if (execPath.includes("volta") && fs.existsSync(voltaPosix)) {
    return voltaPosix;
  }
  if (execPath.includes("fnm_multishells")) {
    const candidates = [
      process.env.FNM_DIR && path.join(process.env.FNM_DIR, "aliases", "default", "bin", "node"),
      path.join(HOME, ".local", "share", "fnm", "aliases", "default", "bin", "node"),
      path.join(HOME, "Library", "Application Support", "fnm", "aliases", "default", "bin", "node"),
      path.join(HOME, ".fnm", "aliases", "default", "bin", "node"),
    ].filter(Boolean);
    for (const c of candidates) {
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
  return (
    process.env.T3_DISCORD_CONFIG_DIR ||
    path.join(HOME, ".config", "t3-discord")
  );
}

function findClaudeDesktopPaths() {
  if (IS_WIN) {
    const paths = [];
    if (process.env.APPDATA) {
      paths.push(path.join(process.env.APPDATA, "Claude", "claude_desktop_config.json"));
    }
    // Check Windows Store / MSIX virtualized Roaming path
    if (process.env.LOCALAPPDATA) {
      const pkgsDir = path.join(process.env.LOCALAPPDATA, "Packages");
      if (fs.existsSync(pkgsDir)) {
        try {
          for (const entry of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith("Claude_")) {
              const p = path.join(
                pkgsDir,
                entry.name,
                "LocalCache",
                "Roaming",
                "Claude",
                "claude_desktop_config.json"
              );
              if (fs.existsSync(path.dirname(p))) {
                paths.push(p);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return paths;
  }
  if (IS_MAC) {
    return [
      path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    ];
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
  return [path.join(xdg, "Claude", "claude_desktop_config.json")];
}

function getVSCodeConfigPaths() {
  const bases = [];
  if (IS_WIN && process.env.APPDATA) {
    bases.push(path.join(process.env.APPDATA, "Code", "User", "mcp.json"));
    const insiders = path.join(process.env.APPDATA, "Code - Insiders", "User", "mcp.json");
    if (fs.existsSync(path.dirname(insiders))) bases.push(insiders);
  } else if (IS_MAC) {
    bases.push(path.join(HOME, "Library", "Application Support", "Code", "User", "mcp.json"));
    const insiders = path.join(
      HOME,
      "Library",
      "Application Support",
      "Code - Insiders",
      "User",
      "mcp.json"
    );
    if (fs.existsSync(path.dirname(insiders))) bases.push(insiders);
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
    bases.push(path.join(xdg, "Code", "User", "mcp.json"));
    const insiders = path.join(xdg, "Code - Insiders", "User", "mcp.json");
    if (fs.existsSync(path.dirname(insiders))) bases.push(insiders);
  }
  return bases;
}

function findT3AntigravityConfigPaths() {
  const root = path.join(HOME, ".t3", "userdata", "providers", "antigravity");
  if (!fs.existsSync(root)) return [];
  const results = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgDir = path.join(root, entry.name, "config");
      if (fs.existsSync(cfgDir)) {
        results.push(path.join(cfgDir, "mcp_config.json"));
      }
    }
  } catch {
    // ignore
  }
  return results;
}

/**
 * Snapshot-detects all supported AI clients BEFORE any files or skill directories are created.
 */
export function discoverClients(nodePath, mcpPath, configPathOverride = "", singleClientId = "") {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || "";
  const claudeJsonPath = claudeConfigDir
    ? path.join(claudeConfigDir, ".claude.json")
    : path.join(HOME, ".claude.json");
  const claudeDirPath = claudeConfigDir || path.join(HOME, ".claude");
  const codexHome = process.env.CODEX_HOME || path.join(HOME, ".codex");
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");

  const t3AgyPaths = findT3AntigravityConfigPaths();
  const claudeDesktopPaths = findClaudeDesktopPaths();
  const vscodePaths = getVSCodeConfigPaths();

  const definitions = [
    {
      id: "antigravity",
      label: "Antigravity",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: [path.join(HOME, ".gemini", "config", "mcp_config.json")],
      detected:
        fs.existsSync(path.join(HOME, ".gemini", "config")) ||
        fs.existsSync(path.join(HOME, ".gemini", "antigravity")) ||
        t3AgyPaths.length > 0,
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [
        path.join(HOME, ".gemini", "config", "skills", "discord-send"),
        ...(fs.existsSync(path.join(HOME, ".gemini", "skills"))
          ? [path.join(HOME, ".gemini", "skills", "discord-send")]
          : []),
      ],
    },
    {
      id: "t3-antigravity",
      label: "T3 Code (Antigravity provider)",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: t3AgyPaths,
      detected: t3AgyPaths.length > 0,
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [],
    },
    {
      id: "claude-code",
      label: "Claude Code",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: [claudeJsonPath],
      detected: fs.existsSync(claudeJsonPath) || fs.existsSync(claudeDirPath),
      entry: { type: "stdio", command: nodePath, args: [mcpPath] },
      skillDirs: [path.join(claudeDirPath, "skills", "discord-send")],
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: claudeDesktopPaths.filter((p) => fs.existsSync(path.dirname(p))).length > 0
        ? claudeDesktopPaths.filter((p) => fs.existsSync(path.dirname(p)))
        : claudeDesktopPaths.slice(0, 1),
      detected: claudeDesktopPaths.some((p) => fs.existsSync(path.dirname(p))),
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [],
    },
    {
      id: "cursor",
      label: "Cursor",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: [path.join(HOME, ".cursor", "mcp.json")],
      detected: fs.existsSync(path.join(HOME, ".cursor")),
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [],
    },
    {
      id: "windsurf",
      label: "Windsurf",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: [path.join(HOME, ".codeium", "windsurf", "mcp_config.json")],
      detected: fs.existsSync(path.join(HOME, ".codeium", "windsurf")),
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [],
    },
    {
      id: "vscode",
      label: "VS Code (Copilot)",
      format: "json",
      rootKey: "servers",
      optInOnly: false,
      paths: vscodePaths.filter((p) => fs.existsSync(path.dirname(p))).length > 0
        ? vscodePaths.filter((p) => fs.existsSync(path.dirname(p)))
        : vscodePaths.slice(0, 1),
      detected: vscodePaths.some((p) => fs.existsSync(path.dirname(p))),
      entry: { type: "stdio", command: nodePath, args: [mcpPath] },
      skillDirs: [],
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      format: "json",
      rootKey: "mcpServers",
      optInOnly: false,
      paths: [path.join(HOME, ".gemini", "settings.json")],
      detected: fs.existsSync(path.join(HOME, ".gemini", "settings.json")),
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [],
    },
    {
      id: "codex",
      label: "Codex CLI",
      format: "toml",
      rootKey: "mcp_servers",
      optInOnly: false,
      paths: [path.join(codexHome, "config.toml")],
      detected: fs.existsSync(codexHome),
      entry: { command: nodePath, args: [mcpPath] },
      skillDirs: [path.join(codexHome, "skills", "discord-send")],
    },
    {
      id: "zed",
      label: "Zed (opt-in)",
      format: "json",
      rootKey: "context_servers",
      optInOnly: true,
      paths: [path.join(xdgConfig, "zed", "settings.json")],
      detected: fs.existsSync(path.join(xdgConfig, "zed")),
      entry: { command: { path: nodePath, args: [mcpPath] } },
      skillDirs: [],
    },
    {
      id: "opencode",
      label: "OpenCode (opt-in)",
      format: "json",
      rootKey: "mcp",
      optInOnly: true,
      paths: [path.join(xdgConfig, "opencode", "opencode.json")],
      detected: fs.existsSync(path.join(xdgConfig, "opencode")),
      entry: { type: "local", command: [nodePath, mcpPath] },
      skillDirs: [],
    },
  ];

  if (configPathOverride && singleClientId) {
    const target = definitions.find((d) => d.id === singleClientId);
    if (target) {
      target.paths = [path.resolve(configPathOverride)];
    }
  }

  return definitions;
}

function isOurMcpEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const serialized = JSON.stringify(entry).toLowerCase();
  return serialized.includes("t3-discord") && serialized.includes("mcp-server.mjs");
}

function atomicWriteFile(filePath, content, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (backup && fs.existsSync(filePath)) {
    const bakPath = `${filePath}.t3-discord.bak`;
    if (!fs.existsSync(bakPath)) {
      fs.copyFileSync(filePath, bakPath);
    }
  }
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function upsertJsonMcp(filePath, rootKey, entry, { dryRun = false, force = false } = {}) {
  const exists = fs.existsSync(filePath);
  const raw = exists ? fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "") : "";

  let data = {};
  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      return {
        status: "skipped",
        reason: "File contains JSONC comments or invalid JSON — not overwritten to preserve formatting",
        manualSnippet: JSON.stringify({ [rootKey]: { [SERVER_KEY]: entry } }, null, 2),
      };
    }
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      status: "skipped",
      reason: "Root JSON value is not an object",
      manualSnippet: JSON.stringify({ [rootKey]: { [SERVER_KEY]: entry } }, null, 2),
    };
  }

  if (data[rootKey] !== undefined && (typeof data[rootKey] !== "object" || data[rootKey] === null || Array.isArray(data[rootKey]))) {
    return {
      status: "conflict",
      reason: `Expected "${rootKey}" to be a JSON object`,
      manualSnippet: JSON.stringify({ [rootKey]: { [SERVER_KEY]: entry } }, null, 2),
    };
  }

  if (!data[rootKey]) data[rootKey] = {};
  const bucket = data[rootKey];

  // Safely migrate legacy "discord" key ONLY if it belongs to t3-discord
  let migrated = false;
  if (bucket[LEGACY_SERVER_KEY] && isOurMcpEntry(bucket[LEGACY_SERVER_KEY])) {
    if (!bucket[SERVER_KEY]) {
      bucket[SERVER_KEY] = bucket[LEGACY_SERVER_KEY];
    }
    delete bucket[LEGACY_SERVER_KEY];
    migrated = true;
  }

  const prev = bucket[SERVER_KEY];
  if (prev && !isOurMcpEntry(prev) && !force) {
    return {
      status: "conflict",
      reason: `Existing "${SERVER_KEY}" entry belongs to another server (pass --force to overwrite)`,
      manualSnippet: JSON.stringify({ [rootKey]: { [SERVER_KEY]: entry } }, null, 2),
    };
  }

  const next = prev ? { ...prev, ...entry } : entry;
  if (!migrated && prev && JSON.stringify(prev) === JSON.stringify(next)) {
    return { status: "unchanged" };
  }

  bucket[SERVER_KEY] = next;
  const serialized = JSON.stringify(data, null, 2) + "\n";

  if (!dryRun) {
    atomicWriteFile(filePath, serialized, { backup: exists });
  }

  return {
    status: migrated ? "migrated" : prev ? "updated" : "added",
  };
}

export function removeJsonMcp(filePath, rootKey, { dryRun = false } = {}) {
  if (!fs.existsSync(filePath)) return { status: "absent" };
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) return { status: "absent" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: "skipped", reason: "Unparseable JSON/JSONC — remove manually" };
  }
  const bucket = data?.[rootKey];
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    return { status: "absent" };
  }

  let removed = false;
  for (const key of [SERVER_KEY, LEGACY_SERVER_KEY]) {
    if (bucket[key] && isOurMcpEntry(bucket[key])) {
      delete bucket[key];
      removed = true;
    }
  }
  if (!removed) return { status: "absent" };

  if (!dryRun) {
    atomicWriteFile(filePath, JSON.stringify(data, null, 2) + "\n", { backup: true });
  }
  return { status: "removed" };
}

function findTomlSectionRange(lines, sectionHeader) {
  const target = `[${sectionHeader}]`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === target) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\[.+\]$/.test(trimmed)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function upsertCodexToml(filePath, nodePath, mcpPath, { dryRun = false } = {}) {
  const exists = fs.existsSync(filePath);
  const raw = exists ? fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "") : "";
  const lines = raw ? raw.split(/\r?\n/) : [];

  // Always use JSON.stringify (valid TOML basic double-quoted strings on Windows, macOS, and Linux)
  const newSectionLines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(nodePath)}`,
    `args = [${JSON.stringify(mcpPath)}]`,
  ];

  // Check if a legacy [mcp_servers.discord] belongs to t3-discord and migrate it
  let migrated = false;
  const legacyRange = findTomlSectionRange(lines, `mcp_servers.${LEGACY_SERVER_KEY}`);
  if (legacyRange) {
    const legacyText = lines.slice(legacyRange.start, legacyRange.end).join("\n").toLowerCase();
    if (legacyText.includes("t3-discord") && legacyText.includes("mcp-server.mjs")) {
      lines.splice(legacyRange.start, legacyRange.end - legacyRange.start);
      migrated = true;
    }
  }

  const existingRange = findTomlSectionRange(lines, `mcp_servers.${SERVER_KEY}`);
  let status = "added";
  if (existingRange) {
    const oldBlock = lines
      .slice(existingRange.start, existingRange.end)
      .filter((l) => l.trim() !== "")
      .join("\n");
    const newBlock = newSectionLines.join("\n");
    if (!migrated && oldBlock === newBlock) {
      return { status: "unchanged" };
    }
    lines.splice(existingRange.start, existingRange.end - existingRange.start, ...newSectionLines, "");
    status = migrated ? "migrated" : "updated";
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    if (lines.length > 0) lines.push("");
    lines.push(...newSectionLines);
    status = migrated ? "migrated" : "added";
  }

  const out = lines.join("\n").trimEnd() + "\n";
  if (!dryRun) {
    atomicWriteFile(filePath, out, { backup: exists });
  }
  return { status };
}

export function removeCodexToml(filePath, { dryRun = false } = {}) {
  if (!fs.existsSync(filePath)) return { status: "absent" };
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  let removed = false;

  for (const key of [SERVER_KEY, LEGACY_SERVER_KEY]) {
    const range = findTomlSectionRange(lines, `mcp_servers.${key}`);
    if (range) {
      const text = lines.slice(range.start, range.end).join("\n").toLowerCase();
      if (text.includes("t3-discord") && text.includes("mcp-server.mjs")) {
        lines.splice(range.start, range.end - range.start);
        removed = true;
      }
    }
  }

  if (!removed) return { status: "absent" };
  if (!dryRun) {
    atomicWriteFile(filePath, lines.join("\n").trimEnd() + "\n", { backup: true });
  }
  return { status: "removed" };
}

function renderSkillMarkdown(nodePath, cliPath, tokenPath) {
  const shellLang = IS_WIN ? "powershell" : "bash";
  // Call node cli.mjs directly so Windows cmd.exe never mangles &, ^, %, or quotes!
  const cliExamples = IS_WIN
    ? `$node = "${nodePath}"\n$cli = "${cliPath}"\n\n# Send short message to default channel\n& $node $cli send "Your message and https://link-here"\n\n# Send a source file slice directly (auto language fence + header)\n& $node $cli send --code-file "C:\\path\\to\\file.ts:40-80"\n\n# Send multiline or non-ASCII text safely via UTF-8 temp file\n$tmp = Join-Path $env:TEMP "discord-msg.txt"\nSet-Content -Path $tmp -Encoding utf8NoBOM -Value @'\nHere is the snippet:\n\`\`\`ts\nexport const ok = true;\n\`\`\`\n'@\n& $node $cli send --message-file $tmp; Remove-Item $tmp -ErrorAction SilentlyContinue\n\n# Target a specific channel, thread, alias, reply, or attach a file\n& $node $cli send "Message" --channel "chat"\n& $node $cli send "Message" --channel "code" --thread "auth-refactor"\n& $node $cli send "Message" --alias "friend"\n& $node $cli send "Message" --reply-to "https://discord.com/channels/..."\n& $node $cli send "Here is the file" --file "C:\\abs\\path\\file.ts"\n& $node $cli read --limit 10`
    : `node_bin="${nodePath}"\ncli="${cliPath}"\n\n# Send short message to default channel\n"$node_bin" "$cli" send "Your message and https://link-here"\n\n# Send a source file slice directly (auto language fence + header)\n"$node_bin" "$cli" send --code-file "/abs/path/file.ts:40-80"\n\n# Send multiline message / code snippet via stdin\n"$node_bin" "$cli" send --stdin <<'EOF'\nHere is the snippet:\n\`\`\`ts\nexport const ok = true;\n\`\`\`\nEOF\n\n# Target a specific channel, thread, alias, reply, or read recent messages\n"$node_bin" "$cli" send "Message" --channel "chat"\n"$node_bin" "$cli" send "Message" --channel "code" --thread "auth-refactor"\n"$node_bin" "$cli" send "Message" --alias "friend"\n"$node_bin" "$cli" send "Message" --reply-to "https://discord.com/channels/..."\n"$node_bin" "$cli" read --limit 10`;

  const otherOps = IS_WIN
    ? `& "${nodePath}" "${cliPath}" status\n& "${nodePath}" "${cliPath}" doctor\n& "${nodePath}" "${cliPath}" channels [--server "<server>"]\n& "${nodePath}" "${cliPath}" threads [--channel "<channel>"] [--archived]\n& "${nodePath}" "${cliPath}" set-default --channel "code" [--thread "<thread>"]\n& "${nodePath}" "${cliPath}" set-sender "<name>" [--auto]\n& "${nodePath}" "${cliPath}" alias set friend --channel "chat"`
    : `"${nodePath}" "${cliPath}" status\n"${nodePath}" "${cliPath}" doctor\n"${nodePath}" "${cliPath}" channels [--server "<server>"]\n"${nodePath}" "${cliPath}" threads [--channel "<channel>"] [--archived]\n"${nodePath}" "${cliPath}" set-default --channel "code" [--thread "<thread>"]\n"${nodePath}" "${cliPath}" set-sender "<name>" [--auto]\n"${nodePath}" "${cliPath}" alias set friend --channel "chat"`;

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

Send or read Discord messages via the local \`t3-discord\` integration.

## Fast Path (Always Prefer 1 Step!)

When the user asks to send something to Discord, **send it immediately in ONE call**:
- **Do NOT** call \`discord_status\`, \`discord_list_servers\`, or \`discord_list_channels\` first! The bot and default channel are already configured; \`send\` resolves everything automatically and returns a clear error if anything is missing.
- **If \`discord_send_message\` is directly callable (eager MCP tool)**: call it right away with \`{ content?, codeFile?, lines?, channel?, thread?, alias?, createThreadName?, replyTo?, files? }\`.
- **If MCP tools are lazy-loaded or absent**: run \`node cli.mjs\` directly in one shell call (faster than reading multiple MCP schema files, and avoids Windows \`cmd.exe\` quoting issues):

\`\`\`${shellLang}
${cliExamples}
\`\`\`

## Other Operations (Only When Asked or on Error)

Use the matching MCP tool (\`discord_read_messages\`, \`discord_status\`, \`discord_list_servers\`, \`discord_list_channels\`, \`discord_list_threads\`, \`discord_set_default\`, \`discord_set_sender\`, \`discord_manage_alias\`) or CLI command:

\`\`\`${shellLang}
${otherOps}
\`\`\`

## Security & Formatting Rules

1. **NEVER** read, print, or echo \`${tokenPath}\`, \`T3_DISCORD_TOKEN\`, or \`DISCORD_BOT_TOKEN\`. If the token is missing or invalid, ask the user to save it (if your host provides \`request_secret\` with \`delivery: "file"\`, use that and pass \`--token-file\`; otherwise ask them to run \`node "${cliPath}" set-token --stdin\`).
2. **Sender attribution**: Messages automatically prepend the sender's name (from \`config.json\` \`senderName\`, or auto-detected from \`git config --global user.name\` -> OS user -> hostname). Only use \`--from\` or \`--no-sender\` (\`includeSender: false\`) if the user asks.
3. **Default destination**: When the user doesn't name a specific channel/thread (note: phrases like *"with chat message ..."* mean message text, NOT the \`#chat\` channel), omit destination flags so the configured default is used.
4. **Code snippets**: For local files, prefer \`codeFile\` + \`lines\` (or \`--code-file path:40-80\`). For inline snippets, wrap in triple backticks with a language tag. Messages >2000 chars auto-split with valid fences, and >3-chunk messages auto-upload as a snippet file.
5. **Confirmation**: Reply concisely with the destination channel/thread and the clickable Discord link returned by the tool.
`;
}

function askHidden(promptText) {
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });
    rl.question(promptText, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

function askLine(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const opts = parseInstallerArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.configPath && opts.clients.length !== 1) {
    throw new Error("--config-path requires exactly one client via --clients=<id>.");
  }

  const installDir = getInstallDir();
  const nodePath = resolveStableNodePath(opts.nodePath);
  const libDst = path.join(installDir, "lib", "discord.mjs");
  const pkgDst = path.join(installDir, "package.json");
  const cliDst = path.join(installDir, "cli.mjs");
  const mcpDst = path.join(installDir, "mcp-server.mjs");
  const tokenPath = path.join(installDir, "token.txt");
  const launcherPath = IS_WIN
    ? path.join(installDir, "discord-send.cmd")
    : path.join(installDir, "discord-send");

  // Snapshot ALL clients BEFORE touching any directories on disk!
  const allClients = discoverClients(
    nodePath,
    mcpDst,
    opts.configPath,
    opts.clients.length === 1 ? opts.clients[0] : ""
  );

  // Validate --clients / --skip names
  const validIds = new Set(allClients.map((c) => c.id));
  for (const id of [...opts.clients, ...opts.skip]) {
    if (!validIds.has(id)) {
      throw new Error(
        `Unknown client "${id}". Valid clients: ${Array.from(validIds).join(", ")}`
      );
    }
  }

  if (opts.listClients) {
    console.log(`t3-discord client detection (Node: ${nodePath})\n`);
    for (const c of allClients) {
      const tag = c.detected ? (c.optInOnly ? "detected (opt-in)" : "detected") : "not found";
      const pathStr = c.paths.length ? c.paths.join(", ") : "(none)";
      console.log(`  ${c.id.padEnd(16)} [${tag}]  ${c.label} -> ${pathStr}`);
    }
    return;
  }

  // Determine target clients
  const skipSet = new Set(opts.skip);
  let selectedClients;
  if (opts.clients.length > 0) {
    const wanted = new Set(opts.clients);
    selectedClients = allClients.filter((c) => wanted.has(c.id) && !skipSet.has(c.id));
  } else {
    selectedClients = allClients.filter(
      (c) => c.detected && !c.optInOnly && !skipSet.has(c.id)
    );
  }

  // Handle --uninstall
  if (opts.uninstall) {
    console.log(`t3-discord uninstaller${opts.dryRun ? " (DRY RUN)" : ""}`);
    const targetsToClean = opts.clients.length > 0 ? selectedClients : allClients;
    for (const c of targetsToClean) {
      for (const filePath of c.paths) {
        const res =
          c.format === "toml"
            ? removeCodexToml(filePath, { dryRun: opts.dryRun })
            : removeJsonMcp(filePath, c.rootKey, { dryRun: opts.dryRun });
        if (res.status !== "absent") {
          console.log(`  [${res.status.toUpperCase()}] ${c.label}: ${filePath}${res.reason ? ` (${res.reason})` : ""}`);
        }
      }
      for (const skillDir of c.skillDirs) {
        const skillFile = path.join(skillDir, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          if (!opts.dryRun) {
            fs.rmSync(skillDir, { recursive: true, force: true });
          }
          console.log(`  [REMOVED] Skill: ${skillDir}`);
        }
      }
    }
    const agentsSkill = path.join(HOME, ".agents", "skills", "discord-send");
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
    console.log(
      "  [NOTE] Node path contains a version number; re-run `node install.mjs` (or pass --node) if you upgrade Node."
    );
  }

  // Interactive confirmation of detected clients (unless --all, --clients, --dry-run, or --non-interactive)
  if (
    !opts.nonInteractive &&
    !opts.all &&
    !opts.dryRun &&
    opts.clients.length === 0 &&
    selectedClients.length > 0
  ) {
    console.log("\nDetected AI clients:");
    for (const c of selectedClients) {
      console.log(`  - ${c.label} (${c.paths.join(", ")})`);
    }
    const ans = (await askLine("Register t3-discord MCP server in these clients? [Y/n]: ")).trim().toLowerCase();
    if (ans === "n" || ans === "no") {
      selectedClients = [];
      console.log("Skipped MCP client registration (CLI still installed).");
    }
  }

  // 1. Copy runtime files
  if (!opts.dryRun) {
    fs.mkdirSync(path.join(installDir, "lib"), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "lib", "discord.mjs"), libDst);
    fs.copyFileSync(path.join(__dirname, "cli.mjs"), cliDst);
    fs.copyFileSync(path.join(__dirname, "mcp-server.mjs"), mcpDst);
    const srcPkg = path.join(__dirname, "package.json");
    if (fs.existsSync(srcPkg)) {
      fs.copyFileSync(srcPkg, pkgDst);
    }

    if (IS_WIN) {
      fs.writeFileSync(launcherPath, `@echo off\r\n"${nodePath}" "${cliDst}" %*\r\n`, "utf8");
    } else {
      fs.writeFileSync(
        launcherPath,
        `#!/usr/bin/env sh\nexec "${nodePath}" "${cliDst}" "$@"\n`,
        "utf8"
      );
      fs.chmodSync(launcherPath, 0o755);
    }
  }
  console.log(`[OK] Runtime files -> ${installDir}`);

  // 2. Register MCP server per client with isolated error handling
  const manualSnippets = [];
  if (selectedClients.length === 0) {
    console.log("[INFO] No MCP clients registered (run with --list-clients or --clients=<id>).");
  } else {
    console.log("MCP client registrations:");
    for (const c of selectedClients) {
      for (const filePath of c.paths) {
        try {
          const res =
            c.format === "toml"
              ? upsertCodexToml(filePath, nodePath, mcpDst, { dryRun: opts.dryRun })
              : upsertJsonMcp(filePath, c.rootKey, c.entry, {
                  dryRun: opts.dryRun,
                  force: opts.force,
                });
          console.log(
            `  [${res.status.toUpperCase()}] ${c.label}: ${filePath}${
              res.reason ? ` (${res.reason})` : ""
            }`
          );
          if (res.manualSnippet) {
            manualSnippets.push({ label: c.label, filePath, snippet: res.manualSnippet });
          }
        } catch (err) {
          console.log(`  [ERROR] ${c.label}: ${filePath} (${err.message})`);
          manualSnippets.push({
            label: c.label,
            filePath,
            snippet: JSON.stringify({ [c.rootKey]: { [SERVER_KEY]: c.entry } }, null, 2),
          });
        }
      }
    }
  }

  // 3. Install global SKILL.md ONLY for detected/selected skill-capable clients
  if (!opts.noSkills) {
    const skillDirs = new Set();
    for (const c of selectedClients) {
      for (const d of c.skillDirs) skillDirs.add(d);
    }
    if (fs.existsSync(path.join(HOME, ".agents"))) {
      skillDirs.add(path.join(HOME, ".agents", "skills", "discord-send"));
    }

    if (skillDirs.size > 0) {
      const skillMd = renderSkillMarkdown(nodePath, cliDst, tokenPath);
      for (const dir of skillDirs) {
        if (!opts.dryRun) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "SKILL.md"), skillMd, "utf8");
        }
      }
      console.log(`[OK] Global skill "discord-send" -> ${skillDirs.size} detected location(s)`);
    }
  }

  if (manualSnippets.length > 0) {
    console.log("\nManual paste snippets for skipped/protected configs:");
    for (const item of manualSnippets) {
      console.log(`\n--- ${item.label} (${item.filePath}) ---\n${item.snippet}`);
    }
  }

  if (opts.dryRun) {
    console.log("\nDry run complete. No files were modified.");
    return;
  }

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
    console.log(`\nInstall complete! Verify anytime with:\n  "${launcherPath}" doctor`);
    return;
  }

  console.log("\n--- Quick Setup ---");
  let verifiedBot = null;

  if (!discord.hasToken()) {
    const token = (
      await askHidden("Paste Discord Bot Token (hidden, or Enter to skip): ")
    ).trim();
    if (token) {
      const res = await discord.verifyAndSaveToken(token);
      verifiedBot = res.bot;
      console.log(`[OK] Connected as bot "${res.bot.username}" (${res.bot.id})`);
      if (res.permissionWarning) console.log(`[WARN] ${res.permissionWarning}`);
      if (res.guilds.length === 0) {
        console.log(`\nYour bot isn't in a server yet! Invite it here:\n  ${res.inviteUrl}\n`);
      }
    }
  } else {
    console.log("[OK] Existing bot token found (keeping it).");
  }

  const detected = discord.resolveSender();
  const senderAnswer = (
    await askLine(`Your display name in Discord [Enter for auto: "${detected.name}"]: `)
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
      if (guilds.length === 0) {
        const bot = verifiedBot || (await discord.verifyBot());
        console.log(`Invite your bot to a server first:\n  ${bot.inviteUrl}`);
      } else {
        let guild = guilds[0];
        if (guilds.length > 1) {
          console.log("\nServers your bot belongs to:");
          guilds.forEach((g, idx) => console.log(`  ${idx + 1}. ${g.name} (${g.id})`));
          const gAns = (await askLine(`Select server [1-${guilds.length}, Enter for 1]: `)).trim();
          const gIdx = gAns ? Number(gAns) - 1 : 0;
          if (Number.isInteger(gIdx) && gIdx >= 0 && gIdx < guilds.length) {
            guild = guilds[gIdx];
          }
        }
        const channels = await discord.listChannels(guild.id);
        const textChannels = channels.filter((c) => c.type === "text");
        if (textChannels.length > 0) {
          console.log(
            `\nChannels in "${guild.name}": ${textChannels.map((c) => "#" + c.name).join(", ")}`
          );
          const suggested =
            textChannels.find((c) => c.name.toLowerCase() === "code")?.name ||
            textChannels[0].name;
          const chAnswer = (
            await askLine(`Default channel [Enter for #${suggested}]: `)
          ).trim();
          const chosen = chAnswer || suggested;
          if (chosen) {
            const def = await discord.setDefault({ server: guild.id, channel: chosen });
            console.log(
              `[OK] Default channel set to ${def.defaultGuildName} / #${def.defaultChannelName}`
            );
          }
        }
      }
    }
  }

  console.log(`\nAll set! Verify anytime with:\n  "${launcherPath}" doctor`);
  console.log('Restart desktop apps (Claude Desktop / Cursor / VS Code) to load the new MCP server.');
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  main().catch((err) => {
    console.error(`\nInstall error: ${err.message}`);
    process.exit(1);
  });
}
