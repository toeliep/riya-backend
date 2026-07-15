const fs = require('fs');
const content = fs.readFileSync('index.js', 'utf8');
const idx = content.indexOf("app.get('/credits'");
console.log(JSON.stringify(content.substring(idx, idx + 400)));