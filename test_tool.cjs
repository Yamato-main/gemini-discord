const { execSync } = require('child_process');
try {
  const result = execSync('/opt/homebrew/bin/gemini --format json "echo hello"', { encoding: 'utf8' });
  console.log("SUCCESS:", result);
} catch (e) {
  console.log("FAILED:", e.message);
}
