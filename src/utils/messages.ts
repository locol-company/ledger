import {
  AnyThreadChannel,
  CategoryChannel,
  ChannelType,
  Client,
  Collection,
  Guild,
  Message,
  TextChannel,
} from 'discord.js';
import { ChannelMessages } from './ollama';

const MAX_MESSAGES_PER_CHANNEL = 300;
const SKIP_CHANNEL_NAMES = ['general'];

export async function fetchCategoryMessages(
  category: CategoryChannel,
  since: Date,
  before: Date,
): Promise<ChannelMessages[]> {
  const results: ChannelMessages[] = [];

  // Refresh guild channel cache so children are up to date
  await category.guild.channels.fetch();

  const textChannels = category.children.cache.filter(
    (c): c is TextChannel =>
      c.type === ChannelType.GuildText &&
      !SKIP_CHANNEL_NAMES.includes(c.name.toLowerCase()),
  );

  // Debug: log all children regardless of type
  category.children.cache.forEach((c) =>
    console.log(`[ledger]   child: #${c.name} type=${c.type}`),
  );
  console.log(`[ledger] "${category.name}": found ${textChannels.size} text channel(s)`);

  for (const [, channel] of textChannels) {
    // Main channel messages
    const mainMsgs = await fetchMessagesInRange(channel, since, before);

    // Thread messages (active + recently archived)
    const threadMsgs = await fetchThreadMessages(channel, since, before);

    const all = [...mainMsgs, ...threadMsgs].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp,
    );

    results.push({
      channelName: channel.name,
      messages: all.map((m) => ({
        author: m.author.username,
        content: truncate(m.content, 500),
        timestamp: formatTime(m.createdAt),
      })),
    });

    console.log(`[ledger]   #${channel.name}: ${mainMsgs.length} main + ${threadMsgs.length} thread messages`);
  }

  return results;
}

async function fetchMessagesInRange(
  channel: TextChannel,
  since: Date,
  before: Date,
): Promise<Message[]> {
  const collected: Message[] = [];
  let lastId: string | undefined;

  outer: while (true) {
    const options: Parameters<TextChannel['messages']['fetch']>[0] = { limit: 100 };
    if (lastId) options.before = lastId;

    let batch: Collection<string, Message>;
    try {
      batch = await channel.messages.fetch(options);
    } catch {
      break;
    }

    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (msg.createdAt > before) continue;
      if (msg.createdAt < since) break outer;
      if (!msg.author.bot && msg.content.trim()) {
        collected.push(msg);
      }
      if (collected.length >= MAX_MESSAGES_PER_CHANNEL) break outer;
    }

    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return collected.reverse();
}

async function fetchThreadMessages(
  channel: TextChannel,
  since: Date,
  before: Date,
): Promise<Message[]> {
  const collected: Message[] = [];

  // Gather active + archived threads
  const threads: AnyThreadChannel[] = [];

  try {
    const active = await channel.threads.fetchActive();
    threads.push(...active.threads.values());
  } catch { /* no permission or no threads */ }

  try {
    const archived = await channel.threads.fetchArchived({ limit: 20 });
    for (const t of archived.threads.values()) {
      // Only include threads that were active within our window
      if (t.archiveTimestamp && t.archiveTimestamp >= since.getTime()) {
        threads.push(t);
      }
    }
  } catch { /* no permission or no threads */ }

  for (const thread of threads) {
    const msgs = await fetchMessagesInRange(thread as unknown as TextChannel, since, before);
    collected.push(...msgs);
  }

  return collected;
}

export async function ensureSummaryChannel(
  client: Client,
  category: CategoryChannel,
): Promise<TextChannel> {
  await category.guild.channels.fetch();

  const existing = category.children.cache.find(
    (c): c is TextChannel =>
      c.type === ChannelType.GuildText && c.name === 'bot-summary',
  );

  const channel = existing ?? await category.guild.channels.create({
    name: 'bot-summary',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Daily AI-generated summaries of activity in this category',
    position: 0,
  }) as TextChannel;

  try {
    await channel.setPosition(0);
  } catch { /* non-fatal */ }

  return channel;
}

// Used for the master summary channel — works with or without a parent category
export async function findOrCreateChannel(
  guild: Guild,
  category: CategoryChannel | null,
  name: string,
): Promise<TextChannel> {
  if (category) await category.guild.channels.fetch();

  const existing = (category?.children.cache ?? guild.channels.cache).find(
    (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name,
  );

  if (existing) {
    try { await existing.setPosition(0); } catch { /* non-fatal */ }
    return existing;
  }

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    ...(category ? { parent: category.id } : {}),
    topic: 'Daily cross-project overview — all projects at a glance',
    position: 0,
  }) as TextChannel;

  return created;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
}
