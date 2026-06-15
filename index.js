const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const SYSTEM_ROA = "You are Riya, an expert South African FAIS compliance assistant. You produce professional, FAIS-compliant Records of Advice for South African short-term insurance brokers under the FAIS Act 37 of 2002, Board Notice 80 of 2003, and General Notice 706 of 2020.\nProduce a complete, professional RoA covering ALL of the following sections:\n1. FSP and Representative Details\n2. Client Identification and KYC/FICA/POPIA confirmation\n3. Needs Analysis - detailed risk profile and identified needs per asset category\n4. Market Comparison - all three insurers compared with reasons for recommendation\n5. Product Recommended - full Section 9(1) statutory detail including exclusions, excess structure, SASRIA\n6. Remuneration and Conflict of Interest declaration\n7. Replacement Advice (if applicable)\n8. Client Acceptance Record\nBe thorough and substantive. Use clear numbered headings. Write in professional English suitable for FSCA inspection. Do not cite case law. Do NOT use markdown tables - use labeled paragraphs and bullet points instead.";

const SYSTEM_EXTRACT = "You are a South African FAIS insurance compliance assistant. Extract all available insurance and client details from the provided text. Return ONLY valid raw JSON - no preamble, no markdown, no backticks - with these exact keys: brokerName, fspNumber, advisorName, fspAddress, complianceOfficer, clientCommsMethod, clientName, clientContact, clientReg, clientEmail, clientAddress, businessNature, businessTurnover, fleetSize, fleetValue, fleetTypes, fleetTracking, gitRequired, gitLimit, gitGoods, insuranceClass, insurer, premium, sumInsured, coverBasis, exclusions, excessStructure, commission, cmp1Insurer, cmp1Premium, cmp1Excess, cmp1NotRec, cmpRecInsurer, cmpRecPremium, cmpRecExcess, cmpRecReason, cmp3Insurer, cmp3Premium, cmp3Excess, cmp3NotRec, replacement, replacementDetails, replacementReason, additionalFacts, conflictOfInterest, claimsNotes. Use empty string for any field not found. replacement must be YES or NO.";Paste Part 2 directly after Part 1 (no gap needed):
javascriptfunction callClaude(apiKey, system, user, maxTokens) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 1500,
      system: system,
      messages: [{ role: 'user', content: user }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) reject(new Error('Status ' + res.statusCode + ': ' + (parsed.error && parsed.error.message || 'API error')));
          else resolve(parsed.content && parsed.content.map(b => b.text || '').join('') || '');
        } catch(e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', e => reject(new Error('Network: ' + e.message)));
    req.write(payload);
    req.end();
  });
}

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

app.post('/generate-roa', async (req, res) => {
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

    const user1 = user + '\n\nGenerate sections 1-4 only. Be concise.\n1. FSP Details\n2. Client KYC/FICA/POPIA\n3. Needs Analysis\n4. Market Comparison';
    const user2 = user + '\n\nGenerate sections 5-8 only. Be concise.\n5. Product Recommended\n6. Remuneration and COI\n7. Replacement Advice\n8. Client Acceptance';

    let part1 = '', part2 = '';
    try { part1 = await callClaude(apiKey, SYSTEM_ROA, user1, 1500); } catch(e) { part1 = 'Sections 1-4 error: ' + e.message; }
    try { part2 = await callClaude(apiKey, SYSTEM_ROA, user2, 1500); } catch(e) { part2 = 'Sections 5-8 error: ' + e.message; }

    const combined = (part1 + '\n\n---\n\n' + part2).trim();

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
});

app.get('/', (req, res) => res.send('Riya backend running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Riya backend listening on port ' + PORT));