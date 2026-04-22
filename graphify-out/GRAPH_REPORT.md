# Graph Report - /Users/yamato/Yamato code/gemini-discord  (2026-04-21)

## Corpus Check
- 89 files · ~84,265 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 322 nodes · 574 edges · 37 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `ConversationMemory` - 20 edges
2. `processViaCli()` - 17 edges
3. `LiveEditor` - 14 edges
4. `main()` - 12 edges
5. `retrySend()` - 12 edges
6. `main()` - 11 edges
7. `CliProcessPool` - 11 edges
8. `ChannelQueue` - 8 edges
9. `restartDaemon()` - 7 edges
10. `loadConfig()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `ensureDaemonRunning()`  [INFERRED]
  /Users/yamato/Yamato code/gemini-discord/src/server.ts → /Users/yamato/Yamato code/gemini-discord/src/shared/daemon-runtime.ts
- `processMessage()` --calls--> `resolveToolMode()`  [INFERRED]
  /Users/yamato/Yamato code/gemini-discord/src/daemon/gateway.ts → /Users/yamato/Yamato code/gemini-discord/src/daemon/tool-mode.ts
- `withRetry()` --calls--> `fn()`  [INFERRED]
  /Users/yamato/Yamato code/gemini-discord/src/daemon/retry.ts → /Users/yamato/Yamato code/gemini-discord/tests/retry.test.ts
- `route()` --calls--> `shouldAcceptMessage()`  [INFERRED]
  /Users/yamato/Yamato code/gemini-discord/tests/routing.test.ts → /Users/yamato/Yamato code/gemini-discord/src/daemon/routing.ts
- `main()` --conceptually_related_to--> `main()`  [INFERRED]
  /Users/yamato/Yamato code/gemini-discord/scripts/setup.ts → /Users/yamato/Yamato code/gemini-discord/src/daemon.ts

## Hyperedges (group relationships)
- **Daemon Core Services** — daemon_main, memory_conversationmemory, queue_channelqueue, semaphore_semaphore [EXTRACTED 0.95]
- **Coverage Report UI Scripts** — block_navigation, prettify, sorter [INFERRED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (11): daemonRequest(), isDaemonOnline(), requestOnce(), resolveExtensionDir(), finalizeRoute(), reject(), shouldAcceptMessage(), stripLeadingBotMention() (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (12): respond(), createClient(), notifyOwner(), setupMessageHandler(), setupReconnectHandlers(), handleAutocomplete(), setupInteractionHandler(), initGateway() (+4 more)

### Community 2 - "Community 2"
Cohesion: 0.13
Nodes (15): LiveEditor, finalizeAssistantResponse(), formatError(), getAttachmentsTmpDir(), processViaCli(), sendPreparedDisplayText(), processMessage(), getRetryAfter() (+7 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (23): resolveProcessingContext(), buildActiveParticipantRoster(), buildDiscordAdapterInstruction(), buildDiscordPrompt(), buildTranscript(), coerceAttachments(), coerceMessage(), coerceSessionsV2() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (6): buildPoolKey(), CliProcessPool, resolveAllowedTools(), buildGeminiArgs(), buildGeminiInput(), resolveToolMode()

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (17): loadConfig(), parseBoolean(), parseEnvFile(), parseMemoryScope(), resolveBossId(), splitIds(), ask(), askBoolean() (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.16
Nodes (4): startControlApi(), main(), ConversationMemory, probeDiscordGateway()

### Community 7 - "Community 7"
Cohesion: 0.27
Nodes (11): addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns(), loadData() (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.3
Nodes (10): ensureDaemonRunning(), getDaemonStartedAt(), isDaemonHealthy(), restartDaemon(), shutdownDaemon(), startDaemonProcess(), unref(), waitForHealth() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (10): appendNotices(), buildGuildChannelMap(), extractCrossChannelSends(), getChannelMapContext(), processCrossChannelSends(), chunkMessage(), findSafeSplit(), repairFences() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (6): goToNext(), goToPrevious(), makeCurrent(), toggleClass(), ChannelQueue, normalizeKeys()

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (14): actor:yamato, component:discord-daemon, component:mcp-server, config:memory_scope, library:discord.js, library:genai, library:mcp-sdk, project:gemini-discord (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.35
Nodes (8): a(), B(), D(), g(), i(), k(), Q(), y()

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (4): downloadImageAttachments(), getImageAttachmentMetadata(), getImageAttachments(), sanitizeFilename()

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (2): Semaphore, task()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): Workspace Binding Manager

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): Message Routing Logic

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (1): Message Chunker Utility

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (1): Retry and Sleep Utilities

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): Tool Mode Resolver

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): Discord Attachments Manager

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (1): Discord Media Utilities

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (1): Daemon Runtime Utilities

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (1): Engine-CLI Patch Script

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (1): Gemini Latency Tester

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (1): file:package.json

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (1): file:readme.md

## Knowledge Gaps
- **10 isolated node(s):** `Workspace Binding Manager`, `Message Routing Logic`, `Message Chunker Utility`, `Retry and Sleep Utilities`, `Tool Mode Resolver` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (1 nodes): `update-engine-cli.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (1 nodes): `test_tool.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (1 nodes): `update.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `test_gemini.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `esbuild.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `fix-memory.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `discord-media.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `binding-concurrency.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `binding.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `Workspace Binding Manager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `Message Routing Logic`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `Message Chunker Utility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `Retry and Sleep Utilities`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `Tool Mode Resolver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `Discord Attachments Manager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `Discord Media Utilities`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `Daemon Runtime Utilities`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `Engine-CLI Patch Script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `Gemini Latency Tester`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `file:package.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `file:readme.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ConversationMemory` connect `Community 6` to `Community 10`, `Community 3`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `processViaCli()` connect `Community 2` to `Community 3`, `Community 4`, `Community 6`, `Community 13`, `Community 14`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `main()` connect `Community 6` to `Community 1`, `Community 10`, `Community 5`, `Community 14`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `processViaCli()` (e.g. with `processMessage()` and `getImageAttachmentMetadata()`) actually correct?**
  _`processViaCli()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `main()` (e.g. with `runPreflight()` and `loadConfig()`) actually correct?**
  _`main()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `retrySend()` (e.g. with `.init()` and `.finalize()`) actually correct?**
  _`retrySend()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Workspace Binding Manager`, `Message Routing Logic`, `Message Chunker Utility` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._