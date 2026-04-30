# Service Inventory

This file tracks the real moving parts of `gemini-discord` so future work does not duplicate them.

## Services

| Service | File | Responsibility | Key Methods |
| --- | --- | --- | --- |
| Daemon entry | `src/daemon.ts` | Boot the local runtime, wire shared services, and handle shutdown. | `main()` |
| Control API | `src/daemon/api.ts` | Expose localhost health, history, send/reply, reset, and cron routes. | `startControlApi()` |
| Discord gateway | `src/daemon/gateway.ts` | Bind Discord events to Gemini processing, queueing, memory persistence, and slash commands. | `initGateway()` |
| CLI pool | `src/daemon/cli-pool.ts` | Run headless Gemini CLI turns with tool gating and session resume. | `CliProcessPool.send()`, `kill()`, `status()` |
| Binding manager | `src/daemon/binding.ts` | Map Discord scope to stable Gemini workspaces and persist session ids. | `ensureGeminiBindingWorkspace()`, `loadGeminiBindingState()`, `saveGeminiBindingState()` |
| Cron scheduler | `src/daemon/cron.ts` | Persist and deliver exact-message Discord cron jobs. | `initCron()`, `scheduleJob()`, `listJobs()`, `deleteJob()` |
| MCP server | `src/server.ts` | Register Discord bridge tools for Gemini CLI and wake the daemon on demand. | `main()` |

## Shared Modules

| Module | File | Responsibility |
| --- | --- | --- |
| Runtime store | `src/daemon/runtime.ts` | Hold live daemon singletons such as the Discord client, pool, queue, and semaphores. |
| Memory mirror | `src/daemon/memory.ts` | Keep a Discord-side transcript mirror for history/status/debugging. |
| Tool mode resolver | `src/daemon/tool-mode.ts` | Decide when a turn is plain chat vs web vs Discord action vs full tool mode. |
| Sender | `src/daemon/sender.ts` | Chunk and deliver Discord messages and attachments. |
| Sanitizer | `src/daemon/sanitizer.ts` | Strip internal reasoning / unsafe output before Discord delivery. |
| Config loader | `src/shared/config.ts` | Merge `.env`, install settings, and the managed `.gemini-discord/config.json` file into the typed runtime config. |
| Shared types | `src/shared/types.ts` | Define cross-process contracts for daemon/API/tool status. |

## Established Patterns

- Discord bindings store metadata under `.gemini-discord/bindings/...`; Gemini still runs from the normal Gemini project context.
- Headless Gemini turns resume explicit stored session ids so Discord does not become a separate project or persona.
- Scheduled jobs do not write into normal Discord memory; they send exact final messages at delivery time.
- Tool access is intentionally narrowed per turn: plain chat stays light, research gets web tools, Discord actions get bridge tools, and full tools are explicit.
