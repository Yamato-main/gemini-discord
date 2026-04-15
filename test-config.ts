import { loadConfig } from './src/shared/config.js';
const config = loadConfig(process.cwd());
console.log(JSON.stringify(config, null, 2));
