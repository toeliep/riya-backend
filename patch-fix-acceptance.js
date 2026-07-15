const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const oldBlock = "    await supabaseRequest('POST', 'acceptances', {\n      roa_token: roa_token || null,\n      client_name: client_name,\n      client_email: client_email,\n      broker_token: broker_token || null,\n      accepted_at: new Date().toISOString()\n    });\n    return res.json({ success: true, accepted_at: new Date().toISOString() });";

const newBlock = "    await supabaseRequest('POST', 'acceptances', {\n      roa_token: roa_token || null,\n      client_name: client_name,\n      client_email: client_email,\n      broker_token: broker_token || null\n    });\n    return res.json({ success: true, accepted_at: new Date().toISOString() });";

if (!content.includes(oldBlock)) {
  console.log('ERROR: anchor not found.');
} else {
  content = content.replace(oldBlock, newBlock);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: removed accepted_at from insert payload.');
}