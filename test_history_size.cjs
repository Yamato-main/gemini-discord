const fs = require('fs');
const path = require('path');

const memoryPath = path.join(process.cwd(), '.memory.json');
try {
  const data = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
  const sessions = data.sessions;
  
  console.log(`Total sessions: ${Object.keys(sessions).length}`);
  
  for (const [key, session] of Object.entries(sessions)) {
    const messages = session.messages || [];
    const jsonStr = JSON.stringify(messages);
    console.log(`Session ${key}: ${messages.length} messages, ${jsonStr.length} bytes`);
  }
} catch (e) {
  console.error("Error reading memory:", e.message);
}
