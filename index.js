const express = require('express');
const fs = require('fs');
const { sendWelcomeEmail, sendRoAEmail, parseRoAContent } = require('./resend_helper');
const PDFDocument = require('pdfkit');
const https = require('https');
const multerUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function transcribeWithElevenLabs(fileBuffer, filename, mimetype) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return reject(new Error('ELEVENLABS_API_KEY not configured on server'));
    const boundary = '----RiyaVoiceBoundary' + Date.now();
    const parts = [];
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v2\r\n'));
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + (mimetype || 'application/octet-stream') + '\r\n\r\n'));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
    const payload = Buffer.concat(parts);
    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/speech-to-text',
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': payload.length }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) reject(new Error('ElevenLabs error (' + res.statusCode + '): ' + (parsed.detail || JSON.stringify(parsed)).substring(0, 300)));
          else resolve(parsed.text || '');
        } catch (e) { reject(new Error('ElevenLabs parse error: ' + e.message)); }
      });
    });
    req.on('error', e => reject(new Error('Network: ' + e.message)));
    req.write(payload);
    req.end();
  });
}

const app = express();
const cors = require('cors');
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

function forceHeadingLinebreaks(text) {
  let out = text.replace(/#{1,3}\s*(?=\d{1,2}\.\s+[A-Z])/gi, '');
  const knownTitles = [
    'FSP AND REPRESENTATIVE DETAILS',
    'CLIENT IDENTIFICATION,?\\s*KYC,?\\s*FICA AND POPIA(?:\\s+CONFIRMATION)?',
    'NEEDS ANALYSIS',
    'MARKET COMPARISON',
    'PRODUCT RECOMMENDED',
    'REMUNERATION AND CONFLICT OF INTEREST',
    'REPLACEMENT ADVICE',
    'CLIENT ACCEPTANCE RECORD'
  ];
  const titleAlt = knownTitles.join('|');
  const headingRe = new RegExp('(\\d{1,2}\\.\\s+(?:' + titleAlt + '))', 'gi');
  out = out.replace(new RegExp('([^\\n])' + '(\\d{1,2}\\.\\s+(?:' + titleAlt + '))', 'gi'), '$1\n\n$2');
  out = out.replace(headingRe, '$1\n');
  out = out.replace(/([^\n])(\d{1,2}\.\s+[A-Z][A-Z\s,&/-]{4,})/g, '$1\n\n$2');
  out = out.replace(/\b([A-Z]{2,}(?:[\s,&/-]+[A-Z]{2,})*)([A-Z][a-z])/g, '$1\n$2');
  out = out.replace(/([^\n-])-{2,3}(\n|$)/g, '$1$2');
  out = out.replace(/^-{3,}\s*$/gm, '');
  return out;
}

function trimToSection(text, sectionNumber) {
  const re = new RegExp('(^|\\n)\\s*' + sectionNumber + '\\.\\s+[A-Z]');
  const match = re.exec(text);
  if (match) {
    return text.slice(match.index + match[1].length).trim();
  }
  return text.trim();
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const SYSTEM_ROA = "You are Riya, an expert South African FAIS compliance assistant. You produce professional, FAIS-compliant Records of Advice for South African short-term insurance brokers under the FAIS Act 37 of 2002, Board Notice 80 of 2003, and General Notice 706 of 2020.\nProduce a complete, professional RoA covering ALL of the following sections:\n1. FSP and Representative Details\n2. Client Identification and KYC/FICA/POPIA confirmation\n3. Needs Analysis - detailed risk profile and identified needs per asset category\n4. Market Comparison - all three insurers compared with reasons for recommendation\n5. Product Recommended - full Section 9(1) statutory detail including exclusions, excess structure, SASRIA\n6. Remuneration and Conflict of Interest declaration\n7. Replacement Advice (if applicable)\n8. Client Acceptance Record\nBe thorough and substantive. Use clear numbered headings. Write in professional English suitable for FSCA inspection. Do not cite case law. Do NOT use markdown tables - use labeled paragraphs and bullet points instead. CRITICAL LEGAL CITATIONS — always use these exact references: Financial Intelligence Centre Act 38 of 2001 (NOT 2020, NOT 1986); FAIS Act 37 of 2002; Short-Term Insurance Act 53 of 1998; POPIA Act 4 of 2013; Board Notice 80 of 2003; General Notice 706 of 2020. CRITICAL: Do NOT insert any '---' separator lines or '##' markdown characters anywhere in the output. Only use section numbers (1. 2. 3. etc) as headings. Never add separator lines.";

const SYSTEM_EXTRACT = "You are a South African FAIS insurance compliance assistant. Extract all available insurance and client details from the provided text. Return ONLY valid raw JSON - no preamble, no markdown, no backticks - with these exact keys: brokerName, fspNumber, advisorName, fspAddress, complianceOfficer, clientCommsMethod, clientName, clientContact, clientReg, clientEmail, clientAddress, businessNature, businessTurnover, fleetSize, fleetValue, fleetTypes, fleetTracking, gitRequired, gitLimit, gitGoods, insuranceClass, insurer, premium, sumInsured, coverBasis, exclusions, excessStructure, commission, cmp1Insurer, cmp1Premium, cmp1Excess, cmp1NotRec, cmpRecInsurer, cmpRecPremium, cmpRecExcess, cmpRecReason, cmp3Insurer, cmp3Premium, cmp3Excess, cmp3NotRec, replacement, replacementDetails, replacementReason, additionalFacts, conflictOfInterest, claimsNotes, triggerEvent, businessEmployees, publicLiabilityLimit, businessInterruptionRequired, vehicles, buildOwns, buildValue, buildSecurity, contentsSumInsured, scheduledItems, renewalPolicyNumber, renewalCurrentInsurer, renewalCurrentPremium, renewalNewPremium, renewalSumChanges, renewalRiskChange, renewalRemarketed, amendmentPolicyNumber, amendmentType, amendmentDescription, telephoneAdvice, telephoneFollowup, telephoneConfirmation, kycId, kycAddress, popiaConsent, claimsHistory, claimsNotes, faisDisclosure, existingCover, coverGaps. Use empty string for any field not found. For vehicles: extract as a JSON array of objects, each with keys: year, make, model, regNo, retailValue, primaryUse, driverAge, tracking, financed, overnightParking. Extract ALL vehicles mentioned. For buildOwns: use Yes-freehold if client owns home freehold, Yes-sectional-title if sectional title, No-renting if renting. For buildValue: extract the replacement/rebuild value as a number string. For buildSecurity: extract any security measures mentioned. For contentsSumInsured: extract contents sum insured as a number string. For advisorName: extract the name of the advising broker or representative from the input text. If no adviser name is mentioned in the input, leave this field as empty string — never use the word Riya as an adviser name. For clientReg: extract the client's South African ID number (13 digits) or company registration number (CIPC format) as a plain string with no spaces or formatting. ALWAYS extract a 13-digit number as an ID number and map it to clientReg. For clientContact: extract ONLY the phone/cell number as digits and spaces e.g. 071 882 3345 — never extract a person name into this field. For insuranceClass: if the client is a business, company, or contractor, ALWAYS start with Commercial-Lines e.g. Commercial-Lines-Motor-Plant-Equipment. If personal consumer, start with Personal-Lines. For triggerEvent: MUST be exactly one of these four values only: new, renewal, amendment, telephone. Use new if this is a new policy or new business. Use renewal if an existing policy is being renewed. Use amendment if cover is being changed. Use telephone if this is a telephone advice record. Default to new if unclear. For businessEmployees: extract number of permanent employees as a string. For publicLiabilityLimit: extract the public liability limit required as a string e.g. R10,000,000. For businessInterruptionRequired: set to Yes if business interruption cover is mentioned or required, otherwise No. For scheduledItems: extract as a semicolon-separated string of scheduled/all-risk items with values e.g. Rolex Submariner R65000; Laptop R28000. Include ALL valuable items mentioned with their values. For vehicles array: for each vehicle, set financed to YES if the text mentions finance, bond, WesBank, Absa, Nedbank, FNB, or any bank in relation to that vehicle, otherwise NO. Set overnightParking from any parking description. For clientCommsMethod: extract how the broker met or communicated with the client e.g. Home visit, Office meeting, Telephone, Email. For insuranceClass: extract the full insurance class e.g. Personal Lines - Motor, Household Contents, Buildings. For sumInsured: extract the total sum insured across all assets as a descriptive string e.g. Motor R680000 and R165000, Contents R380000, Buildings R2100000. CRITICAL RULE FOR replacement FIELD: only set replacement to YES if the text explicitly describes an existing policy being replaced, switched, or cancelled in favour of a new one (for example explicit phrases like existing policy with, currently insured with, switching from, replacing cover with). If the text describes a New Policy or does not mention any existing cover at all, replacement MUST be NO. Do not infer or assume a replacement scenario - default to NO whenever uncertain. CRITICAL RULE FOR cmpRecInsurer: this field must contain the insurer the broker explicitly marked or described as recommended, accepted, or chosen - never the insurer described as not recommended, rejected, or having reputation concerns, even if it is mentioned first or most prominently in the text. For renewalPolicyNumber: extract the existing policy number being renewed. For renewalCurrentInsurer: extract the name of the current insurer for the policy being renewed. For renewalCurrentPremium: extract the current/expiring annual premium as a number string. For renewalNewPremium: extract the renewal premium being offered as a number string. For renewalSumChanges: extract a description of any changes to sums insured since the last renewal, or state that nothing has changed if the text explicitly says so. For renewalRiskChange: this field must be set to EXACTLY one of these two strings only - No material change OR Yes — details below. DEFAULT to No material change unless the text EXPLICITLY and CLEARLY describes a specific change to the client's risk profile, such as a new address, new vehicle, new driver, or new valuables. Simply reviewing sums insured or renewing without any described change is NOT a risk profile change - if in doubt, use No material change. For renewalRemarketed: this field must be set to EXACTLY one of these two strings only - Yes — comparison below OR No — renewal competitive. Use the Yes option only if the broker obtained comparative quotes from other insurers this renewal; otherwise use the No option. For amendmentPolicyNumber: extract the existing policy number being amended. For amendmentType: extract a short description of the type of amendment, for example Adding a vehicle, Removing a vehicle, Sum insured change, or Address change. For amendmentDescription: extract a full description of the amendment including the reason for the change. For telephoneAdvice: extract a full description of the client's question or enquiry and the specific advice given by the broker on the call - this must be substantive, not a one-line summary. For telephoneFollowup: extract the follow-up action required, including any outstanding items and timelines mentioned. For telephoneConfirmation: set to \"Yes - email sent\" if an email confirmation was sent to the client, \"Yes - WhatsApp sent\" if confirmed via WhatsApp, or \"No follow-up required\" if no confirmation was mentioned as sent. For gitRequired: set to Yes if goods in transit cover is mentioned as required, a per-conveyance limit is stated, or type of goods carried is described - otherwise No. For kycId: this field must be set to EXACTLY one of these three strings only - Yes — certified copy on file OR Yes — eKYC verified OR Pending. DEFAULT to Pending unless the text EXPLICITLY states ID or CIPC registration was verified or a certified copy was obtained - do not infer verification just because KYC is mentioned generally. For kycAddress: this field must be set to EXACTLY one of these three strings only - Yes — on file, not older than 3 months OR Pending OR Not required (commercial). DEFAULT to Pending unless the text EXPLICITLY states proof of address was obtained or is on file. For popiaConsent: this field must be set to EXACTLY one of these three strings only - Yes — signed consent on file OR Yes — digital consent captured OR Pending. DEFAULT to Pending unless the text EXPLICITLY states POPIA consent was signed or captured. For claimsHistory: this field must be set to EXACTLY one of these three strings only - Yes — declared, no material claims OR Yes — claims declared (see below) OR Not yet declared. Use the no material claims option only if the text explicitly states no claims to declare; use the claims declared option only if specific claims are described; otherwise DEFAULT to Not yet declared. For claimsNotes: extract details of any specific claims declared by the client, or leave empty if none mentioned. For faisDisclosure: this field must be set to EXACTLY one of these two strings only - Yes — provided and acknowledged OR Pending. DEFAULT to Pending unless the text EXPLICITLY states the FAIS disclosure document was provided and/or acknowledged. For existingCover: extract a description of the client's existing policies, insurers, and policy numbers currently in place if mentioned, or leave empty if not mentioned. For coverGaps: extract any identified gaps or duplications in current cover mentioned in the text, or leave empty if not mentioned. IMPORTANT - MULTIPLE DOCUMENTS: the input text may contain several documents concatenated together, each preceded by a '--- FROM: filename ---' marker. You MUST read and extract relevant details from EVERY document present, not only the first or the last one. Merge details found across all documents into the single JSON output - for example, a vehicle mentioned only in one document and a policy premium mentioned only in another must both appear in the final result.";

const SYSTEM_SUFFICIENCY = "You are a South African FAIS insurance compliance assistant checking whether a broker input contains enough information to produce a defensible Record of Advice. You will be given the broker raw input text, the Trigger Event, and the Lines of Business. Return ONLY a valid raw JSON array of short strings, no preamble, no markdown, no backticks. Each string describes ONE specific missing piece of essential information. If everything essential is present, return exactly []. NEW POLICY needs client identity, one concrete asset with detail, one insurer and premium. Flag but do not invent: a market comparison if only one insurer is mentioned; KYC confirmations if not stated; for Commercial, turnover and Gross Profit if Business Interruption is mentioned with no financials; liability limits if a liability type is mentioned with no limit. PERSONAL LINES RULES — do NOT flag any of the following as missing: income, occupation, employment status, or dependents (not required for standard personal lines RoA); premium breakdown per cover section (a single all-in premium is acceptable); confirmation that sum insured amounts are agreed vs estimated when specific rand values are clearly stated in the notes; general needs analysis documentation when assets and cover requirements are clearly described. For personal lines, limit flags to genuine FAIS gaps only: missing KYC if not mentioned, missing market comparison if only one insurer quoted on new business, missing replacement advice confirmation if switching insurers, missing excess structure if no excess mentioned at all. RENEWAL needs an existing policy reference and a premium figure. CRITICAL: only expect a market comparison if the input explicitly says the client was re-marketed to other insurers. If the input only describes the existing insurer renewal with no competing quotes, do NOT flag the absence of a market comparison, this is correct expected behaviour. Flag what has changed since last period if nothing is mentioned. AMENDMENT needs an existing policy reference and a description of the change. Never flag missing market comparison for an amendment. If the change involves moving to a different insurer, flag this as possibly a Policy Replacement needing fuller documentation. TELEPHONE ADVICE needs a date and a description of what was discussed and advised. Do not flag missing needs analysis or market comparison unless the call covered that ground, these records are expected to be short. If Renewal has no policy reference at all, do not refuse, still generate with the gap flagged prominently.";

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
      const fileMarkerCount = (user.match(/--- FROM: /g) || []).length;
      const inputCharCount = user.length;
      const result = await callClaude(apiKey, SYSTEM_EXTRACT, user, 4000);
      let parsedOk = false;
      let nonEmptyFieldCount = 0;
      let totalFieldCount = 0;
      try {
        const clean = result.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        parsedOk = true;
        totalFieldCount = Object.keys(parsed).length;
        nonEmptyFieldCount = Object.values(parsed).filter(v => {
          if (Array.isArray(v)) return v.length > 0;
          return v !== '' && v !== null && v !== undefined;
        }).length;
      } catch (e) {
        parsedOk = false;
      }
      console.log('EXTRACT metrics: token=' + (token || 'unknown') + ' documentsDetected=' + (fileMarkerCount || 1) + ' inputChars=' + inputCharCount + ' jsonParsedOk=' + parsedOk + ' fieldsPopulated=' + nonEmptyFieldCount + '/' + totalFieldCount);
      return res.json({ content: [{ type: 'text', text: result }] });
    }

    if (mode === 'sufficiency') {
      const triggerEvent = req.body.triggerEvent;
      const linesOfBusiness = req.body.linesOfBusiness;
      const sufficiencyPrompt = 'Trigger Event: ' + (triggerEvent || 'New Policy') + '\nLines of Business: ' + (linesOfBusiness || 'Personal') + '\n\nBroker input:\n' + user;
      const result2 = await callClaude(apiKey, SYSTEM_SUFFICIENCY, sufficiencyPrompt, 1000);
      const cleaned2 = result2.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      let gaps = [];
      try { gaps = JSON.parse(cleaned2); if (!Array.isArray(gaps)) gaps = []; } catch(e) { gaps = []; }
      console.log('SUFFICIENCY metrics: token=' + (token || 'unknown') + ' trigger=' + (triggerEvent || 'unknown') + ' lines=' + (linesOfBusiness || 'unknown') + ' gapCount=' + gaps.length);
      return res.json({ gaps: gaps });
    }

    const user1 = user + '\n\nGenerate ONLY sections 1 and 2. Stop after section 2. Be concise - bullet points only.\n1. FSP and Representative Details\n2. Client Identification, KYC, FICA and POPIA. Do not write anything beyond section 2 - end your response immediately after completing it, with no additional text or commentary. DO NOT include any --- separator lines or ## markdown.';
    let part1 = '';
    try { part1 = await callClaude(apiKey, SYSTEM_ROA, user1, 2000); } catch(e) { part1 = 'Error: ' + e.message; }
    part1 = forceHeadingLinebreaks(part1);
    part1 = trimToSection(part1, 1);

    const user2 = user + '\n\n--- PRIOR SECTIONS (1 AND 2), READ SILENTLY FOR CONTEXT - DO NOT OUTPUT, REPEAT, REPRODUCE, SUMMARISE OR REFERENCE THIS BLOCK IN ANY WAY ---\n' + part1 + '\n--- END OF PRIOR SECTIONS ---\n\nYour response must begin DIRECTLY with the heading for section 3. Do not include any title, heading, restatement, or summary of sections 1 or 2 anywhere in your response. Generate ONLY sections 3 and 4. Do not generate any other sections. Be consistent with the FSP, client and trigger details already established above. Be concise - bullet points only.\n3. Needs Analysis - one short paragraph per asset class relevant to what changed or is being discussed (motor, buildings, contents, all-risk, liability). For Amendment or Telephone Advice triggers, keep this brief and focused only on the specific change or query, not a full fresh needs analysis.\n4. Market Comparison - CRITICAL RULE: only produce a genuine multi-insurer comparison if the input explicitly contains real quotes or premiums from more than one insurer. If this is an Amendment, Telephone Advice, or a Renewal with no re-marketing mentioned, and no genuine multi-insurer data is present in the input, write exactly: Market Comparison - Not applicable - this is a [trigger type] and no new market comparison was required or conducted. Do NOT invent insurer names, premiums, or a comparison that was not actually provided. Do not write anything beyond section 4 - end your response immediately after completing it, with no additional text or commentary. DO NOT include any --- separator lines or ## markdown.';
    let part2 = '';
    try { part2 = await callClaude(apiKey, SYSTEM_ROA, user2, 2500); } catch(e) { part2 = 'Error: ' + e.message; }
    part2 = forceHeadingLinebreaks(part2);
    part2 = trimToSection(part2, 3);

    const user3 = user + '\n\n--- PRIOR SECTIONS (3 AND 4), READ SILENTLY FOR CONTEXT - DO NOT OUTPUT, REPEAT, REPRODUCE, SUMMARISE OR REFERENCE THIS BLOCK IN ANY WAY ---\n' + part2 + '\n--- END OF PRIOR SECTIONS ---\n\nYour response must begin DIRECTLY with the heading for section 5. Do not include any title, heading, restatement, or summary of sections 1, 2, 3 or 4 anywhere in your response, and do not write a new document title such as "Record of Advice" again. Generate ONLY sections 5 to 8. CRITICAL: Section 5 (Product Recommended) MUST recommend the EXACT SAME insurer that was identified as recommended in the Market Comparison section above - do not introduce a different insurer or different premium figures. Be concise - bullet points only.\n5. Product Recommended - sum insured schedule, exclusions, excess structure, SASRIA\n6. Remuneration and Conflict of Interest\n7. Replacement Advice\n8. Client Acceptance Record - end this section with a signature block containing exactly these lines on their own: "Client Signature: _________________________", "Client Name (print): _________________________", "Date: _________________________", then a blank line, then "Adviser Signature: _________________________", "Adviser Name (print): _________________________", "Date: _________________________". End with the Riya footer. CRITICAL: In Section 1 Representative Details, use the adviser name from the Representative Name field. Never use the name Riya as the representative name. Riya is the system, not the adviser. DO NOT include any --- separator lines or ## markdown anywhere in sections 5-8.';

    let part3 = '';
    try { part3 = await callClaude(apiKey, SYSTEM_ROA, user3, 4000); } catch(e) { part3 = 'Error: ' + e.message; }
    part3 = forceHeadingLinebreaks(part3);
    part3 = trimToSection(part3, 5);

    // COMBINE WITHOUT SEPARATOR LINES
    const combined = (part1 + '\n\n' + part2 + '\n\n' + part3).trim();

    // Defensive fallback: guarantee a client + adviser signature block always exists
    const finalCombined = combined.includes('Client Signature:')
      ? combined
      : combined + '\n\nClient Signature: _________________________\nClient Name (print): _________________________\nDate: _________________________\n\nAdviser Signature: _________________________\nAdviser Name (print): _________________________\nDate: _________________________';

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
      const creditCost = roaType === 'commercial' ? 3 : 2;
      await deductCredit(token, roaType, broker, creditCost);
    }

    return res.json({ content: [{ type: 'text', text: finalCombined }], warnings: warnings });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/transcribe-voice', multerUpload.single('audio'), async (req, res) => {
  const token = req.body && req.body.token;
  const masterToken = process.env.RIYA_ACCESS_TOKEN;

  if (!token) return res.status(401).json({ error: 'No token provided.' });
  if (!req.file) return res.status(400).json({ error: 'No audio file received.' });

  if (token !== masterToken) {
    const broker = await validateBrokerToken(token);
    if (!broker) return res.status(401).json({ error: 'Invalid token.' });
    if (broker.status !== 'active') return res.status(403).json({ error: 'Account suspended. Contact support.' });
  }

  const allowedExt = ['.m4a', '.mp3', '.wav', '.ogg', '.mp4', '.webm'];
  const ext = '.' + (req.file.originalname.split('.').pop() || '').toLowerCase();
  if (!allowedExt.includes(ext)) {
    return res.status(400).json({ error: 'Unsupported audio format. Please upload .m4a, .mp3, .wav, or .ogg.' });
  }

  try {
    const transcript = await transcribeWithElevenLabs(req.file.buffer, req.file.originalname, req.file.mimetype);

    if (!transcript || !transcript.trim()) {
      return res.status(422).json({ error: 'No speech detected in the audio file. Please check the recording and try again.' });
    }

    return res.json({ transcript: transcript });

  } catch (e) {
    console.error('Transcription error:', e.message);
    if (e.message.indexOf('ElevenLabs error') > -1) {
      return res.status(502).json({ error: 'Transcription service is currently unavailable. Please try again shortly, or paste your notes as text instead.' });
    }
    return res.status(500).json({ error: 'Transcription failed. Please try again.' });
  }
});

app.post('/generate-pdf', async (req, res) => {
  const { text, clientName, fspName, triggerLabel, adviceDate, brokerToken } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const NAVY = '#1F3B6E';
    const GOLD = '#D4A574';

    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="RoA.pdf"');
      res.send(pdfBuffer);
    });

    const pageWidth = doc.page.width;
    const marginLeft = 45;
    const marginRight = 45;
    const contentWidth = pageWidth - marginLeft - marginRight;

    // ===== HEADER =====
    doc.rect(0, 0, pageWidth, 80).fill(NAVY);
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#FFFFFF').text('RECORD OF ADVICE', 0, 18, { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor(GOLD).text(
      'FAIS & GCoC Compliant  |  ' + (adviceDate || new Date().toLocaleDateString('en-ZA')),
      0, 48, { align: 'center' }
    );

    // ===== LOGO (restored broker logo mapping) =====
    let hasLogo = false;
    try {
      const logoMap = {
        'RIYA-GOMES-001': { file: 'kensten-logo.png', width: 90, height: 45 },
        'RIYA-MARX-001': { file: '1st-insurance-logo.png', width: 100, height: 40 },
        'RIYA-CRAFFORD-0001': { file: 'twk-logo.png', width: 60, height: 60 },
        'RIYA-GROBLER-001': { file: 'galinco-logo.png', width: 110, height: 38 },
        'RIYA-TWK-001': { file: 'twk-logo.png', width: 60, height: 60 },
        'RIYA-APBCO-001': { file: 'apbco-logo.jpg', width: 90, height: 45 }
      };
      const logoConfig = logoMap[brokerToken];
      if (logoConfig) {
        const logoPath = __dirname + '/assets/' + logoConfig.file;
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, pageWidth - marginRight - logoConfig.width, 90, {
            width: logoConfig.width, height: logoConfig.height, fit: [logoConfig.width, logoConfig.height]
          });
          hasLogo = true;
        }
      }
    } catch (logoErr) {
      console.warn('Logo error:', logoErr.message);
    }

    doc.y = hasLogo ? 145 : 95;

    // ===== ROBUST SECTION PARSING =====
    // Apply the same heading-repair used in RoA generation, so any run-on
    // heading (e.g. "DETAILSFinancial...") is split before parsing sections.
    const repaired = forceHeadingLinebreaks(text);
    // Strip any leading whitespace and stray markdown before each line first,
    // so indentation or leftover '#'/'##' never causes a silent zero-match.
    const normalized = repaired
      .split('\n')
      .map(l => l.replace(/^\s+/, '').replace(/^#{1,3}\s*/, ''))
      .join('\n');

    const sections = [];
    const sectionRegex = /(?:^|\n)(\d{1,2})\.\s+([A-Z][^\n]{2,80})/g;
    let match;
    const matches = [];
    while ((match = sectionRegex.exec(normalized)) !== null) {
      matches.push({
        number: match[1],
        title: match[2].trim(),
        index: match.index + (match[0].startsWith('\n') ? 1 : 0)
      });
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
      const headingLine = normalized.slice(start, end).split('\n')[0];
      const content = normalized.slice(start + headingLine.length, end).trim();
      sections.push({ number: matches[i].number, title: matches[i].title, content });
    }

    // Fail-safe: if parsing ever finds zero sections, render the raw text
    // rather than producing a blank body between header and footer.
    if (sections.length === 0) {
      doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(normalized, marginLeft, doc.y, { width: contentWidth });
    }

    // ===== RENDER SECTIONS =====
    for (const section of sections) {
      if (doc.y > doc.page.height - 100) { doc.addPage(); doc.y = 45; }

      const headerY = doc.y;
      doc.rect(0, headerY, pageWidth, 26).fill(NAVY);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(GOLD).text(
        '  ' + section.number + '. ' + section.title.toUpperCase(),
        marginLeft, headerY + 7, { width: contentWidth }
      );
      doc.y = headerY + 34;

      const lines = section.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        if (doc.y > doc.page.height - 60) { doc.addPage(); doc.y = 45; }
        const isBullet = /^[•\-\*]\s+/.test(line);
        const isSubHeading = /^[A-Z][A-Za-z\s&/()-]*:\s*$/.test(line) && line.length < 70;

        if (isSubHeading) {
          doc.moveDown(0.3);
          doc.fontSize(10).font('Helvetica-Bold').fillColor(NAVY).text(line, marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.2);
        } else if (isBullet) {
          doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(line, marginLeft + 12, doc.y, { width: contentWidth - 12 });
          doc.moveDown(0.3);
        } else {
          doc.fontSize(9.5).font('Helvetica').fillColor('#333333').text(line, marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.3);
        }
      }
      doc.moveDown(0.7);
    }

    // ===== FOOTER =====
    if (doc.y > doc.page.height - 60) doc.addPage();
    doc.moveDown(1);
    const footerY = doc.y;
    doc.rect(0, footerY, pageWidth, 30).fill(NAVY);
    doc.fontSize(7.5).font('Helvetica').fillColor(GOLD).text(
      'Generated by Riya  |  Africa Bloom (Pty) Ltd  |  FAIS Act 37/2002  |  BN 80/2003  |  GN 706/2020  |  5-year retention required',
      marginLeft, footerY + 10, { align: 'center', width: contentWidth }
    );

    doc.end();
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/credits', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });
  const broker = await validateBrokerToken(token);
  if (!broker) return res.status(404).json({ error: 'Token not found.' });
  return res.json({ name: broker.name, credits: broker.credits, credits_used: broker.credits_used, status: broker.status, fsp_firm_name: broker.fsp_firm_name || '', fsp_number: broker.fsp_number || '', fsp_address: broker.fsp_address || '', compliance_officer: broker.compliance_officer || '' });
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
    starter: { credits: 20, amount: '100.00', name: 'Riya Starter — 10 RoAs' },
    standard: { credits: 80, amount: '400.00', name: 'Riya Standard — 40 RoAs' },
    pro: { credits: 200, amount: '1000.00', name: 'Riya Pro — 100 RoAs' },
    catchup: { credits: 500, amount: '2500.00', name: 'Riya Catch-Up — 250 RoAs' }
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
  const { payment_status, custom_str1, custom_int1, pf_payment_id } = req.body;

  if (payment_status !== 'COMPLETE') return res.sendStatus(200);

  const token = custom_str1;
  const credits = parseInt(custom_int1 || '0');

  if (!token || !credits) return res.sendStatus(200);

  if (!pf_payment_id) {
    console.error('Webhook missing pf_payment_id - cannot verify idempotency, skipping to avoid duplicate credit risk');
    return res.sendStatus(200);
  }

  try {
    const existing = await supabaseRequest('GET', 'processed_payments?pf_payment_id=eq.' + encodeURIComponent(pf_payment_id) + '&select=id');
    if (existing && existing.length > 0) {
      console.log('Payment ' + pf_payment_id + ' already processed - skipping duplicate webhook call');
      return res.sendStatus(200);
    }

    const broker = await validateBrokerToken(token);
    if (!broker) return res.sendStatus(200);

    await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {
      credits: broker.credits + credits
    });

    await supabaseRequest('POST', 'processed_payments', {
      pf_payment_id: pf_payment_id,
      broker_token: token,
      credits_added: credits
    });

    console.log('Credits added: ' + credits + ' to ' + token + ' (payment ' + pf_payment_id + ')');
  } catch(e) {
    console.error('Webhook error:', e.message);
  }

  return res.sendStatus(200);
});

app.post('/create-token', async (req, res) => {
  const { name, email, token, fsp_number, plan, credits } = req.body;
  if (!name || !email || !token) return res.status(400).json({ error: 'missing fields' });
  try {
    await supabaseRequest('POST', 'brokers', {
      name: name,
      email: email,
      token: token,
      fsp_number: fsp_number || null,
      plan: plan || 'pilot',
      credits: credits || 5,
      credits_used: 0,
      status: 'active'
    });
    await sendWelcomeEmail(name, email, token);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/send-roa-to-broker', async (req, res) => {
  try {
    const { roaContent, brokerToken, clientName, brokerName } = req.body;
    if (!roaContent || !brokerToken || !clientName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: broker, error: brokerError } = await supabase
      .from('brokers')
      .select('email, name')
      .eq('token', brokerToken)
      .single();

    if (brokerError || !broker) {
      return res.status(400).json({ error: 'Invalid broker token' });
    }

    const brokerEmail = broker.email;
    const resolvedBrokerName = brokerName || broker.name || 'Adviser';

    const result = await sendRoAEmail(brokerEmail, clientName, resolvedBrokerName, roaContent, brokerToken);
    if (result.success) {
      return res.status(200).json({ success: true, sentTo: brokerEmail });
    } else {
      return res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/extract-pdf', async (req, res) => {
  try {
    const { fileBase64, fileType, fileName } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'No file provided' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    if (fileType && (fileType.includes('wordprocessingml') || (fileName && fileName.toLowerCase().endsWith('.docx')))) {
      const mammoth = require('mammoth');
      const buffer = Buffer.from(fileBase64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      return res.json({ text: result.value });
    }

    if (fileType && (fileType.includes('text/') || (fileName && (fileName.toLowerCase().endsWith('.txt') || fileName.toLowerCase().endsWith('.csv'))))) {
      const decoded = Buffer.from(fileBase64, 'base64').toString('utf-8');
      return res.json({ text: decoded });
    }

    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 }
          },
          {
            type: 'text',
            text: 'Extract all text content from this insurance document. Return the extracted information as structured plain text.'
          }
        ]
      }]
    });

    const result = await new Promise((resolve, reject) => {
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

      const req = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (response.statusCode !== 200) {
              reject(new Error(parsed.error && parsed.error.message || 'API error'));
            } else {
              const text = parsed.content && parsed.content.map(b => b.text || '').join('') || '';
              resolve(text);
            }
          } catch(e) {
            reject(new Error('Parse error: ' + e.message));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    return res.json({ text: result });

  } catch(err) {
    console.error('PDF extraction error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/save-draft', async (req, res) => {
  const { token, draftId, clientLabel, formData } = req.body;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  if (!clientLabel || !formData) return res.status(400).json({ error: 'clientLabel and formData are required.' });
  try {
    if (draftId) {
      await supabaseRequest('PATCH', 'roa_drafts?id=eq.' + encodeURIComponent(draftId) + '&broker_token=eq.' + encodeURIComponent(token), {
        client_label: clientLabel,
        form_data: formData,
        updated_at: new Date().toISOString()
      });
      return res.json({ success: true, id: draftId });
    } else {
      const created = await supabaseRequest('POST', 'roa_drafts', {
        broker_token: token,
        client_label: clientLabel,
        form_data: formData
      });
      const newId = created && created[0] && created[0].id;
      return res.json({ success: true, id: newId });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/list-drafts', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required.' });
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest('DELETE', 'roa_drafts?broker_token=eq.' + encodeURIComponent(token) + '&updated_at=lt.' + encodeURIComponent(cutoff));
    const drafts = await supabaseRequest('GET', 'roa_drafts?broker_token=eq.' + encodeURIComponent(token) + '&select=id,client_label,updated_at&order=updated_at.desc');
    return res.json({ drafts: drafts || [] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/load-draft', async (req, res) => {
  const { token, id } = req.query;
  if (!token || !id) return res.status(400).json({ error: 'Token and id required.' });
  try {
    const result = await supabaseRequest('GET', 'roa_drafts?id=eq.' + encodeURIComponent(id) + '&broker_token=eq.' + encodeURIComponent(token) + '&select=*');
    if (!result || !result.length) return res.status(404).json({ error: 'Draft not found.' });
    return res.json({ draft: result[0] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.delete('/delete-draft', async (req, res) => {
  const { token, id } = req.query;
  if (!token || !id) return res.status(400).json({ error: 'Token and id required.' });
  try {
    await supabaseRequest('DELETE', 'roa_drafts?id=eq.' + encodeURIComponent(id) + '&broker_token=eq.' + encodeURIComponent(token));
    return res.json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Riya backend listening on port ' + PORT));
