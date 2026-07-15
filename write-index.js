const fs = require('fs');
const old = fs.readFileSync('index.js', 'utf8');

const supabaseFn = `
function supabaseRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'sunihvgxtqbjjuvnrpof.supabase.co',
      path: '/rest/v1/' + path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'Prefer': 'return=representation'
      }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', e => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}

async function validateBrokerToken(token) {
  const result = await supabaseRequest('GET', 'brokers?token=eq.' + encodeURIComponent(token) + '&select=*');
  if (!result || !result.length) return null;
  return result[0];
}

async function deductCredit(token, roaType, broker) {
  await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {
    credits: broker.credits - 1,
    credits_used: broker.credits_used + 1,
    last_used: new Date().toISOString()
  });
  await supabaseRequest('POST', 'usage_log', {
    token: token,
    broker_name: broker.name,
    roa_type: roaType || 'unknown'
  });
}
`;

const newRoute = `app.post('/generate-roa', async (req, res) => {
  const { user, mode, token } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const masterToken = process.env.RIYA_ACCESS_TOKEN;

  if (!token) return res.status(401).json({ error: 'No token provided.' });

  let broker = null;
  if (token !== masterToken) {
    broker = await validateBrokerToken(token);
    if (!broker) return res.status(401).json({ error: 'Invalid token.' });
    if (broker.status !== 'active') return res.status(403).json({ error: 'Account suspended. Contact support.' });
    if (broker.credits <= 0) return res.status(403).json({ error: 'No credits remaining. Please top up to continue.' });
  }

  if (!apiKey) return res.status(500).json({ error: 'Server configuration error.' });

  try {
    if (mode === 'extract') {
      const result = await callClaude(apiKey, SYSTEM_EXTRACT, user, 2000);
      return res.json({ content: [{ type: 'text', text: result }] });
    }

    const user1 = user + '\\n\\nGenerate sections 1-4 only.\\n1. FSP Details\\n2. Client KYC\\n3. Needs Analysis\\n4. Market Comparison';
    const user2 = user + '\\n\\nGenerate sections 5-8 only.\\n5. Product Recommended\\n6. Remuneration\\n7. Replacement\\n8. Client Acceptance';

    let part1 = '', part2 = '';
    try { part1 = await callClaude(apiKey, SYSTEM_ROA, user1, 1500); } catch(e) { part1 = 'Error: ' + e.message; }
    try { part2 = await callClaude(apiKey, SYSTEM_ROA, user2, 1500); } catch(e) { part2 = 'Error: ' + e.message; }

    const combined = (part1 + '\\n\\n---\\n\\n' + part2).trim();

    if (broker) {
      const roaType = user.includes('Commercial Lines') ? 'commercial' : 'personal';
      await deductCredit(token, roaType, broker);
    }

    return res.json({ content: [{ type: 'text', text: combined }] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/credits', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });
  const broker = await validateBrokerToken(token);
  if (!broker) return res.status(404).json({ error: 'Token not found.' });
  return res.json({ name: broker.name, credits: broker.credits, credits_used: broker.credits_used, status: broker.status });
});`;

let code = old;
code = code.replace("app.post('/generate-roa'", supabaseFn + "\napp.post('/generate-roa'");
code = code.replace(/app\.post\('\/generate-roa[\s\S]*?^\}\);/m, newRoute);

fs.writeFileSync('index.js', code, 'utf8');
console.log('Done. Lines: ' + code.split('\n').length);