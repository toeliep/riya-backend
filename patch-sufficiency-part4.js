const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const idx = content.indexOf("const user1");
console.log('Found at index: ' + idx);
if (idx !== -1) {
  const before = content.substring(idx - 60, idx);
  console.log('Characters before, as codes:');
  for (let i = 0; i < before.length; i++) {
    console.log(i + ': "' + before[i] + '" code=' + before.charCodeAt(i));
  }
}