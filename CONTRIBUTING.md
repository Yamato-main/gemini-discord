# Contributing to Gemini Discord

First off, thank you for considering contributing to `gemini-discord`! 

## Getting Started

1. Clone the repository
2. Run `npm install` to install dependencies
3. Follow the [Gemini CLI extension best practices](https://geminicli.com/docs/extensions/best-practices/)

## Development

- `npm run dev:daemon` will start the daemon in watch mode.
- Ensure any new features are covered by tests (`npm test`).
- Ensure no powerful tools like `run_shell_command` are exposed via MCP unless explicitly needed and guarded.

## Pull Requests

1. Create a descriptive PR outlining the problem you're solving.
2. Ensure CI passes (build and tests).
3. If changing complex flow logic in `src/daemon/queue.ts`, please explain how you tested for race conditions.
