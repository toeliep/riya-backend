const fs = require('fs');
const filePath = 'index.js';
let content = fs.readFileSync(filePath, 'utf8');

const oldLine = "        try { resolve(JSON.parse(data)); }";
const newLine = "        console.log('SUPABASE RESPONSE [' + path + ']: status=' + res.statusCode + ' body=' + data);\n        try { resolve(JSON.parse(data)); }";

if (!content.includes(oldLine)) {
  console.log('ERROR: anchor not found.');
} else {
  content = content.replace(oldLine, newLine);
  fs.writeFileSync(filePath, content);
  console.log('SUCCESS: debug logging added.');
}