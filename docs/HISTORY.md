# Change History

## [2026-05-25] Mention-Safe Workflow Output

Prevented monitored workflow thread output from accidentally notifying Discord users, roles, or everyone when task summaries, trace output, validation errors, or streamed/final assistant responses contain mention syntax.

### Changed
- **Workflow Mention Safety**: Workflow seed messages, run headers, trace messages, workflow command replies, and workflow assistant responses now send with Discord mention parsing disabled.
- **Streaming Coverage**: Live streaming edits can opt into mention suppression, so the streamed draft and final edited response use the same safety behavior.

## [2026-05-25] Terminal-Style Workflow Trace Visuals

Aligned monitored workflow traces with the Gemini CLI terminal presentation inside Discord.

### Changed
- **Transcript Renderer**: Normal trace messages now use plain Discord markdown rows and fenced output blocks instead of chunky embed cards.
- **Trace Noise Reduction**: Started/progress-only tool messages are suppressed while the live run header still tracks the current step.
- **File Write Preview**: File edits and writes now show compact syntax-highlighted code previews from diffs instead of long inline diff blobs.
- **Compact Topic Lines**: Topic updates collapse into short phase-style lines rather than rendering verbose topic summary cards.
- **Hidden Trace Metadata**: Internal trace non-persistence is kept in code, but the visible `trace:doNotPersist` marker is no longer posted into workflow threads.
- **Shell Command Titles**: Top-level ACP shell events can derive command text from their title when raw tool input is absent, keeping Discord output close to the terminal trace.

## [2026-05-25] Reliable Workflow Thread Traces

Fixed monitored workflow traces for current Gemini CLI ACP payloads and tightened workflow task validation.

### Changed
- **ACP 0.43 Tool Events**: Trace normalization now supports top-level ACP `toolCallId`, `title`, `status`, `kind`, `content`, `rawInput`, and `rawOutput` fields while retaining older nested `toolCall` support.
- **Trace Correlation**: Started, progress, completed, failed, and cancelled events correlate through both top-level `toolCallId` and nested `toolCall.id`, so Discord edits one trace message per tool call and counts it once.
- **Run Heartbeat**: Workflow headers switch to running immediately after enqueue and refresh elapsed time while waiting for the first tool event.
- **Task Validation**: Slash, text, API, and admin workflow entrypoints reject vague single-token tasks such as `job` before creating a Discord thread.

## [2026-05-25] Workflow Thread Auto-Start Fix

Fixed workflow thread creation so a newly created monitored thread immediately starts the requested task instead of only posting the queued seed message.

### Changed
- **Initial Turn Enqueue**: `!workflow`, `!thread`, and `/workflow` now adapt the initiating request into a thread-scoped processing turn after the manifest is saved.
- **Trace Visibility**: The first run now uses the same `thread:{threadId}` session and normal trace dispatcher path as follow-up messages sent inside the workflow thread.

## [2026-05-25] Workflow Thread Console Renderer

Refined monitored workflow thread traces to match a compact Gemini CLI/Codex-style operator console inside Discord.

### Added Features
- **Editable Run Header**: Workflow runs now keep one live header that moves from queued to running to complete or failed, including elapsed time, current step, and tool-call count.
- **CLI-Style Trace Rows**: Simple file reads, searches, globs, and directory listings render as compact rows with fixed status glyphs and `→` result summaries.
- **Sparse Panels**: Shell output, edits, web/MCP calls, errors, and long meaningful results render as compact trace messages. Long sanitized output is attached as text instead of pasted inline.
- **Canonical Tool Mapping**: Built-in Gemini CLI tools use canonical names and argument keys from the Gemini CLI tool reference while MCP/custom/future tools keep a safe generic fallback.
- **Native Thinking Indicator**: The renderer no longer posts literal thinking cards; Discord's native typing indicator represents thinking state.

## [2026-05-25] Monitored Workflow Threads Implementation

Implemented opt-in monitored workflow threads to allow users to view Gemini CLI tool-call execution traces directly inside Discord threads.

### Added Features
- **Monitored Threads Trigger**: Added `/workflow <task>` slash command and `!thread <task>` / `!workflow <task>` text commands to opt-in to monitored execution.
- **DM Overflow Handling**: Added support for directing DM-based workflow thread requests to a central channel via the `WORKFLOW_PARENT_CHANNEL_ID` config parameter.
- **Session Isolation**: Created distinct Gemini session scopes under `thread:{threadId}` for workflow threads so they do not contaminate standard channel/DM histories.
- **Seed Context**: Fed the workflow threads with the initiating user prompt/source message contents to bootstrap execution.
- **Live Trace Dispatcher & Renderer**: Real-time rendering of tool-execution steps (calls, inputs, outputs, progress, failures) utilizing Discord's message editing capability to bypass rate limits.
- **Trace Redactor**: A safety-first redaction pipeline that strips API tokens, local system absolute paths, IP addresses, and sensitive command-line flags before posting to Discord.

### File Modifications
- **New Modules**:
  - `src/daemon/workflow/thread-manifest.ts`: Metadata persistence for active workflow threads.
  - `src/daemon/workflow/thread-creator.ts`: Thread creation and DM overflow validation.
  - `src/daemon/workflow/trace-event.ts`: Model definitions for CLI tool-call execution trace stages.
  - `src/daemon/workflow/tool-registry.ts`: Friendlier mappings of CLI tools to human-readable names.
  - `src/daemon/workflow/trace-normalizer.ts`: Normalization of CLI JSON logs to unified trace events.
  - `src/daemon/workflow/redaction.ts`: Regular expressions and functions for content scrubbing.
  - `src/daemon/workflow/trace-renderer.ts`: Formatting trace events to Discord-friendly embeds and codeblocks.
  - `src/daemon/workflow/trace-dispatcher.ts`: Stateful manager for posting and editing live Discord status updates.
  - `src/daemon/workflow/seed-context.ts`: Initial prompt seeding logic.
- **Modified Core Modules**:
  - `src/daemon/gateway.ts`: Added text commands routing, integrated `createWorkflowThread`, and wired up `TraceDispatcher` for trace execution callbacks.
  - `src/daemon/bot.ts` & `src/daemon/routing.ts`: Integrated parent-channel fallback allowed checks to support thread routing.
  - `src/daemon/engine-cli.ts` & `src/daemon/memory.ts` & `src/daemon/session-reset.ts`: Isolated workspace session keys and routed seed context / trace callback parameters.
  - `src/shared/config.ts` & `src/shared/config-vars.ts` & `src/shared/types.ts`: Added `workflowParentChannelId` configuration mapping.
