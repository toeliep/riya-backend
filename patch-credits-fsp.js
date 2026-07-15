const fs = require('fs');

const filePath = 'index.js';
let content = fs.readFileSync(filePath, 'utf8');

const oldRoute = "app.get('/credits', async (req, res) => {\n  const { token } = req.query;\n  if (!token) return res.status(400).json({ error: 'Token required.' });\n  const broker = await validateBrokerToken(token);\n  if (!broker) return res.status(404).json({ error: 'Token not found.' });\n  return res.json({ name: broker.name, credits: broker.credits, credits_used: broker.credits_used, status: broker.status });\n});";

const newRoute = "app.get('/credits', async (req, res) => {\n  const { token } = req.query;\n  if (!token) return res.status(400).json({ error: 'Token required.' });\n  const broker = await validateBrokerToken(token);\n  if (!broker) return res.status(404).json({ error: 'Token not found.' });\n  return res.json({ name: broker.name, credits: broker.credits, credits_used: broker.credits_used, status: broker.status, fsp_firm_name: broker.fsp_firm_name || '', fsp_number: broker.fsp_number || '', fsp_address: broker.fsp_address || '', compliance_officer: broker.compliance_officer || '' });\n});";

if (!content.includes(oldRoute)) {
  console.log('ERROR: Could not find the exact old route text. No changes made.');
  process.exit(1);
}

const occurrences = content.split(oldRoute).length - 1;
if (occurrences > 1) {
  console.log('ERROR: Found ' + occurrences + ' matches, expected exactly 1. Aborting.');
  process.exit(1);
}

content = content.replace(oldRoute, newRoute);
fs.writeFileSync(filePath, content, 'utf8');
console.log('SUCCESS: /credits route updated to include FSP profile fields.');