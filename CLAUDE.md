# ledger — Daily Summary + Meeting Recorder (Farmhand)

Ledger is the farmhand who keeps the ranch records. It does two things:
1. **Daily summaries** — Every day at 22:00 ICT, reads all text channels in every category, summarises 24 hours of activity with Ollama, and posts to `#bot-summary` (auto-created).
2. **Meeting recording** — Joins a voice channel on demand, transcribes speech per-speaker using Whisper, and at meeting end uploads a raw transcript file and posts an AI summary to `#bot-meeting-summary`.

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
| `/meeting start` | Join your current voice channel and start recording |
| `/meeting end` | End the meeting, upload raw transcript, post summary to `#bot-meeting-summary` |

## Environment Variables

See `.env.example`. Key vars:
- `BOT_TOKEN` — Discord bot token
- `APP_ID` — Discord application ID
- `OLLAMA_HOST` — Ollama API base URL (default: `http://192.168.1.39:11434`)
- `OLLAMA_MODEL` — model to use (default: `qwen2.5:14b`)
- `SUMMARY_CRON` — cron expression in Asia/Bangkok timezone (default: `0 22 * * *`)
- `HEALTH_PORT` — health sidecar port (default: `3002`)
- `OPENAI_API_KEY` — **required for `/meeting start`** — used to call OpenAI Whisper for speech-to-text
- `WHISPER_URL` — optional override for a self-hosted Whisper-compatible endpoint (e.g. faster-whisper-server)
- `WHISPER_LANG` — optional BCP-47 language hint sent to Whisper (e.g. `th`)

## Required Bot Permissions

Invite with permissions integer **`3230784`**:
- `VIEW_CHANNEL`
- `SEND_MESSAGES`
- `READ_MESSAGE_HISTORY`
- `MANAGE_CHANNELS` (to create `#bot-summary` / `#bot-meeting-summary`)
- `EMBED_LINKS`
- `ATTACH_FILES` (to upload raw transcript files)
- `CONNECT` (to join voice channels)

Required privileged intents (enable in Developer Portal → Bot tab):
- `MESSAGE_CONTENT`
- `SERVER_MEMBERS` (to resolve display names in voice)

## Non-obvious Decisions

- **Skips #general channels** (exact name match, case-insensitive) — these are social channels, not project-relevant.
- **Skips bot messages** when collecting — avoids the summary referencing its own previous summaries.
- **Max 300 messages per channel** — prevents Ollama prompt overflow on very busy channels; most recent messages within the window are prioritised.
- **`#bot-summary` auto-created** if the category doesn't have one — no manual setup required per project.
- **Deferred `/summarize` reply is ephemeral** — the trigger message is only visible to the invoker; the actual summary goes into `#bot-summary` for everyone.
- **Ollama call uses `stream: false`** — simpler, single-response handling; summaries typically complete in under 30 seconds.
- **`selfDeaf: false` is required** on the voice connection — the bot must be undeafened to receive audio packets from other users.
- **Per-utterance transcription** — each contiguous speech segment (1 s silence = end) is transcribed separately and attributed to that speaker; short segments (<5 Opus packets, ~100 ms) are discarded as noise.
- **opusscript + libsodium-wrappers** — pure-JS/WASM libraries chosen over native alternatives (`@discordjs/opus`, `sodium-native`) for Alpine Docker compatibility without build tools.
- **30 s drain window on `/meeting end`** — after destroying the voice connection, waits up to 30 s for any in-flight Whisper calls to complete before posting results.
- **Auto-end after 5 min empty** — when all humans leave, a 5-minute countdown starts; rejoining cancels it. Bot notifies the text channel when the countdown begins.
