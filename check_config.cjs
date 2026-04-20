const fs = require('fs');
const config = fs.readFileSync('.env', 'utf-8');
console.log(config);
