import {
  CategoryChannel,
  ChannelType,
  Client,
  Collection,
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

  const textChannels = category.children.cache.filter(
    (c): c is TextChannel =>
      c.type === ChannelType.GuildText &&
      !SKIP_CHANNEL_NAMES.includes(c.name.toLowerCase()),
  );

  for (const [, channel] of textChannels) {
    const msgs = await fetchMessagesInRange(channel, since, before);
    results.push({
      channelName: channel.name,
      messages: msgs.map((m) => ({
        author: m.author.username,
        content: truncate(m.content, 500),
        timestamp: formatTime(m.createdAt),
      })),
    });
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

export async function ensureSummaryChannel(
  client: Client,
  category: CategoryChannel,
): Promise<TextChannel> {
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

  // Keep it pinned to the top of the category after every summary
  try {
    await channel.setPosition(0);
  } catch {
    // Non-fatal — bot may lack Manage Channels; summary still posts
  }

  return channel;
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
