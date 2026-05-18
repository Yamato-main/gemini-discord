import { 
  SlashCommandBuilder, 
  CommandInteraction, 
  Client, 
  REST, 
  Routes, 
  PermissionFlagsBits,
  AutocompleteInteraction
} from 'discord.js';
import { log } from './log.js';
import type { Config } from '../shared/types.js';
import type { DaemonState } from './api.js';
import type { ConversationMemory } from './memory.js';
import { spawn } from 'node:child_process';
import { updateEnvModel } from '../shared/config.js';
import { runtimeStore } from './runtime.js';
import { resetConversationSession } from './session-reset.js';
import {
  authorizeAction,
  formatPermissionDenial,
  isBoss,
  resolveDiscordRole,
  type PermissionAction,
  type RoleContext,
} from './permissions.js';

/**
 * Slash command definitions.
 */
const COMMANDS = [
  new SlashCommandBuilder()
    .setName('new')
    .setDescription('Start a fresh Gemini conversation for this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('model')
    .setDescription('Switch the active Gemini model.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the model to use.')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the current daemon health and status.'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot latency.'),

  new SlashCommandBuilder()
    .setName('pool')
    .setDescription('Show CLI process pool status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Kill a specific CLI pool process.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => 
      option.setName('session')
        .setDescription('Pool key to kill')
        .setRequired(true)
    ),
];

const AVAILABLE_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

/**
 * Register slash commands for the primary guild.
 * We use guild-scoped commands for instant propagation.
 */
export async function registerSlashCommands(config: Config, botUserId: string): Promise<void> {
  if (!config.discordBotToken || !config.discordChannelId) return;

  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);

  try {
    log.info('Refreshing guild slash commands...');
    
    // We fetch the guild ID from the primary channel's parent guild
    // Since we only care about the primary server, we can just use the guild of the primary channel.
    // However, to keep it simple, we'll try to register for ALL guilds the bot is in (usually just one).
    // Or we can just use a common guild ID if we had one. 
    // For now, we'll register globally but explain the 1h delay, OR try to find guilds.
    
    // Better: Guild registration for all guilds is fast and reliable for private servers.
    // clientReady event guarantees we can see guilds.
  } catch (error) {
    log.error('Failed to register slash commands', { error });
  }
}

/**
 * Perform global and guild-scoped registration. Called from clientReady.
 */
export async function registerGuildCommands(client: Client, config: Config): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  
  // 1. Global registration (Required for DMs)
  try {
    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: COMMANDS.map(cmd => cmd.toJSON()) },
    );
    log.info('Registered global slash commands (for DMs)');
  } catch (error) {
    log.error('Failed to register global commands', { error });
  }

  // 2. Guild-scoped registration (Instant updates for guilds)
  const guilds = await client.guilds.fetch();
  for (const [guildId] of guilds) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(client.user!.id, guildId),
        { body: COMMANDS.map(cmd => cmd.toJSON()) },
      );
      log.info(`Registered slash commands for guild: ${guildId}`);
    } catch (error) {
      log.error(`Failed to register commands for guild ${guildId}`, { error });
    }
  }
}

/**
 * Set up the interaction handler for slash commands and autocomplete.
 */
export function setupInteractionHandler(
  client: Client,
  config: Config,
  state: DaemonState,
  memory: ConversationMemory,
  extensionDir: string
): void {
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const roleContext = resolveDiscordRole(config, {
      discordUserId: interaction.user.id,
      displayLabel: interaction.user.tag,
    });

    // Routing check: existing allowlists may permit command interaction, but
    // only DISCORD_BOSS_USER_ID can authorize privileged commands.
    const isBossUser = isBoss(roleContext);
    const isAllowed = config.allowedUserIds.includes(interaction.user.id);
    const isOwner = config.ownerIds.includes(interaction.user.id);
    if (!isBossUser && !isOwner && !isAllowed) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      return;
    }

    const { commandName } = interaction;

    if (commandName === 'new') {
      if (!await authorizeInteraction(interaction, roleContext, 'session_reset')) return;
      resetConversationSession(config, memory, extensionDir, {
        channelId: interaction.channelId,
        guildId: interaction.guildId ?? null,
        authorId: interaction.guildId ? null : interaction.user.id,
      });
      await interaction.reply({
        content: '🧹 **Started a new session.** The active Discord transcript and Gemini CLI session were archived and cleared for this channel.',
        ephemeral: false,
      });
      return;
    }

    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`**Pong!** Latency: \`${latency}ms\` | API: \`${Math.round(client.ws.ping)}ms\``);
      return;
    }

    if (commandName === 'status') {
      if (!await authorizeInteraction(interaction, roleContext, 'status')) return;
      const uptime = ((Date.now() - new Date(state.startedAt).getTime()) / 1000 / 60).toFixed(1);
      let poolInfo = 'Not initialized';
      if (runtimeStore.cliPool) {
        const pStatus = runtimeStore.cliPool.status();
        poolInfo = `Active: ${pStatus.busy} | Idle: ${pStatus.idle} | Max: ${pStatus.maxSize}`;
      }

      const statusMsg = `**Daemon Status**
- **Status:** \`${state.status}\`
- **Model:** \`${config.geminiModel}\`
- **Uptime:** \`${uptime}m\`
- **Messages Handled:** \`${state.messagesHandled}\`
- **Gemini Reachable:** \`${state.geminiReachable ? 'Yes' : 'No'}\`
- **Latency:** \`${Math.round(client.ws.ping)}ms\`
- **Streaming:** \`${config.streaming ? 'Enabled' : 'Disabled'}\`
- **CLI Pool:** \`${poolInfo}\``;
      await interaction.reply({ content: statusMsg, ephemeral: true });
      return;
    }

    if (commandName === 'pool') {
      if (!await authorizeInteraction(interaction, roleContext, 'status')) return;
      if (!runtimeStore.cliPool) {
        await interaction.reply({ content: 'CLI pool is not initialized.', ephemeral: true });
        return;
      }

      const pStatus = runtimeStore.cliPool.status();
      const lines = [`**CLI Process Pool** (\`Active: ${pStatus.busy} | Idle: ${pStatus.idle} | Max: ${pStatus.maxSize}\`)`];
      
      for (const p of pStatus.processes) {
        const aliveMin = Math.round(p.aliveMs / 60000);
        const activeSec = Math.round(p.lastActivityMs / 1000);
        const state = p.busy ? '**(busy)**' : '';
        lines.push(`- \`${p.poolKey}\` — alive ${aliveMin}m, last activity ${activeSec}s ago ${state}`);
      }

      if (lines.length === 1) {
        lines.push('- *No active processes*');
      }

      await interaction.reply({ content: lines.join('\n'), ephemeral: true });
      return;
    }

    if (commandName === 'kill') {
      if (!await authorizeInteraction(interaction, roleContext, 'admin_command')) return;

      const poolKey = interaction.options.getString('session', true);
      if (!runtimeStore.cliPool) {
        await interaction.reply({ content: 'CLI pool is not initialized.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `**Process killed:** \`${poolKey}\``, ephemeral: true });
      runtimeStore.cliPool.kill(poolKey);
      return;
    }

    if (commandName === 'model') {
      if (!await authorizeInteraction(interaction, roleContext, 'model_config')) return;

      const newModel = interaction.options.getString('name', true);
      const oldModel = config.geminiModel;

      if (!AVAILABLE_MODELS.includes(newModel)) {
        await interaction.reply({ content: `Invalid model. Available: ${AVAILABLE_MODELS.join(', ')}`, ephemeral: true });
        return;
      }

      await interaction.deferReply();

      try {
        // Validate with a ping
        const isValid = await validateModel(config.geminiPath, newModel);
        if (!isValid) {
          throw new Error(`Model \`${newModel}\` failed validation check.`);
        }

        // Update config and .env
        config.geminiModel = newModel;
        await updateEnvModel(extensionDir, newModel);

        await interaction.editReply(`**Model switched successfully.**
- From: \`${oldModel}\`
- To: \`${newModel}\`
Confirmation: Gemini CLI verified connectivity.`);
      } catch (error) {
        log.error('Model switch failed', { error: error instanceof Error ? error.message : String(error) });
        await interaction.editReply(`**Model switch failed.** 
Error: \`${error instanceof Error ? error.message : String(error)}\`
Action: Reverted to \`${oldModel}\`.`);
      }
      return;
    }
  });
}

async function authorizeInteraction(
  interaction: CommandInteraction,
  roleContext: RoleContext,
  action: PermissionAction,
): Promise<boolean> {
  const decision = authorizeAction(action, roleContext);
  if (decision.decision === 'allow') {
    return true;
  }

  await interaction.reply({ content: formatPermissionDenial(decision), ephemeral: true });
  return false;
}


async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedValue = interaction.options.getFocused();
  const filtered = AVAILABLE_MODELS.filter(choice => choice.startsWith(focusedValue));
  await interaction.respond(
    filtered.map(choice => ({ name: choice, value: choice })),
  );
}

async function validateModel(geminiPath: string, model: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(geminiPath, ['--model', model, '-p', 'ping', '--output-format', 'json'], {
      timeout: 15000,
      env: { ...process.env }
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
