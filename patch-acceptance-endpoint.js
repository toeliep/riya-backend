const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const anchor = "app.get('/', (req, res) => res.send('Riya backend running.'));";

const newEndpoint = "app.post('/record-acceptance', async (req, res) => {\n  const { roa_token, client_name, client_email, broker_token } = req.body;\n  if (!client_name || !client_email) return res.status(400).json({ error: 'Client name and email are required.' });\n  try {\n    await supabaseRequest('POST', 'acceptances', {\n      roa_token: roa_token || null,\n      client_name: client_name,\n      client_email: client_email,\n      broker_token: broker_token || null,\n      accepted_at: new Date().toISOString()\n    });\n    return res.json({ success: true, accepted_at: new Date().toISOString() });\n  } catch(e) {\n    return res.status(500).json({ error: e.message });\n  }\n});\n\n" + anchor;

if (!content.includes(anchor)) {
  console.log('ERROR: anchor not found.');
} else {
  content = content.replace(anchor, newEndpoint);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: /record-acceptance endpoint added.');
}