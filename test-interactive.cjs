const { spawn } = require('child_process');

const proc = spawn('gemini', ['--model', 'gemini-3-flash-preview', '-y', '-o', 'stream-json'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

proc.stdout.on('data', d => console.log('OUT:', d.toString()));
proc.stderr.on('data', d => console.error('ERR:', d.toString()));

setTimeout(() => {
  console.log('Sending first message...');
  proc.stdin.write('hi\n');
}, 3000);

setTimeout(() => {
  console.log('Sending second message...');
  proc.stdin.write('what did I just say?\n');
}, 8000);

setTimeout(() => {
  proc.kill();
}, 15000);
