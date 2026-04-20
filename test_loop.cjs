const { spawn } = require('child_process');

async function runTest(i) {
  const start = Date.now();
  const args = ['--model', 'gemini-3.1-flash-lite-preview', '--output-format', 'stream-json', '--allowed-tools', 'all', '--approval-mode', 'yolo', '-p', 'hey'];
  const proc = spawn('gemini', args);

  return new Promise((resolve) => {
    let ttft = null;
    const rl = require('readline').createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (line.startsWith('{') && !ttft) {
        ttft = Date.now() - start;
      }
    });
    proc.on('close', () => {
      const total = Date.now() - start;
      console.log(`Run ${i}: TTFT=${ttft}ms, Total=${total}ms`);
      resolve();
    });
  });
}

async function main() {
  for (let i = 1; i <= 3; i++) {
    await runTest(i);
  }
}
main();
