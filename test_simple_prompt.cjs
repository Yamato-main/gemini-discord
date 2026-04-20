const { spawn } = require('child_process');

const start = Date.now();
const args = ['--model', 'gemini-3.1-flash-lite-preview', '--output-format', 'stream-json', '--allowed-tools', 'all', '--approval-mode', 'yolo', '-p', 'Hello! This is a simple test message. How are you?'];

// Using the same working directory and options as our daemon
const cwd = process.cwd();
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
