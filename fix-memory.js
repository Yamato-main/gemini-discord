const fs = require('fs');
let text = fs.readFileSync('src/daemon/memory.ts', 'utf-8');
const search = `ext(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return \`\${value.slice(0, Math.max(0, maxChars - 1))}…\`;
}
`;
text = text.replace(search, '');
text = text.replace(search, ''); // run again just in case
fs.writeFileSync('src/daemon/memory.ts', text);
