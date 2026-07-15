const fs = require('fs'); 
let code = fs.readFileSync('index.js', 'utf8'); 
code = code.split('SUPABASE_SERVICE_ROLE_KEY').join('SUPABASE_SERVICE_KEY'); 
fs.writeFileSync('index.js', code); 
console.log('Done'); 
