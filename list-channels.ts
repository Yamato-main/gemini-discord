import { Client, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './src/shared/config.js';

const config = loadConfig(process.cwd());
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log("Channels:");
  client.guilds.cache.forEach(guild => {
    guild.channels.cache.forEach(channel => {
      console.log(`${channel.name} : ${channel.id}`);
    });
  });
  process.exit(0);
});

client.login(config.discordBotToken).catch(console.error);
