import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'node:fs';

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_SERVER_ID;
  const stickerName = 'nicole_panic';
  const stickerTags = 'panic';
  const stickerDescription = 'Nicole from ZZZ panicking/overwhelmed';
  const imagePath = 'nicole_sticker.png';

  if (!token || !guildId) {
    console.error('Missing token or guildId');
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  try {
    await client.login(token);
    await client.guilds.fetch();
    const guild = await client.guilds.fetch(guildId);
    
    if (!guild) {
      console.error('Guild not found');
      process.exit(1);
    }

    const sticker = await guild.stickers.create({
      file: imagePath,
      name: stickerName,
      tags: stickerTags,
      description: stickerDescription,
      reason: 'User requested sticker creation via Gemini CLI',
    });

    console.log(`Successfully created sticker: ${sticker.name} (${sticker.id})`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create sticker:', err);
    process.exit(1);
  }
}

main();
