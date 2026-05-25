import type { Client, TextChannel, ThreadChannel } from 'discord.js';
import type { Config } from '../../shared/types.js';
import { type ThreadManifest, saveThreadManifest } from './thread-manifest.js';
import { fetchTextChannel, isWritableTarget } from '../api-utils.js';
import { log } from '../log.js';
import { validateWorkflowTaskSummary } from './task-validation.js';
import { SUPPRESS_DISCORD_MENTIONS } from '../mention-safety.js';

export interface CreateThreadOptions {
  taskSummary: string;
  creatorUserId: string;
  sourceChannelId: string;
  sourceMessageId?: string;
  traceMode?: 'compact' | 'verbose';
}

export async function createWorkflowThread(
  client: Client,
  config: Config,
  extensionDir: string,
  opts: CreateThreadOptions
): Promise<{ threadId: string; manifest: ThreadManifest; thread: ThreadChannel }> {
  const { creatorUserId, sourceChannelId, sourceMessageId, traceMode = 'compact' } = opts;
  const taskSummary = validateWorkflowTaskSummary(opts.taskSummary);

  // 1. Resolve starting channel
  const originChannel = await fetchTextChannel(client, sourceChannelId);
  if (!originChannel) {
    throw new Error(`Origin channel ${sourceChannelId} not found`);
  }

  const isDm = 'isDMBased' in originChannel && originChannel.isDMBased();
  let parentChannel: TextChannel;

  if (isDm) {
    if (!config.workflowParentChannelId) {
      throw new Error('WORKFLOW_PARENT_CHANNEL_ID is not configured. Workflow threads cannot be created from DMs without a configured parent channel.');
    }
    const resolvedParent = await client.channels.fetch(config.workflowParentChannelId);
    if (!resolvedParent || !resolvedParent.isTextBased() || resolvedParent.isDMBased() || !('threads' in resolvedParent)) {
      throw new Error(`Configured WORKFLOW_PARENT_CHANNEL_ID ${config.workflowParentChannelId} is not a valid thread-capable guild text channel.`);
    }
    parentChannel = resolvedParent as TextChannel;
  } else {
    parentChannel = originChannel as TextChannel;
  }

  // 2. Validate parent is allowed/writable
  if (!isWritableTarget(parentChannel.id, parentChannel, config)) {
    throw new Error(`Parent channel ${parentChannel.id} is not writable or allowed under configured allowedChannelIds.`);
  }

  // 3. Construct name for thread
  const sanitizedTask = taskSummary
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, 30);
  const threadName = `gemini-workflow-${sanitizedTask || 'task'}`;

  // 4. Create thread
  let thread: ThreadChannel;
  let starterMessageId: string | null = null;

  if (sourceMessageId && !isDm) {
    try {
      const msg = await parentChannel.messages.fetch(sourceMessageId);
      thread = await msg.startThread({
        name: threadName,
      });
      starterMessageId = sourceMessageId;
    } catch (err) {
      log.warn('Could not start thread on message, creating standalone thread instead', { sourceMessageId, error: String(err) });
      thread = await parentChannel.threads.create({
        name: threadName,
      });
    }
  } else {
    thread = await parentChannel.threads.create({
      name: threadName,
    });
  }

  // 5. Post seed message in the thread
  const seedMsg = await thread.send({
    content: `> ${taskSummary}\n\n◌ **Workflow queued** · requested by <@${creatorUserId}>`,
    allowedMentions: SUPPRESS_DISCORD_MENTIONS,
  });

  // 6. Save manifest
  const manifest: ThreadManifest = {
    threadId: thread.id,
    parentChannelId: parentChannel.id,
    guildId: parentChannel.guildId,
    creatorUserId,
    starterMessageId: starterMessageId || seedMsg.id,
    createdAt: new Date().toISOString(),
    mode: 'monitored_workflow',
    taskSummary,
    traceMode,
    originContext: {
      type: isDm ? 'dm' : 'channel',
      sourceChannelId,
      sourceMessageId,
    },
  };

  saveThreadManifest(extensionDir, manifest);

  return {
    threadId: thread.id,
    manifest,
    thread,
  };
}
