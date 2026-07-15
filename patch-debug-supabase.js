const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const oldBlock = "    const req = https.request(options, (res) => {\n      let data = '';\n      res.on('data', chunk => data += chunk);\n      res.on('end', () => {\n        try { resolve(JSON.parse(data)); }\n        catch(e) { resolve([]); }\n      });\n    });";

const newBlock = "    const req = https.request(options, (res) => {\n      let data = '';\n      res.on('data', chunk => data += chunk);\n      res.on('end', () => {\n        console.log('SUPABASE RESPONSE [' + path + ']: status=' + res.statusCode + ' body=' + data);\n        try { resolve(JSON.parse(data)); }\n        catch(e) { resolve([]); }\n      });\n    });";

if (!content.includes(oldBlock)) {
  console.log('ERROR: anchor not found.');
} else {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: debug logging added.');
}