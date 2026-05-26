import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BotCommand } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commands: object[] = [];
const commandsPath = path.join(__dirname, 'commands');

for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
  for (const file of files) {
    const mod = await import(path.join(folderPath, file));
    const command: BotCommand = mod.default;
    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
    }
  }
}

const rest = new REST().setToken(process.env.BOT_TOKEN!);
const guildId = process.env.GUILD_ID;

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(process.env.APP_ID!, guildId), { body: commands });
  console.log(`Registered ${commands.length} guild command(s) to guild ${guildId}`);
} else {
  await rest.put(Routes.applicationCommands(process.env.APP_ID!), { body: commands });
  console.log(`Registered ${commands.length} global command(s)`);
}
