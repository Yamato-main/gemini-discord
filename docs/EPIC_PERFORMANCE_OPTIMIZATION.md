# Performance Optimization Epic: DoD & Success Metrics

## Goal
Transform the gemini-discord gateway from a functional proof-of-concept into a **production-ready, high-performance prototype** that feels snappy, handles concurrent load gracefully, and minimizes host resource footprint.

## User Benefits (Translation of Technical Fixes)

| Technical Achievement | User Benefit |
| :--- | :--- |
| **Parallel Attachment Pre-processing** | **Snappier Responses:** Gemini starts thinking while images are still downloading; no more "dead air" while waiting for metadata. |
| **Semaphore Queue Feedback** | **Active Transparency:** If the bot is busy, you're told immediately (⏳) instead of being ignored, reducing perceived lag. |
| **Lock-free/Atomic Filesystem Operations** | **Reliability Under Pressure:** No more "file not found" errors when multiple people message the bot at the exact same time. |
| **Aggressive Cache Pruning** | **Host-Friendly:** Keeps the bot's disk footprint tiny, making it ideal for always-on usage on low-cost VPS/Raspberry Pi. |
| **Token Streaming Optimization** | **Real-time Interaction:** Words appear as they are generated, matching the "live" feel of the Gemini web interface. |

## Definition of Done (DoD)

### 1. "Production Ready" Publish-ability
- [ ] **Stability**: Daemon survives a 24-hour stress test with 500+ simulated messages without memory leaks (>200MB growth) or crashes.
- [ ] **Observability**: Every message processing lifecycle is logged with precise millisecond markers for `download`, `setup`, `queue_wait`, and `gemini_exec`.
- [ ] **Graceful Degradation**: If the Gemini API is overloaded, the bot sends a user-friendly error message instead of timing out silently.
- [ ] **Configuration**: Performance tunables (max concurrency, queue timeouts, cache TTL) are externalized to `.env`.

### 2. Visual & UX Polish (Complete Prototype Alignment)
- [ ] **Feedback Lifecycle**: The "⏳ Gemini is busy..." message is automatically deleted the moment the semaphore is acquired and streaming begins.
- [ ] **Streaming Smoothness**: Tokens are flushed to Discord in optimal chunks (balancing API rate limits vs. perceived speed).
- [ ] **Typing Indicators**: The bot shows "typing..." only when it is actually generating text, not during idle wait.

### 3. Substantially Complete Architecture
- [ ] **No Race Conditions**: Verified via automated concurrency tests that simulate 5 messages in the same channel arriving within 100ms.
- [ ] **Resource Cleanup**: Temporary directories and attachment downloads are 100% purged after every exchange, even on process failure.
- [ ] **Documentation**: `README.md` includes a "Performance & Scaling" section detailing the daemon's capacity.

## Success Metrics

| Metric | Target | Rationale |
| :--- | :--- | :--- |
| **TTFT (Time To First Token)** | **< 1.5s (Warm) / < 3.5s (Cold)** | Ensures the bot feels responsive even when handling attachments or starting fresh. |
| **Concurrent Load Capacity** | **20+ Simultaneous Requests** | Proves the locking and queuing logic works under significant community load. |
| **Idle Resource Footprint** | **< 100MB RAM / < 500MB Disk** | Guarantees the bot remains "always-on" without taxing the host system. |
| **Queue Feedback Success** | **100% of waits > 2s triggered** | Eliminates the "is it broken?" user anxiety during high load. |
| **System Reliability** | **Zero Race-Condition Crashes** | Ensures 100% uptime for core message processing logic. |
