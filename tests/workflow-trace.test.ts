import { describe, it, expect, vi } from 'vitest';
import type { TraceEvent } from '../src/daemon/workflow/trace-event.js';
import { normalizeAcpUpdate } from '../src/daemon/workflow/trace-normalizer.js';
import { TraceRendererRegistry } from '../src/daemon/workflow/trace-renderer.js';
import { TraceDispatcher } from '../src/daemon/workflow/trace-dispatcher.js';

describe('workflow trace events & renderer integration', () => {
  it('correctly maps tool_call, tool_call_update and plan updates', () => {
    const timers = new Map<string, number>();
    timers.set('call-1', Date.now() - 500);

    // 1. Tool Call Started
    const callStartedPayload = {
      sessionUpdate: 'tool_call',
      toolCall: {
        id: 'call-2',
        name: 'run_shell_command',
        arguments: { commandLine: 'git status' },
      },
    };
    const eventStarted = normalizeAcpUpdate('tool_call', callStartedPayload, timers);
    expect(eventStarted).not.toBeNull();
    expect(eventStarted!.type).toBe('tool_started');
    expect(eventStarted!.status).toBe('started');
    expect(eventStarted!.canonicalToolName).toBe('run_shell_command');
    expect(eventStarted!.args.commandLine).toBe('git status');

    // 2. Tool Call Progress
    const progressPayload = {
      sessionUpdate: 'tool_call_update',
      toolCall: {
        id: 'call-1',
        name: 'run_shell_command',
        progress: 'compiling...',
      },
    };
    const eventProgress = normalizeAcpUpdate('tool_call_update', progressPayload, timers);
    expect(eventProgress).not.toBeNull();
    expect(eventProgress!.type).toBe('tool_progress');
    expect(eventProgress!.status).toBe('progress');
    expect(eventProgress!.resultSummary).toBe('compiling...');

    // 3. Tool Call Completed
    const completedPayload = {
      sessionUpdate: 'tool_call',
      toolCall: {
        id: 'call-1',
        name: 'run_shell_command',
        result: { exitCode: 0, stdout: 'build ok' },
      },
    };
    const eventCompleted = normalizeAcpUpdate('tool_call', completedPayload, timers);
    expect(eventCompleted).not.toBeNull();
    expect(eventCompleted!.type).toBe('tool_completed');
    expect(eventCompleted!.status).toBe('completed');
    expect(eventCompleted!.resultSummary).toContain('build ok');
    expect(eventCompleted!.durationMs).toBeGreaterThanOrEqual(500);

    // 4. Tool Call Update Completed
    timers.set('call-3', Date.now() - 50);
    const updateCompletedPayload = {
      sessionUpdate: 'tool_call_update',
      toolCall: {
        id: 'call-3',
        name: 'read_file',
        arguments: { file_path: '/Users/yamato/project/src/index.ts', start_line: 1, end_line: 10 },
        result: 'file contents',
      },
    };
    const eventUpdateCompleted = normalizeAcpUpdate('tool_call_update', updateCompletedPayload, timers);
    expect(eventUpdateCompleted).not.toBeNull();
    expect(eventUpdateCompleted!.type).toBe('tool_completed');
    expect(eventUpdateCompleted!.args.file_path).toBe('~/project/src/index.ts');

    // 5. Plan/Thought Update
    const planPayload = {
      sessionUpdate: 'plan',
      plan: 'Determine next steps',
    };
    const eventPlan = normalizeAcpUpdate('plan', planPayload, timers);
    expect(eventPlan).not.toBeNull();
    expect(eventPlan!.type).toBe('phase_started');
    expect(eventPlan!.resultSummary).toBe('Determine next steps');
  });

  it('maps Gemini CLI 0.43 top-level ACP tool updates', () => {
    const timers = new Map<string, number>();

    const started = normalizeAcpUpdate('tool_call', {
      sessionUpdate: 'tool_call',
      toolCallId: 'read_file-1',
      status: 'in_progress',
      title: 'ReadFile src/index.ts',
      kind: 'read',
      rawInput: {
        name: 'read_file',
        args: { file_path: '/Users/yamato/project/src/index.ts' },
      },
      content: [],
    }, timers);

    expect(started).toMatchObject({
      type: 'tool_started',
      status: 'started',
      canonicalToolName: 'read_file',
      toolFamily: 'filesystem',
    });
    expect(started!.args.file_path).toBe('~/project/src/index.ts');

    const completed = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'read_file-1',
      status: 'completed',
      title: 'ReadFile src/index.ts',
      kind: 'read',
      content: [
        { type: 'content', content: { type: 'text', text: 'Read 10 lines.' } },
      ],
      rawOutput: { output: 'file contents' },
    }, timers);

    expect(completed).toMatchObject({
      type: 'tool_completed',
      status: 'completed',
      toolFamily: 'filesystem',
    });
    expect(completed!.resultSummary).toContain('Read 10 lines');
    expect(completed!.durationMs).toBeGreaterThanOrEqual(0);

    const failed = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'shell-1',
      status: 'failed',
      title: 'Shell npm test',
      kind: 'execute',
      content: [
        { type: 'content', content: { type: 'text', text: 'Command failed' } },
      ],
    }, timers);

    expect(failed).toMatchObject({
      type: 'tool_failed',
      status: 'failed',
      toolFamily: 'shell',
    });
    expect(failed!.resultSummary).toContain('Command failed');

    const diff = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'edit-1',
      status: 'completed',
      title: 'Edit src/index.ts',
      kind: 'edit',
      content: [
        { type: 'diff', path: 'src/index.ts', oldText: 'old', newText: 'new' },
      ],
    }, timers);

    expect(diff).toMatchObject({
      type: 'tool_completed',
      toolFamily: 'filesystem',
    });
    expect(diff!.resultDetail).toContain('Diff: src/index.ts');

    const terminal = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'terminal-1',
      status: 'completed',
      title: 'Shell build',
      kind: 'execute',
      content: [
        { type: 'terminal', terminalId: 'term-123' },
      ],
    }, timers);

    expect(terminal).toMatchObject({
      type: 'tool_completed',
      toolFamily: 'shell',
    });
    expect(terminal!.resultSummary).toContain('Terminal output');

    const plan = normalizeAcpUpdate('plan', {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect ACP payloads', priority: 'high', status: 'completed' },
        { content: 'Patch renderer', priority: 'high', status: 'in_progress' },
      ],
    }, timers);

    expect(plan).toMatchObject({
      type: 'phase_started',
      toolFamily: 'planning',
    });
    expect(plan!.resultSummary).toContain('completed: Inspect ACP payloads');
  });

  it('generates trace messages containing doNotPersist and doNotRoute flags', async () => {
    const mockChannel = {
      send: vi.fn().mockResolvedValue({ id: 'sent-msg-1' }),
    } as any;

    const registry = new TraceRendererRegistry();
    const dispatcher = new TraceDispatcher(mockChannel, registry);

    const event: TraceEvent = {
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'run_shell_command',
      canonicalToolName: 'run_shell_command',
      displayName: 'Shell',
      toolFamily: 'shell',
      args: { commandLine: 'git status' },
      status: 'completed',
      durationMs: 25,
      resultSummary: 'clean',
      resultDetail: 'clean',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    };

    await dispatcher.dispatch(event);

    expect(mockChannel.send).toHaveBeenCalledTimes(1);
    const sentArgs = mockChannel.send.mock.calls[0][0];
    expect(sentArgs.content).toContain('git status');
    expect(sentArgs.content).not.toContain('<!-- trace:doNotPersist -->');
    expect(sentArgs.allowedMentions).toEqual({ parse: [] });
  });

  it('derives shell commands from top-level ACP titles when raw input is absent', () => {
    const event = normalizeAcpUpdate('tool_call_update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'shell-title-1',
      status: 'completed',
      title: 'Shell cd /tmp && npm test',
      kind: 'execute',
      content: [
        { type: 'content', content: { type: 'text', text: 'passed' } },
      ],
    }, new Map());

    expect(event).toMatchObject({
      type: 'tool_completed',
      status: 'completed',
      toolFamily: 'shell',
    });
    expect(event!.args.command).toBe('cd /tmp && npm test');

    const rendered = new TraceRendererRegistry().render(event!);
    expect(rendered.content).toContain('Shell cd /tmp && npm test');
    expect(rendered.content).toContain('passed');
    expect(rendered.embeds).toBeUndefined();
  });

  it('does not send suppressed trace events', async () => {
    const mockChannel = {
      send: vi.fn().mockResolvedValue({ id: 'sent-msg-1' }),
    } as any;

    const dispatcher = new TraceDispatcher(mockChannel, new TraceRendererRegistry());
    await dispatcher.dispatch({
      type: 'tool_started',
      timestamp: Date.now(),
      toolName: 'write_file',
      canonicalToolName: 'write_file',
      displayName: 'WriteFile',
      toolFamily: 'filesystem',
      args: { path: 'triangle.go' },
      status: 'started',
      durationMs: null,
      resultSummary: null,
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
    });

    expect(mockChannel.send).not.toHaveBeenCalled();
  });

  it('edits one run header across workflow lifecycle', async () => {
    const header = { id: 'header', edit: vi.fn().mockResolvedValue(undefined) };
    const toolMessage = { id: 'tool-1', edit: vi.fn().mockResolvedValue(undefined) };
    const mockChannel = {
      send: vi.fn()
        .mockResolvedValueOnce(header)
        .mockResolvedValueOnce(toolMessage),
    } as any;

    const registry = new TraceRendererRegistry();
    const dispatcher = new TraceDispatcher(mockChannel, registry);

    await dispatcher.dispatchRunHeader({
      threadId: 'thread-1',
      parentChannelId: 'parent-1',
      guildId: 'guild-1',
      creatorUserId: 'user-1',
      starterMessageId: 'message-1',
      createdAt: new Date().toISOString(),
      mode: 'monitored_workflow',
      taskSummary: 'Fix routing',
      traceMode: 'compact',
      originContext: { type: 'channel', sourceChannelId: 'parent-1' },
    });

    await dispatcher.dispatch({
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'grep_search',
      canonicalToolName: 'grep_search',
      displayName: 'SearchText',
      toolFamily: 'search',
      args: { pattern: 'routing' },
      status: 'completed',
      durationMs: 25,
      resultSummary: 'Found 2 matches',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
      raw: { toolCall: { id: 'call-1' } },
    });

    await dispatcher.dispatchRunComplete();

    expect(mockChannel.send).toHaveBeenCalledTimes(2);
    expect(header.edit).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Running'),
      allowedMentions: { parse: [] },
    }));
    expect(header.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      content: expect.stringContaining('Complete'),
      allowedMentions: { parse: [] },
    }));
  });

  it('correlates top-level ACP toolCallId updates into one trace message and one count', async () => {
    const header = { id: 'header', edit: vi.fn().mockResolvedValue(undefined) };
    const toolMessage = { id: 'tool-1', edit: vi.fn().mockResolvedValue(undefined) };
    const mockChannel = {
      send: vi.fn()
        .mockResolvedValueOnce(header)
        .mockResolvedValueOnce(toolMessage),
    } as any;

    const registry = new TraceRendererRegistry();
    const dispatcher = new TraceDispatcher(mockChannel, registry);

    await dispatcher.dispatchRunHeader({
      threadId: 'thread-1',
      parentChannelId: 'parent-1',
      guildId: 'guild-1',
      creatorUserId: 'user-1',
      starterMessageId: 'message-1',
      createdAt: new Date().toISOString(),
      mode: 'monitored_workflow',
      taskSummary: 'Fix routing',
      traceMode: 'compact',
      originContext: { type: 'channel', sourceChannelId: 'parent-1' },
    });

    await dispatcher.dispatch({
      type: 'tool_started',
      timestamp: Date.now(),
      toolName: 'read_file',
      canonicalToolName: 'read_file',
      displayName: 'Read',
      toolFamily: 'filesystem',
      args: { file_path: 'src/index.ts' },
      status: 'started',
      durationMs: null,
      resultSummary: null,
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
      raw: { toolCallId: 'read-1' },
    });

    await dispatcher.dispatch({
      type: 'tool_completed',
      timestamp: Date.now(),
      toolName: 'read_file',
      canonicalToolName: 'read_file',
      displayName: 'Read',
      toolFamily: 'filesystem',
      args: { file_path: 'src/index.ts' },
      status: 'completed',
      durationMs: 25,
      resultSummary: 'Read 10 lines.',
      artifactRef: null,
      redactionMetadata: { fieldsRedacted: [], truncated: false },
      raw: { toolCallId: 'read-1' },
    });

    await dispatcher.dispatchRunComplete();

    expect(mockChannel.send).toHaveBeenCalledTimes(2);
    expect(toolMessage.edit).not.toHaveBeenCalled();
    expect(header.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      content: expect.stringContaining('`1` tool calls'),
      allowedMentions: { parse: [] },
    }));
  });
});
