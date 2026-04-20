const { spawn } = require('child_process');

const start = Date.now();
const prompt = `[DISCORD ADAPTER]
- You are operating inside Discord.
- Boss Discord ID: 853141321774006282.

[Active Discord participants]
- Yamato#0001 (boss)

[Incoming Discord message]
Speaker: Yamato#0001 (boss)
Speaker ID: 853141321774006282
Location: Direct Message
Message: Yamato#0001: test`;

// Boss mode triggers 'all' tools
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
