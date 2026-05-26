# ledger — Daily Category Summary Bot (Farmhand)

Ledger is the farmhand who keeps the ranch records. Every day at 22:00 ICT, it reads all text channels in every Discord category (skipping #general), summarises the past 24 hours of activity using a local Ollama model, and posts the result to a `#bot-summary` channel inside that category (created automatically if missing).

## Deploy checklist — read this every time you change ledger

1. Bump version in `package.json`
2. `git commit && git push origin main`
3. Trigger Coolify deploy via the Coolify webhook (set up in Coolify dashboard for this service)
4. Verify: `curl https://ledger.locolbeef.com/health` shows the new version
5. **If slash command structure changed**: exec into the container and run `bun run deploy`, then Ctrl+R in Discord

## Deployment

- **Target**: Coolify (VM 100, 192.168.1.158) — Docker Compose, auto-deploy from GitHub `main`
- **Health sidecar port**: 3002
- **Public URL**: `https://ledger.locolbeef.com` (via `cf-deploy ledger http://<COOLIFY_IP>:3002`)

## Slash Commands

| Command | Description |
|---------|-------------|
| `/summarize` | Manually trigger a summary for the current category |
| `/summarize hours:<N>` | Summarize the last N hours (1–168) instead of 24 |

## Environment Variables

See `.env.example`. Key vars:
- `BOT_TOKEN` — Discord bot token
- `APP_ID` — Discord application ID
- `OLLAMA_HOST` — Ollama API base URL (default: `http://192.168.1.39:11434`)
- `OLLAMA_MODEL` — model to use (default: `qwen2.5:14b`)
- `SUMMARY_CRON` — cron expression in Asia/Bangkok timezone (default: `0 22 * * *`)
- `HEALTH_PORT` — health sidecar port (default: `3002`)

## Required Bot Permissions

Invite with permissions integer **`84032`**:
- `VIEW_CHANNEL`
- `SEND_MESSAGES`
- `READ_MESSAGE_HISTORY`
- `MANAGE_CHANNELS` (to create `#bot-summary` if missing)
- `EMBED_LINKS`

Required privileged intents (enable in Developer Portal → Bot tab):
- `MESSAGE_CONTENT`

## Non-obvious Decisions

- **Skips #general channels** (exact name match, case-insensitive) — these are social channels, not project-relevant.
- **Skips bot messages** when collecting — avoids the summary referencing its own previous summaries.
- **Max 300 messages per channel** — prevents Ollama prompt overflow on very busy channels; most recent messages within the window are prioritised.
- **`#bot-summary` auto-created** if the category doesn't have one — no manual setup required per project.
- **Deferred `/summarize` reply is ephemeral** — the trigger message is only visible to the invoker; the actual summary goes into `#bot-summary` for everyone.
- **Ollama call uses `stream: false`** — simpler, single-response handling; summaries typically complete in under 30 seconds.
