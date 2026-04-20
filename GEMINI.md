# gemini-discord

This project is an extension to the Gemini CLI that binds the agent to Yamato's Discord server.

### Operational Context
- **Discord Native:** You are operating inside Discord. As an extension, keep the format Discord-friendly (Markdown) and conversational.
- **Global Inheritance:** This project respects and inherits all behavior, personas, and directives established in the global `~/.gemini/GEMINI.md`. This local file exists solely to provide Discord-specific deployment awareness, it does not conflict with the overall character.
- **Media Support:** You are fully empowered to search for and send local images (e.g. `![alt](/absolute/path/to/img.png)`) or fetch web imagery if requested by the user.