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
  activeStreams: Set<string>;
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

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapterCreator: voiceChannel.guild.voiceAdapterCreator as any,
    selfDeaf: false, // must be undeafened to receive audio
    selfMute: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch {
    connection.destroy();
    throw new Error('Could not connect to the voice channel (timed out after 30s).');
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
    activeStreams: new Set(),
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

  // Subscribe to audio as each user begins speaking
  connection.receiver.speaking.on('start', (userId: string) => {
    if (session.activeStreams.has(userId)) return;

    const member =
      (voiceChannel.members.get(userId) as GuildMember | undefined) ??
      (voiceChannel.guild.members.cache.get(userId) as GuildMember | undefined);

    if (!member || member.user.bot) return;

    if (!session.participants.has(userId)) {
      session.participants.set(userId, member.displayName);
    }

    session.activeStreams.add(userId);

    const stream = connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });

    const packets: Buffer[] = [];
    const chunkStart = new Date();

    stream.on('data', (chunk: Buffer) => packets.push(chunk));

    stream.on('end', async () => {
      try {
        if (packets.length >= 5) {
          const text = await transcribeOpus(packets);
          if (text.trim()) {
            session.transcript.push({
              timestamp: chunkStart,
              username: member.user.username,
              displayName: member.displayName,
              text: text.trim(),
            });
            console.log(`[meeting] ${member.displayName}: ${text.trim().slice(0, 80)}`);
          }
        }
      } catch (err) {
        console.error('[meeting] Transcription error:', err);
      } finally {
        session.activeStreams.delete(userId);
      }
    });
  });
}

export async function endMeeting(
  client: Client,
  guildId: string,
  reason: 'command' | 'auto',
): Promise<void> {
  const session = sessions.get(guildId);
  if (!session) return;

  // Remove session immediately to prevent duplicate end calls
  sessions.delete(guildId);
  if (session.emptyTimer) clearTimeout(session.emptyTimer);

  // Disconnect from voice (this will end all active audio streams)
  const connection = getVoiceConnection(guildId);
  connection?.destroy();

  // Wait for in-flight transcriptions to finish (max 30s)
  const deadline = Date.now() + 30_000;
  while (session.activeStreams.size > 0 && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  const endTime = new Date();
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const textChannel = guild.channels.cache.get(session.textChannelId) as TextChannel | null;

  const endMsg =
    reason === 'auto'
      ? '🛑 Meeting ended automatically — channel was empty for 5 minutes.'
      : '🛑 Meeting ended.';
  await textChannel?.send(endMsg).catch(() => null);

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

    // Track newly rejoined participant
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
