import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, Collection, GatewayIntentBits, Interaction, REST, Routes } from 'discord.js';
import { BotCommand } from './types';
import { startHealthServer } from './health';
import { startScheduler } from './utils/scheduler';
import pkg from '../package.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = new Collection<string, BotCommand>();
const commandsPath = path.join(__dirname, 'commands');

for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
  for (const file of files) {
    const mod = await import(path.join(folderPath, file));
    const command: BotCommand = mod.default;
    if ('data' in command && 'execute' in command) {
      commands.set(command.data.name, command);
    }
  }
}

client.once('clientReady', async (c) => {
  const startedAt = new Date().toUTCString();
  try {
    const rest = new REST().setToken(process.env.BOT_TOKEN!);
    await rest.patch(Routes.currentApplication(), {
      body: { description: `v${pkg.version} — deployed ${startedAt}` },
    });
  } catch (err) {
    console.warn('Could not update bot description:', err);
  }
  console.log(`Ready: ${c.user.tag} (v${pkg.version})`);
  startScheduler(client);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

startHealthServer(Number(process.env.HEALTH_PORT) || 3002);
client.login(process.env.BOT_TOKEN);
