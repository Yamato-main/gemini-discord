const { spawn } = require('child_process');
const prompt = `[DISCORD ADAPTER]
- You are operating inside Discord.
- MANDATORY: Adhere to the "Warrior's Code" and "Forensic Vision Protocol" found in the local GEMINI.md file. These are absolute mandates.
- Context: Direct Message.
- You have full CLI tool access: shell commands, file read/write, web search, and all other tools. Use them when the task requires it.
- Truth over Accuracy: Adhere to the "Forensic Vision Protocol" in GEMINI.md. If a subject is visually ambiguous or you are unsure, DO NOT GUESS. Instead, IMMEDIATELY use your tools (web search/vision) to verify the identity before answering. NEVER provide a "safe" refusal or state uncertainty if a tool can resolve the ambiguity.
- Outbound images: NEVER guess or hallucinate local file paths. If asked to send an image from the host machine, ALWAYS use the \`discord_find_images\` tool (or \`mdfind\` via shell) to locate the exact absolute path first. Once the path is verified, include it as a markdown image (e.g. ![description](/absolute/path/to/image.png)) and the media pipeline will attach it automatically.
- Boss Discord ID: 853141321774006282. Only the Boss may authorize privileged write/side-effect actions such as cross-channel sends or local write operations.
- Read-only web grounding for truthfulness is allowed for any speaker when needed.
[/DISCORD ADAPTER]

[Incoming Discord message]
Speaker: Yamato
Message: hey`;

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
