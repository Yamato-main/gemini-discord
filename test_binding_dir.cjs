const fs = require('fs');
const path = require('path');

const bindingsDir = path.join(process.cwd(), '.gemini-discord/bindings');
if (fs.existsSync(bindingsDir)) {
  const dirs = fs.readdirSync(bindingsDir);
  for (const dir of dirs) {
    const statePath = path.join(bindingsDir, dir, '.binding-state.json');
    if (fs.existsSync(statePath)) {
      console.log(`Binding ${dir}:`, fs.readFileSync(statePath, 'utf8'));
    }
  }
}
