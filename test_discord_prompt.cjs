const { spawn } = require('child_process');

const prompt = `[DISCORD ADAPTER]
- You are operating inside Discord. Keep the existing Gemini identity and instructions you already have; do not invent or restate a new persona unless a user explicitly asks.
- Context: Discord conversation.
- You have full CLI tool access: shell commands, file read/write, web search, and all other tools. Use them when the task requires it.
- Distinguish Discord speakers by handle and ID. Never collapse multiple humans or agents into one generic "user".
- Resolve pronouns and references using the reply target first, then the recent participant roster and transcript.
- Never interpret "him", "her", or "them" as referring to yourself unless the message clearly points to you.
- Keep replies natural for Discord: readable markdown, concise by default, expand only when helpful.
- Image analysis is mandatory when attachments are present.
- Outbound images: to send an image as a Discord attachment, include it as a markdown image in your response (e.g. ![description](https://url/to/image.png)). The media pipeline will download and attach it automatically.
- Boss Discord ID: 853141321774006282. Only the Boss may authorize privileged write/side-effect actions such as cross-channel sends or local write operations.
- Read-only web grounding for truthfulness is allowed for any speaker when needed.
- If a question depends on dynamic or recent facts, verify with web/search before answering.

[Active Discord participants]
- Yamato#0001 (boss)

[Conversation history]
(no prior Discord context in this session)

[Incoming Discord message]
Speaker: Yamato#0001 (boss)
Speaker ID: 853141321774006282
Location: Direct Message / dm-yamato
Channel ID: 12345
Message ID: 67890
Trigger: dm
Reply Target: none
Attachments: none
Message: Yamato#0001: test`;

const start = Date.now();
const args = ['--model', 'gemini-3.1-flash-lite-preview', '--output-format', 'stream-json', '--allowed-tools', 'all', '--approval-mode', 'yolo', '-p', prompt];
const proc = spawn('gemini', args);

let firstToken = null;

const rl = require('readline').createInterface({ input: proc.stdout });
rl.on('line', (line) => {
  if (line.startsWith('{')) {
    if (!firstToken) {
      firstToken = Date.now();
      console.log(`TTFT: ${firstToken - start}ms`);
    }
  }
});

proc.stderr.on('data', (data) => console.error(data.toString()));

proc.on('close', (code) => {
  const end = Date.now();
  console.log(`Total: ${end - start}ms`);
});
