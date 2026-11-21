# t3-discord

Send code snippets, file excerpts, links, and attachments—and read recent messages—directly from your AI coding tools to Discord.

- **Zero runtime dependencies** — pure Node.js 18+ using built-in `fetch`
- **Tiny context footprint** — 9 focused MCP tools (with `readOnlyHint` annotations) instead of 100+ server-admin tools
- **Multi-client 1-command installer** — auto-detects and registers in **T3 Code / Antigravity**, **Claude Code**, **Claude Desktop**, **Codex CLI**, **Cursor**, **Windsurf**, **VS Code (Copilot)**, and **Gemini CLI** (plus opt-in **Zed** / **OpenCode**)
- **Shared-bot friendly** — automatically tags messages with who sent them (custom name or auto-detected from `git config --global user.name` → OS user → hostname)
- **Built for code**:
  - Send exact file slices (`--code-file path/to/app.ts:40-80`) with automatic syntax highlighting
  - Code-fence-aware splitting (never breaks ```` ```ts ```` blocks or emojis across Discord's 2,000-char limit)
  - Auto-uploads >3-chunk snippets as an inline file attachment instead of flooding chat
  - Suppresses accidental `@everyone` / `@here` / role pings by default (`allowed_mentions: { parse: [] }`)

---

## Quick Install

### Option A: One-command install (Node.js 18+)
```bash
npx github:Tolkium/t3-discord
```

### Option B: Clone or Download ZIP
1. Clone or [download ZIP](https://github.com/Tolkium/t3-discord/archive/refs/heads/main.zip) and unzip it:
   ```bash
   git clone https://github.com/Tolkium/t3-discord.git
   cd t3-discord
   ```
2. Run the installer:
   ```bash
   node install.mjs
   ```

The installer detects your installed AI clients, confirms before editing their configs (with automatic `.bak` backups and atomic writes), and guides you through:
1. Pasting your **Discord Bot Token** (input is hidden, verified before saving, and stored outside git at `~/.config/t3-discord/token.txt` with user-only permissions)
2. Picking your **display name** (or pressing Enter to auto-detect)
3. Choosing your **default server & channel** (e.g. `#code`)

*(Restart desktop apps like Claude Desktop, Cursor, or VS Code after installing to load the new `t3-discord` MCP server.)*

---

## Create Your Own Discord Bot (60 seconds)

If you don't already have a Bot Token from a friend:

1. Open the **[Discord Developer Portal](https://discord.com/developers/applications)** → **New Application** → **Create**.
2. *(Optional, for a private bot)* Go to **Installation** → set **Install Link** to **None** → **Save**. Then go to **Bot** → toggle **Public Bot** **OFF** → **Save**.
3. On the **Bot** tab, click **Reset Token** → **Copy** *(the Bot Token is ~70 characters with 2 dots — do not confuse it with the 32-char OAuth2 Client Secret)*.
   - *(Optional)* If you also want `discord_read_messages` to read messages written by **humans** (not just bots), toggle **Message Content Intent** **ON** on the **Bot** tab. Sending messages does **not** require any privileged intents.
4. Run `node install.mjs` and paste your Bot Token. If the bot isn't in a server yet, the installer prints a **1-click invite URL** pre-configured with only the 7 minimal permissions:
   - View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History.

---

## Usage in Your AI Tool

Talk naturally in T3 Code, Claude Code, Claude Desktop, Codex, Cursor, Windsurf, VS Code, or Gemini CLI:

- *"Send this snippet to Discord"* → posts to your default channel/thread
- *"Send lines 40–80 of `src/auth.ts` to Discord with a short note"* → uses `codeFile` + `lines`
- *"Send this link to Discord in `#dev`"* → targets `#dev`
- *"Post this in thread `bugfix` inside `#code`"* → posts inside that thread
- *"Reply to `https://discord.com/channels/...` saying it's fixed"* → uses `replyTo`
- *"Check the last 10 messages in `#code` on Discord"* → uses `discord_read_messages`
- *"Save `#general` as Discord alias `team`"* → creates a reusable shortcut
- *"Set my Discord sender name to Alice"* → sets your display name

---

## Useful Installer & CLI Flags

```bash
# Inspect detected AI clients without writing anything
node install.mjs --list-clients
node install.mjs --dry-run

# Target specific clients (or opt-in Zed / OpenCode)
node install.mjs --clients=cursor,vscode,claude-desktop
node install.mjs --clients=zed --non-interactive

# Cleanly remove MCP entries and global skills (keeps token.txt unless --purge)
node install.mjs --uninstall

# Diagnostics & 1-click invite URL
node ~/.config/t3-discord/cli.mjs doctor
node ~/.config/t3-discord/cli.mjs invite
```

### Manual MCP Config (for any other MCP client)
```json
{
  "mcpServers": {
    "t3-discord": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/.config/t3-discord/mcp-server.mjs"]
    }
  }
}
```
*(In VS Code `mcp.json`, use top-level `"servers"` instead of `"mcpServers"` and add `"type": "stdio"`.)*

---

## Security Notes

- Your Bot Token is stored locally at `~/.config/t3-discord/token.txt` (restricted to your user account) — never inside any project repository or client MCP JSON.
- `t3-discord` blocks attaching files inside `~/.config/t3-discord` and refuses to send messages that contain your bot token string.
- If you share a bot token privately with a friend so you can both post to the same server, remember that **anyone with the token can post anywhere the bot has access**—never commit it or post it in public chats.

## License

[MIT](./LICENSE)
