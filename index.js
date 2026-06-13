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

app.post('/generate-roa', async (req, res) => {
  const { user, mode, token } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const validToken = process.env.RIYA_ACCESS_TOKEN;

  if (!token || token !== validToken) return res.status(401).json({ error: 'Unauthorised.' });
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
    return res.json({ content: [{ type: 'text', text: combined }] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('Riya backend running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Riya backend listening on port ' + PORT));