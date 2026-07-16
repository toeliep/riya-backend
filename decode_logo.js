const fs = require('fs');
// 1st Insurance Brokers logo - base64 encoded
const base64 = fs.readFileSync('logo_base64.txt', 'utf8').trim();
const buf = Buffer.from(base64, 'base64');
fs.writeFileSync('assets/1st-insurance-logo.png', buf);
console.log('✓ 1st Insurance logo saved to assets/');