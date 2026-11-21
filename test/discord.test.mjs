import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("splitDiscordMessage enforces <=2000 limit on tricky fence & emoji boundaries", async () => {
  const { splitDiscordMessage } = await import(pathToFileURL(path.join(ROOT, "lib", "discord.mjs")).href);

  // Astra reproduction: 1994 'a' + \n + ``` + \n + abc
  const tricky = "a".repeat(1994) + "\n```\nabc";
  const trickyChunks = splitDiscordMessage(tricky, 2000);
  for (const c of trickyChunks) {
    assert.ok(c.length <= 2000, `Chunk exceeded 2000: ${c.length}`);
  }

  // Inline triple backticks should NOT open a multi-line fence
  const inline = "Check ```const x = 1``` and " + "b".repeat(2100);
  const inlineChunks = splitDiscordMessage(inline, 2000);
  assert.ok(inlineChunks.length >= 2);
  for (const c of inlineChunks) {
    assert.ok(c.length <= 2000, `Inline chunk exceeded 2000: ${c.length}`);
  }

  // Balanced fences across a long code block
  const longCode =
    "```typescript\n" +
    Array.from({ length: 120 }, (_, i) => `const item_${i} = "${"x".repeat(28)}";`).join("\n") +
    "\n```";
  const codeChunks = splitDiscordMessage(longCode, 2000);
  assert.ok(codeChunks.length >= 2);
  for (const c of codeChunks) {
    assert.ok(c.length <= 2000, `Code chunk exceeded 2000: ${c.length}`);
    const ticks = (c.match(/^```/gm) || []).length;
    assert.equal(ticks % 2, 0, `Unbalanced fence count ${ticks}`);
  }

  // Surrogate pair (emoji) must never be split in half
  const emojis = "🚀".repeat(1005); // 2010 UTF-16 code units
  const emojiChunks = splitDiscordMessage(emojis, 2000);
  assert.equal(emojiChunks.length, 2);
  assert.equal(emojiChunks[0].length, 2000);
  assert.equal(emojiChunks[1].length, 10);
  // Check neither chunk starts/ends with an unpaired surrogate
  for (const c of emojiChunks) {
    assert.equal(c.includes("\uFFFD"), false);
    const lastCode = c.charCodeAt(c.length - 1);
    assert.equal(lastCode >= 0xd800 && lastCode <= 0xdbff, false, "Split high surrogate!");
  }
});

test("CLI parseArgs rejects unknown flags and missing flag values", async () => {
  const { parseArgs } = await import(pathToFileURL(path.join(ROOT, "cli.mjs")).href);

  assert.throws(() => parseArgs(["send", "hello", "--chanel", "private"]), /Unknown flag: --chanel/);
  assert.throws(() => parseArgs(["send", "hello", "--from", "--no-sender"]), /requires a value/);
  assert.throws(() => parseArgs(["send", "hello", "--file"]), /requires a value/);
  assert.throws(() => parseArgs(["send", "--json=true"]), /does not take a value/);

  const ok = parseArgs(["send", "hello", "--channel", "code", "--no-sender", "--json"]);
  assert.deepEqual(ok.positional, ["send", "hello"]);
  assert.equal(ok.flags.channel, "code");
  assert.equal(ok.flags["no-sender"], true);
  assert.equal(ok.flags.json, true);
});

test("discord.mjs core: wrong-server rejection, allowed_mentions, 429 no double-read, forum single attachment, codeFile, readMessages", async () => {
  const tmpCfg = makeTempDir("t3-discord-cfg-");
  const prevCfgDir = process.env.T3_DISCORD_CONFIG_DIR;
  const prevTok = process.env.T3_DISCORD_TOKEN;
  const origFetch = globalThis.fetch;

  process.env.T3_DISCORD_CONFIG_DIR = tmpCfg;
  process.env.T3_DISCORD_TOKEN = "TEST_FAKE_TOKEN.PART2.PART3_SECRET";

  try {
    const mod = await import(
      pathToFileURL(path.join(ROOT, "lib", "discord.mjs")).href + `?t=${Date.now()}`
    );

    // Save default channel on Server A
    mod.saveConfig({
      defaultGuildId: "111111111111111111",
      defaultGuildName: "Server A",
      defaultChannelId: "222222222222222222",
      defaultChannelName: "code",
      defaultThreadId: "",
      defaultThreadName: "",
      senderName: "Tester",
      includeSender: true,
      includeMachine: false,
      aliases: {},
    });

    const calls = [];
    globalThis.fetch = async (url, opts) => {
      const u = new URL(url);
      calls.push({ method: opts.method, path: u.pathname + u.search, body: opts.body, headers: opts.headers });

      if (u.pathname === "/api/v10/users/@me/guilds") {
        return jsonResponse([
          { id: "111111111111111111", name: "Server A", owner: true },
          { id: "999999999999999999", name: "Server B", owner: false },
        ]);
      }
      if (u.pathname === "/api/v10/channels/222222222222222222") {
        return jsonResponse({ id: "222222222222222222", name: "code", type: 0, guild_id: "111111111111111111" });
      }
      if (u.pathname === "/api/v10/guilds/111111111111111111/channels") {
        return jsonResponse([
          { id: "222222222222222222", name: "code", type: 0, position: 0 },
          { id: "333333333333333333", name: "forum-dev", type: 15, position: 1 },
        ]);
      }
      if (u.pathname === "/api/v10/channels/222222222222222222/messages" && opts.method === "POST") {
        return jsonResponse({ id: "555555555555555555" });
      }
      if (u.pathname === "/api/v10/channels/222222222222222222/messages" && opts.method === "GET") {
        return jsonResponse([
          { id: "2", author: { username: "bob", bot: false }, timestamp: "2026-11-21T20:01:00Z", content: "second", attachments: [] },
          { id: "1", author: { username: "alice", bot: false }, timestamp: "2026-11-21T20:00:00Z", content: "first", attachments: [] },
        ]);
      }
      if (u.pathname === "/api/v10/channels/333333333333333333/threads" && opts.method === "POST") {
        return jsonResponse({ id: "444444444444444444", name: "New Post", message: { id: "666666666666666666" } });
      }
      if (u.pathname === "/api/v10/channels/444444444444444444/messages" && opts.method === "POST") {
        return jsonResponse({ id: "777777777777777777" });
      }
      return jsonResponse({ message: "Not Found" }, 404);
    };

    // 1. Passing --server "Server B" without --channel must NOT fall back to Server A's default channel
    await assert.rejects(
      () => mod.resolveTarget({ server: "Server B" }),
      /no channel or thread was specified/
    );

    // 2. Normal send includes allowed_mentions: { parse: [] } and proper User-Agent
    const sendRes = await mod.sendMessage({
      content: "ping @everyone safely",
      replyTo: "https://discord.com/channels/111111111111111111/222222222222222222/123456789012345678",
    });
    assert.equal(sendRes.ok, true);
    const postCall = calls.find((c) => c.method === "POST" && c.path.includes("/messages"));
    const bodyObj = JSON.parse(postCall.body);
    assert.deepEqual(bodyObj.allowed_mentions, { parse: [] });
    assert.equal(bodyObj.message_reference.message_id, "123456789012345678");
    assert.ok(postCall.headers["User-Agent"].startsWith("DiscordBot ("));

    // 3. Token-in-message and config-dir attachment are blocked
    await assert.rejects(
      () => mod.sendMessage({ content: "oops TEST_FAKE_TOKEN.PART2.PART3_SECRET" }),
      /refusing to send/i
    );
    const fakeTokenFile = path.join(tmpCfg, "token.txt");
    fs.writeFileSync(fakeTokenFile, "abc\n");
    await assert.rejects(
      () => mod.sendMessage({ content: "hi", files: [fakeTokenFile] }),
      /Refusing to read or attach/i
    );

    // 4. Forum createThreadName + files + multi-chunk uploads attachment ONLY ONCE (in starter)
    const sampleFile = path.join(os.tmpdir(), `t3-sample-${Date.now()}.txt`);
    fs.writeFileSync(sampleFile, "line1\nline2\nline3\n");
    try {
      calls.length = 0;
      const forumRes = await mod.sendMessage({
        content: "a".repeat(2500),
        channel: "forum-dev",
        createThreadName: "New Post",
        files: [sampleFile],
        attachLong: false,
      });
      assert.equal(forumRes.chunksSent, 2);
      assert.deepEqual(forumRes.messageIds, ["666666666666666666", "777777777777777777"]);
      const threadPost = calls.find((c) => c.path.endsWith("/333333333333333333/threads"));
      const followUp = calls.find((c) => c.path.endsWith("/444444444444444444/messages"));
      assert.ok(threadPost.body instanceof FormData, "Forum starter should carry attachment FormData");
      assert.equal(typeof followUp.body, "string", "Follow-up chunk must NOT re-upload files");

      // 5. codeFile + lines formats slice cleanly
      const codeSlice = mod.parseCodeFileArg(`${sampleFile}:2-3`);
      assert.ok(codeSlice.markdown.includes("lines 2-3"));
      assert.ok(codeSlice.markdown.includes("line2\nline3"));
    } finally {
      fs.rmSync(sampleFile, { force: true });
    }

    // 6. readMessages returns chronological order (oldest first)
    const readRes = await mod.readMessages({ limit: 5 });
    assert.equal(readRes.count, 2);
    assert.equal(readRes.messages[0].content, "first");
    assert.equal(readRes.messages[1].content, "second");

    // 7. 429 with retry_after > 5 does NOT throw "Body is unusable"
    globalThis.fetch = async () => jsonResponse({ message: "Too Many Requests", retry_after: 12 }, 429);
    await assert.rejects(
      () => mod.discordRequest("GET", "/users/@me"),
      /Discord API 429: Too Many Requests/
    );
  } finally {
    globalThis.fetch = origFetch;
    if (prevCfgDir === undefined) delete process.env.T3_DISCORD_CONFIG_DIR;
    else process.env.T3_DISCORD_CONFIG_DIR = prevCfgDir;
    if (prevTok === undefined) delete process.env.T3_DISCORD_TOKEN;
    else process.env.T3_DISCORD_TOKEN = prevTok;
    fs.rmSync(tmpCfg, { recursive: true, force: true });
  }
});

test("installer safe JSON/TOML upsert, collision protection, legacy migration, JSONC skip, and uninstall", async () => {
  const { upsertJsonMcp, removeJsonMcp, upsertCodexToml, removeCodexToml } = await import(
    pathToFileURL(path.join(ROOT, "install.mjs")).href
  );

  const tmp = makeTempDir("t3-discord-inst-");
  try {
    // 1. Migrate our own legacy "discord" entry to "t3-discord" without clobbering unrelated entries
    const mcpFile = path.join(tmp, "mcp.json");
    fs.writeFileSync(
      mcpFile,
      JSON.stringify({
        mcpServers: {
          other: { command: "other-bin", args: [] },
          discord: { command: "/old/node", args: ["/home/u/.config/t3-discord/mcp-server.mjs"] },
        },
      })
    );
    const res1 = upsertJsonMcp(mcpFile, "mcpServers", {
      command: "/new/node",
      args: ["/home/u/.config/t3-discord/mcp-server.mjs"],
    });
    assert.equal(res1.status, "migrated");
    const after1 = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
    assert.equal(after1.mcpServers.discord, undefined);
    assert.equal(after1.mcpServers["t3-discord"].command, "/new/node");
    assert.deepEqual(after1.mcpServers.other, { command: "other-bin", args: [] });

    // Second run is idempotent ("unchanged")
    const res2 = upsertJsonMcp(mcpFile, "mcpServers", {
      command: "/new/node",
      args: ["/home/u/.config/t3-discord/mcp-server.mjs"],
    });
    assert.equal(res2.status, "unchanged");

    // Uninstall removes only our entry and preserves unrelated entries
    const rem1 = removeJsonMcp(mcpFile, "mcpServers");
    assert.equal(rem1.status, "removed");
    const afterRem = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
    assert.equal(afterRem.mcpServers["t3-discord"], undefined);
    assert.deepEqual(afterRem.mcpServers.other, { command: "other-bin", args: [] });

    // 2. Unrelated "discord" entry is NOT touched; unrelated "t3-discord" conflicts unless --force
    const otherFile = path.join(tmp, "other.json");
    fs.writeFileSync(
      otherFile,
      JSON.stringify({
        mcpServers: {
          discord: { command: "npx", args: ["-y", "@iqai/mcp-discord"] },
        },
      })
    );
    const resOther = upsertJsonMcp(otherFile, "mcpServers", {
      command: "/new/node",
      args: ["/home/u/.config/t3-discord/mcp-server.mjs"],
    });
    assert.equal(resOther.status, "added");
    const afterOther = JSON.parse(fs.readFileSync(otherFile, "utf8"));
    assert.equal(afterOther.mcpServers.discord.command, "npx");
    assert.equal(afterOther.mcpServers["t3-discord"].command, "/new/node");

    // 3. JSONC with comments is skipped cleanly without destroying comments
    const jsoncFile = path.join(tmp, "vscode-mcp.json");
    const jsoncOriginal = "// user comment\n{\n  \"servers\": {}\n}\n";
    fs.writeFileSync(jsoncFile, jsoncOriginal);
    const resJsonc = upsertJsonMcp(jsoncFile, "servers", {
      type: "stdio",
      command: "/new/node",
      args: ["/home/u/.config/t3-discord/mcp-server.mjs"],
    });
    assert.equal(resJsonc.status, "skipped");
    assert.ok(resJsonc.manualSnippet.includes("t3-discord"));
    assert.equal(fs.readFileSync(jsoncFile, "utf8"), jsoncOriginal);

    // 4. Codex TOML handles apostrophe in Windows path + migrates legacy section + updates stale path
    const tomlFile = path.join(tmp, "config.toml");
    fs.writeFileSync(
      tomlFile,
      `[windows]\nsandbox = true\n\n[mcp_servers.discord]\ncommand = "C:\\\\old\\\\node.exe"\nargs = ["C:\\\\Users\\\\O'Brien\\\\.config\\\\t3-discord\\\\mcp-server.mjs"]\n`
    );
    const tomlRes = upsertCodexToml(
      tomlFile,
      "C:\\Users\\O'Brien\\node.exe",
      "C:\\Users\\O'Brien\\.config\\t3-discord\\mcp-server.mjs"
    );
    assert.equal(tomlRes.status, "migrated");
    const tomlOut = fs.readFileSync(tomlFile, "utf8");
    assert.ok(tomlOut.includes("[mcp_servers.t3-discord]"));
    assert.ok(!tomlOut.includes("[mcp_servers.discord]"));
    assert.ok(tomlOut.includes('command = "C:\\\\Users\\\\O\'Brien\\\\node.exe"'));

    const tomlUnchanged = upsertCodexToml(
      tomlFile,
      "C:\\Users\\O'Brien\\node.exe",
      "C:\\Users\\O'Brien\\.config\\t3-discord\\mcp-server.mjs"
    );
    assert.equal(tomlUnchanged.status, "unchanged");

    const tomlRemoved = removeCodexToml(tomlFile);
    assert.equal(tomlRemoved.status, "removed");
    assert.ok(!fs.readFileSync(tomlFile, "utf8").includes("mcp_servers.t3-discord"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("MCP server negotiates protocol version, exposes 9 annotated tools, and drains on stdin EOF", async () => {
  const child = spawn(process.execPath, [path.join(ROOT, "mcp-server.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      T3_DISCORD_CONFIG_DIR: makeTempDir("t3-discord-mcp-"),
      T3_DISCORD_TOKEN: "",
      DISCORD_BOT_TOKEN: "",
    },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "discord_status", arguments: {} } },
  ];
  for (const r of requests) {
    child.stdin.write(JSON.stringify(r) + "\n");
  }
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));
  assert.equal(stderr.trim(), "", `Unexpected stderr: ${stderr}`);
  const responses = stdout.trim().split(/\r?\n/).map((l) => JSON.parse(l));
  assert.equal(responses.length, 3);
  assert.equal(responses[0].result.protocolVersion, "2025-06-18");
  assert.equal(responses[1].result.tools.length, 9);
  const readTool = responses[1].result.tools.find((t) => t.name === "discord_read_messages");
  assert.ok(readTool);
  assert.equal(readTool.annotations.readOnlyHint, true);
  const sendTool = responses[1].result.tools.find((t) => t.name === "discord_send_message");
  assert.equal(sendTool.inputSchema.required, undefined);
  assert.ok(sendTool.inputSchema.properties.codeFile);
  assert.ok(sendTool.inputSchema.properties.replyTo);
  const statusPayload = JSON.parse(responses[2].result.content[0].text);
  assert.equal(statusPayload.tokenConfigured, false);
});
