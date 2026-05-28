import {
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  TextChannel,
  VoiceBasedChannel,
  VoiceState,
} from 'discord.js';
import { transcribeOpus } from './transcription';
import { summarizeMeeting, type TranscriptEntry } from './ollama';
import { ensureMeetingSummaryChannel } from './messages';

// 30 seconds of Opus audio @ 20ms per frame = 1500 packets.
// Force-flush at this size so a continuous speaker is split into manageable chunks
// rather than one giant request Whisper has to digest all at once.
const MAX_CHUNK_PACKETS = 1500;

interface MeetingSession {
  guildId: string;
  voiceChannelId: string;
  voiceChannelName: string;
  textChannelId: string;
  categoryId: string | null;
  categoryName: string | null;
  startTime: Date;
  participants: Map<string, string>; // userId → displayName
  transcript: TranscriptEntry[];
  pendingTranscriptions: Set<Promise<void>>; // in-flight Whisper calls
  emptyTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, MeetingSession>();

export function getMeetingSession(guildId: string): MeetingSession | undefined {
  return sessions.get(guildId);
}

export async function startMeeting(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  textChannelId: string,
): Promise<void> {
  if (sessions.has(voiceChannel.guild.id)) {
    throw new Error('A meeting is already recording in this server.');
  }

  console.log(`[meeting] Joining #${voiceChannel.name} (${voiceChannel.id}) in guild ${voiceChannel.guild.id}`);

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
    selfDeaf: false, // must be undeafened to receive audio
    selfMute: true,
  });

  // Log every state transition to aid debugging
  for (const status of Object.values(VoiceConnectionStatus)) {
    connection.on(status as VoiceConnectionStatus, () =>
      console.log(`[meeting] Voice state → ${status}`),
    );
  }
  connection.on('error', (err: Error) =>
    console.error('[meeting] Voice connection error:', err.message),
  );

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch {
    const stuck = connection.state.status;
    console.error(`[meeting] Timed out — stuck in state: ${stuck}`);
    connection.destroy();
    throw new Error(
      `Could not connect to the voice channel (timed out in state: ${stuck}). ` +
        'Check that the bot has CONNECT permission and that UDP is not blocked.',
    );
  }

  const category = voiceChannel.parent;
  const session: MeetingSession = {
    guildId: voiceChannel.guild.id,
    voiceChannelId: voiceChannel.id,
    voiceChannelName: voiceChannel.name,
    textChannelId,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    startTime: new Date(),
    participants: new Map(),
    transcript: [],
    pendingTranscriptions: new Set(),
    emptyTimer: null,
  };

  for (const [id, member] of voiceChannel.members) {
    if (!member.user.bot) session.participants.set(id, member.displayName);
  }

  sessions.set(voiceChannel.guild.id, session);

  // Auto-end when bot gets kicked or loses connection
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (sessions.has(voiceChannel.guild.id)) {
        await endMeeting(client, voiceChannel.guild.id, 'auto');
      }
    }
  });

  // Track which streams we've already attached listeners to — prevents double-subscribing
  // if speaking.on('start') fires while a stream for that user is still open.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configuredStreams = new WeakSet<any>();

  // Subscribe to audio every time a user starts speaking.
  // NO activeStreams guard — we must never skip a speaking event. Transcriptions
  // run async in the background so a slow Whisper call never blocks a future utterance.
  connection.receiver.speaking.on('start', (userId: string) => {
    const member =
      (voiceChannel.members.get(userId) as GuildMember | undefined) ??
      (voiceChannel.guild.members.cache.get(userId) as GuildMember | undefined);

    if (!member || member.user.bot) return;

    if (!session.participants.has(userId)) {
      session.participants.set(userId, member.displayName);
    }

    const stream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 500 },
    });

    // If @discordjs/voice returned an already-active stream (rare: user spoke before
    // their previous stream ended), don't re-attach listeners — they're already there.
    if (configuredStreams.has(stream)) return;
    configuredStreams.add(stream);

    let packets: Buffer[] = [];
    let chunkStart = new Date();

    stream.on('data', (chunk: Buffer) => {
      packets.push(chunk);

      // Force-flush every 30 s so we never build a giant single Whisper request.
      if (packets.length >= MAX_CHUNK_PACKETS) {
        const batch = packets;
        const ts = chunkStart;
        packets = [];
        chunkStart = new Date();
        flushTranscription(session, batch, ts, member);
      }
    });

    stream.on('end', () => {
      if (packets.length >= 5) {
        flushTranscription(session, packets, chunkStart, member);
      }
    });
  });
}

// Fire-and-forget transcription; tracked in session.pendingTranscriptions so
// endMeeting can wait for all of them before posting results.
function flushTranscription(
  session: MeetingSession,
  packets: Buffer[],
  startTime: Date,
  member: GuildMember,
): void {
  const p = (async () => {
    const text = await transcribeOpus(packets);
    const trimmed = text.trim();
    if (trimmed) {
      session.transcript.push({
        timestamp: startTime,
        username: member.user.username,
        displayName: member.displayName,
        text: trimmed,
      });
      // Sort by timestamp so interleaved speech ends up in the right order
      session.transcript.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      console.log(`[meeting] ${member.displayName}: ${trimmed.slice(0, 80)}`);
    }
  })().catch((err) => console.error(`[meeting] Transcription error (${member.displayName}):`, err));

  session.pendingTranscriptions.add(p);
  p.finally(() => session.pendingTranscriptions.delete(p));
}

export async function endMeeting(
  client: Client,
  guildId: string,
  reason: 'command' | 'auto',
): Promise<void> {
  const session = sessions.get(guildId);
  if (!session) return;

  sessions.delete(guildId);
  if (session.emptyTimer) clearTimeout(session.emptyTimer);

  // Disconnect from voice — this triggers stream 'end' events for any live streams,
  // which will queue their final packets as pending transcriptions.
  const connection = getVoiceConnection(guildId);
  connection?.destroy();

  // Wait for every in-flight Whisper call to finish (up to 2 minutes).
  if (session.pendingTranscriptions.size > 0) {
    console.log(`[meeting] Waiting for ${session.pendingTranscriptions.size} pending transcription(s)…`);
    await Promise.race([
      Promise.allSettled([...session.pendingTranscriptions]),
      new Promise<void>((r) => setTimeout(r, 120_000)),
    ]);
  }

  const endTime = new Date();
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const textChannel = guild.channels.cache.get(session.textChannelId) as TextChannel | null;
  await textChannel
    ?.send(
      reason === 'auto'
        ? '🛑 Meeting ended automatically — channel was empty for 5 minutes.'
        : '🛑 Meeting ended.',
    )
    .catch(() => null);

  // Find or create #bot-meeting-summary in the same category
  let summaryChannel: TextChannel;
  try {
    const catChannel = session.categoryId
      ? guild.channels.cache.get(session.categoryId)
      : null;
    const category =
      catChannel?.type === ChannelType.GuildCategory ? catChannel : null;
    summaryChannel = await ensureMeetingSummaryChannel(guild, category);
  } catch (err) {
    console.error('[meeting] Failed to find/create #bot-meeting-summary:', err);
    return;
  }

  const durationMs = endTime.getTime() - session.startTime.getTime();
  const durationStr = formatDuration(durationMs);

  if (session.transcript.length === 0) {
    await summaryChannel.send(
      `📭 **Meeting ended with no transcript** — ${fmtICT(session.startTime)} (${durationStr})`,
    );
    return;
  }

  // Upload raw transcript file
  const rawText = buildRawTranscript(session, endTime);
  const filename = `meeting-${session.startTime.toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;

  await summaryChannel.send({
    content: `📝 **Raw Transcript** — ${fmtICT(session.startTime)} (${durationStr})`,
    files: [{ attachment: Buffer.from(rawText, 'utf-8'), name: filename }],
  });

  // Generate Ollama summary
  let summary: string;
  try {
    summary = await summarizeMeeting(
      session.transcript,
      session.participants,
      session.startTime,
      endTime,
    );
  } catch (err) {
    summary = `_Summary generation failed: ${err instanceof Error ? err.message : String(err)}_`;
  }

  const participantList = [...session.participants.values()].join(', ') || 'Unknown';

  const embed = new EmbedBuilder()
    .setTitle(`Meeting Summary — ${session.categoryName ?? session.voiceChannelName}`)
    .setDescription(summary.slice(0, 4000))
    .setColor(0x5865f2)
    .addFields(
      { name: 'Channel', value: `#${session.voiceChannelName}`, inline: true },
      { name: 'Duration', value: durationStr, inline: true },
      { name: 'Participants', value: participantList, inline: false },
      {
        name: 'Period',
        value: `${fmtICT(session.startTime)} → ${fmtICT(endTime)} ICT`,
        inline: false,
      },
    )
    .setFooter({ text: `Generated by Ledger · meeting ${reason === 'auto' ? 'auto-ended' : 'ended'}` })
    .setTimestamp();

  await summaryChannel.send({ embeds: [embed] });
}

export function handleVoiceStateUpdate(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): void {
  const session = sessions.get(oldState.guild.id);
  if (!session) return;

  const channel = oldState.guild.channels.cache.get(session.voiceChannelId);
  if (!channel || !('members' in channel)) return;

  const voiceChannel = channel as VoiceBasedChannel;
  const humans = voiceChannel.members.filter((m) => !m.user.bot);

  if (humans.size === 0 && !session.emptyTimer) {
    console.log('[meeting] Channel empty — starting 5-min auto-end timer');
    const textCh = oldState.guild.channels.cache.get(session.textChannelId) as TextChannel | null;
    textCh
      ?.send(
        '⏳ Everyone left the call. Meeting will **auto-end in 5 minutes** unless someone rejoins.',
      )
      .catch(() => null);

    session.emptyTimer = setTimeout(
      () => endMeeting(client, session.guildId, 'auto'),
      5 * 60 * 1000,
    );
  } else if (humans.size > 0 && session.emptyTimer) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
    console.log('[meeting] Channel has members again — cancelled auto-end timer');
    const rejoined = newState.member;
    if (rejoined && !rejoined.user.bot) {
      session.participants.set(rejoined.id, rejoined.displayName);
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildRawTranscript(session: MeetingSession, endTime: Date): string {
  const header = [
    'Meeting Recording',
    '=================',
    `Channel:      ${session.voiceChannelName}`,
    ...(session.categoryName ? [`Category:     ${session.categoryName}`] : []),
    `Started:      ${fmtICTFull(session.startTime)}`,
    `Ended:        ${fmtICTFull(endTime)}`,
    `Duration:     ${formatDuration(endTime.getTime() - session.startTime.getTime())}`,
    `Participants: ${[...session.participants.values()].join(', ')}`,
    '',
    'Transcript',
    '----------',
  ].join('\n');

  const lines = session.transcript.map(
    (e) => `[${formatTimestamp(e.timestamp)}] ${e.displayName}: ${e.text}`,
  );

  return `${header}\n${lines.join('\n')}\n`;
}

function fmtICT(date: Date): string {
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtICTFull(date: Date): string {
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export type { MeetingSession };
