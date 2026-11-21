# t3-discord

Send code snippets, links, notes, and files directly from **T3 Code** (Antigravity, Claude, and Codex) to your Discord server, channels, and threads.

- **Zero dependencies** (Node.js 18+ built-in `fetch`)
- **Works globally** across all T3 Code projects (installs both a Global Skill + MCP Server sharing one config)
- **Shared-bot friendly**: automatically tags messages with who sent them (custom name, or auto-detected from `git config --global user.name` → OS username → hostname)
- **Code-block aware**: automatically splits messages > 2,000 characters while keeping fenced ```` ```code``` ```` blocks valid

---

## Setup (for your friend — takes ~30 seconds)

### Requirements
- **Node.js 18+** installed
- **Discord Bot Token** (shared privately via DM — **never commit or share publicly**)

### Install
1. **Download** the ZIP ([direct download](https://github.com/Tolkium/t3-discord/archive/refs/heads/main.zip)) and unzip it — or clone the repo:
   ```bash
   git clone https://github.com/Tolkium/t3-discord.git
   cd t3-discord
   ```
2. Open a terminal inside the `t3-discord` folder and run:
   ```bash
   node install.mjs
   ```
3. Follow the 3 short prompts:
   - **Discord Bot Token**: paste the token sent to you privately
   - **Display name**: press Enter to auto-detect your Git/PC name, or type your nickname (e.g. `Matelko`)
   - **Default channel**: press Enter for `#code` (or type any channel name)

That's it! It automatically configures Antigravity (including T3 Code), Claude, and Codex.

---

## Usage in T3 Code

Just talk naturally in any T3 Code thread:
- *"Send this code snippet to Discord"* → posts to your default channel (`#code`) with your name
- *"Send this link to Discord in `#chat`"* → posts to `#chat`
- *"Post this in thread `bugs` inside `#code`"* → posts to that specific thread
- *"Create a new thread called `API v2` in `#code` and post this"* → creates a thread and posts there
- *"Set my Discord sender name to Matelko"* → changes your displayed name
- *"Change my default Discord channel to `#openclaw`"* → updates your default channel

## Security
- Your bot token is stored locally at `~/.config/t3-discord/token.txt` (never inside any project repo).
- Never commit `token.txt` or paste the token into public chats/issues.
