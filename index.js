const express = require('express');
const { sendWelcomeEmail } = require('./resend_helper');

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

const SYSTEM_EXTRACT = "You are a South African FAIS insurance compliance assistant. Extract all available insurance and client details from the provided text. Return ONLY valid raw JSON - no preamble, no markdown, no backticks - with these exact keys: brokerName, fspNumber, advisorName, fspAddress, complianceOfficer, clientCommsMethod, clientName, clientContact, clientReg, clientEmail, clientAddress, businessNature, businessTurnover, fleetSize, fleetValue, fleetTypes, fleetTracking, gitRequired, gitLimit, gitGoods, insuranceClass, insurer, premium, sumInsured, coverBasis, exclusions, excessStructure, commission, cmp1Insurer, cmp1Premium, cmp1Excess, cmp1NotRec, cmpRecInsurer, cmpRecPremium, cmpRecExcess, cmpRecReason, cmp3Insurer, cmp3Premium, cmp3Excess, cmp3NotRec, replacement, replacementDetails, replacementReason, additionalFacts, conflictOfInterest, claimsNotes. Use empty string for any field not found. replacement must be YES or NO.";

function callClaude(apiKey, system, user, maxTokens) {
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
        console.log('SUPABASE RESPONSE [' + path + ']: status=' + res.statusCode + ' body=' + data);
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

    const user1 = user + '\n\nGenerate ONLY sections 1 and 2. Stop after section 2. Be concise — bullet points only.\n1. FSP and Representative Details\n2. Client Identification, KYC, FICA and POPIA. STOP HERE.';
    const user2 = user + '\n\nGenerate ONLY sections 3 and 4. Do not generate any other sections. Be concise — bullet points only.\n3. Needs Analysis — one short paragraph per asset class (motor, buildings, contents, all-risk, liability)\n4. Market Comparison — three insurers compared: premium, excess, key inclusions, reason recommended or not. STOP HERE.';
    const user3 = user + '\n\nGenerate ONLY sections 5 to 8. Be concise — bullet points only.\n5. Product Recommended — sum insured schedule, exclusions, excess structure, SASRIA\n6. Remuneration and Conflict of Interest\n7. Replacement Advice\n8. Client Acceptance Record. End with the Riya footer.';

    let part1 = '', part2 = '', part3 = '';
    try { part1 = await callClaude(apiKey, SYSTEM_ROA, user1, 2000); } catch(e) { part1 = 'Error: ' + e.message; }
    try { part2 = await callClaude(apiKey, SYSTEM_ROA, user2, 2500); } catch(e) { part2 = 'Error: ' + e.message; }
    try { part3 = await callClaude(apiKey, SYSTEM_ROA, user3, 4000); } catch(e) { part3 = 'Error: ' + e.message; }

    const combined = (part1 + '\n\n---\n\n' + part2 + '\n\n---\n\n' + part3).trim();

    let warnings = [];
    try {
      const verifyPrompt = 'BROKER INPUT:\n' + user + '\n\nGENERATED DOCUMENT:\n' + combined + '\n\nList ONLY specific facts in the GENERATED DOCUMENT that do NOT appear anywhere in the BROKER INPUT above. Check CAREFULLY for: any insurer, company, or institution name mentioned in the document that does NOT appear in the broker input at all - this is the most serious issue, flag the entire fabricated company by name; invented insurer ratings, complaint counts, claims timeframes; specific sums insured not stated by the broker; fabricated conflict-of-interest scenarios; any invented dates, numbers, or names. Return ONLY a JSON array of short strings, each phrased as Not confirmed in your input - followed by the specific detail - rather than using the word invented or fabricated. If nothing is unconfirmed, return exactly: []';
      const verifyResult = await callClaude(apiKey, 'You are a strict fact-checker. Output ONLY a raw JSON array, nothing else.', verifyPrompt, 800);
      const cleaned = verifyResult.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      warnings = JSON.parse(cleaned);
      if (!Array.isArray(warnings)) warnings = [];
    } catch(e) { warnings = []; }

    if (broker) {
      const roaType = user.includes('Commercial Lines') ? 'commercial' : 'personal';
    const creditCost = roaType === 'commercial' ? 2 : 1;
      await deductCredit(token, roaType, broker, creditCost);
    }

    return res.json({ content: [{ type: 'text', text: combined }], warnings: warnings });
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

app.post('/record-acceptance', async (req, res) => {
  const { roa_token, client_name, client_email, broker_token } = req.body;
  if (!client_name || !client_email) return res.status(400).json({ error: 'Client name and email are required.' });
  try {
    await supabaseRequest('POST', 'acceptances', {
      roa_token: roa_token || null,
      client_name: client_name,
      client_email: client_email,
      broker_token: broker_token || null
    });
    return res.json({ success: true, accepted_at: new Date().toISOString() });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('Riya backend running.'));

const PORT = process.env.PORT || 3000;

app.post('/create-payment', async (req, res) => {
  const { token, bundle } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required.' });

  const bundles = {
    starter:  { credits: 50,   amount: '20.00',  name: 'Riya Starter — 50 RoAs' },
    standard: { credits: 200,  amount: '80.00',  name: 'Riya Standard — 200 RoAs' },
    pro:      { credits: 500,  amount: '200.00', name: 'Riya Pro — 500 RoAs' },
    catchup:  { credits: 1000, amount: '350.00', name: 'Riya Catch-Up — 1,000 RoAs' }
  };

  const selected = bundles[bundle];
  if (!selected) return res.status(400).json({ error: 'Invalid bundle.' });

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;

  const paymentData = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: 'https://riya-pilot.netlify.app?payment=success',
    cancel_url: 'https://riya-pilot.netlify.app?payment=cancelled',
    notify_url: 'https://riya-backend-production.up.railway.app/payfast-webhook',
    item_name: selected.name,
    amount: selected.amount,
    custom_str1: token,
    custom_int1: selected.credits.toString()
  };

  const params = Object.entries(paymentData)
    .map(([k, v]) => k + '=' + encodeURIComponent(v).replace(/%20/g, '+'))
    .join('&');

  const payUrl = 'https://www.payfast.co.za/eng/process?' + params;
  return res.json({ url: payUrl });
});

app.post('/payfast-webhook', async (req, res) => {
  const { payment_status, custom_str1, custom_int1 } = req.body;

  if (payment_status !== 'COMPLETE') return res.sendStatus(200);

  const token = custom_str1;
  const credits = parseInt(custom_int1 || '0');

  if (!token || !credits) return res.sendStatus(200);

  try {
    const broker = await validateBrokerToken(token);
    if (!broker) return res.sendStatus(200);

    await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {
      credits: broker.credits + credits
    });

    console.log('Credits added: ' + credits + ' to ' + token);
  } catch(e) {
    console.error('Webhook error:', e.message);
  }

  return res.sendStatus(200);
});

app.post('/create-token', async (req, res) => { const {name,email,token,fsp_number,plan,credits} = req.body; if(!name||!email||!token) return res.status(400).json({error:'missing fields'}); try { const r = await fetch(process.env.SUPABASE_URL+'/rest/v1/brokers',{method:'POST',headers:{'Content-Type':'application/json','apikey':process.env.SUPABASE_SERVICE_KEY,'Authorization':'Bearer '+process.env.SUPABASE_SERVICE_KEY,'Prefer':'return=representation'},body:JSON.stringify({name,email,token,fsp_number:fsp_number||null,plan:plan||'pilot',credits:credits||5,credits_used:0,status:'active'})}); if(!r.ok){const e=await r.text();return res.status(500).json({error:e});} await sendWelcomeEmail(name,email,token); res.json({success:true}); } catch(err){res.status(500).json({error:err.message});} });
app.listen(PORT, () => console.log('Riya backend listening on port ' + PORT));