// bootstrap.cjs — committed to repo, never built.
// Handles first-run setup when dist/ doesn't exist yet.
const { existsSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const root = __dirname;
const server = path.join(root, 'dist', 'server.cjs');

if (!existsSync(server)) {
  process.stderr.write('gemini-discord: First run — installing and building...\n');
  try {
    execSync('npm install && npm run build', {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err) {
    process.stderr.write(`gemini-discord: Build failed: ${err.message}\n`);
    process.exit(1);
  }
}

require(server);
