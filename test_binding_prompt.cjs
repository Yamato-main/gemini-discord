const { spawn } = require('child_process');
const path = require('path');

const prompt = `test`;
const cwd = path.join(process.cwd(), '.gemini-discord/bindings/channel:1481189760708907092');

const start = Date.now();
const args = ['--model', 'gemini-3.1-flash-lite-preview', '--output-format', 'stream-json', '--allowed-tools', 'all', '--approval-mode', 'yolo', '-p', prompt];
const proc = spawn('gemini', args, { cwd });

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
