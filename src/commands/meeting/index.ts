import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { BotCommand } from '../../types';
import { startMeeting, endMeeting, getMeetingSession } from '../../utils/voice';

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('meeting')
    .setDescription('Record and summarise voice meetings')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Join your current voice channel and start recording'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('End the meeting, upload transcript, and post summary'),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') await handleStart(interaction);
    else if (sub === 'end') await handleEnd(interaction);
  },
};

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.editReply('You must be in a voice channel to start a meeting.');
    return;
  }

  if (getMeetingSession(interaction.guildId!)) {
    await interaction.editReply(
      'A meeting is already being recorded in this server. Use `/meeting end` to stop it first.',
    );
    return;
  }

  try {
    await startMeeting(interaction.client, voiceChannel, interaction.channelId);
  } catch (err) {
    await interaction.editReply(
      `Failed to start meeting: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  await interaction.editReply(
    `🎙️ Recording started in **${voiceChannel.name}**.\n` +
      `All speech will be transcribed and attributed. Use \`/meeting end\` when you're done.\n` +
      `The meeting will also auto-end if everyone leaves for 5 minutes.`,
  );
}

async function handleEnd(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!getMeetingSession(interaction.guildId!)) {
    await interaction.editReply('No meeting is currently being recorded in this server.');
    return;
  }

  await interaction.editReply(
    '⏹️ Ending meeting… waiting for any in-progress transcriptions, then generating summary.',
  );

  // endMeeting posts directly to #bot-meeting-summary — nothing more to reply
  await endMeeting(interaction.client, interaction.guildId!, 'command');
}

export default command;
