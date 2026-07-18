const fs = require('fs');
const path = 'index.js';
const backupPath = 'index.js.bak-' + Date.now();

const original = fs.readFileSync(path, 'utf8');
const usesCRLF = original.includes('\r\n');
let content = original.replace(/\r\n/g, '\n');

const oldBlock = `if (mode === 'sufficiency') {
const triggerEvent = req.body.triggerEvent;
const linesOfBusiness = req.body.linesOfBusiness;
const sufficiencyPrompt = 'Trigger Event: ' + (triggerEvent || 'New Policy') + '\nLines of Business: ' + (linesOfBusiness || 'Personal') + '\n\nBroker input:\n' + user;
const result2 = await callClaude(apiKey, SYSTEM_SUFFICIENCY, sufficiencyPrompt, 1000);
const cleaned2 = result2.trim().replace(/^\`\`\`json\s*/i, '').replace(/\`\`\`\s*$/i, '');
let gaps = [];
try { gaps = JSON.parse(cleaned2); if (!Array.isArray(gaps)) gaps = []; } catch(e) { gaps = []; }
return res.json({ gaps: gaps });
}`;

const newBlock = `if (mode === 'sufficiency') {
const triggerEvent = req.body.triggerEvent;
const linesOfBusiness = req.body.linesOfBusiness;
const sufficiencyPrompt = 'Trigger Event: ' + (triggerEvent || 'New Policy') + '\nLines of Business: ' + (linesOfBusiness || 'Personal') + '\n\nBroker input:\n' + user;
const result2 = await callClaude(apiKey, SYSTEM_SUFFICIENCY, sufficiencyPrompt, 1000);
const cleaned2 = result2.trim().replace(/^\`\`\`json\s*/i, '').replace(/\`\`\`\s*$/i, '');
let gaps = [];
try { gaps = JSON.parse(cleaned2); if (!Array.isArray(gaps)) gaps = []; } catch(e) { gaps = []; }
const gapCategoryRules = [
  ['market_comparison', /market comparison|comparative quote|other insurer|re-?market/i],
  ['kyc_fica_popia', /\bkyc\b|\bfica\b|\bpopia\b|proof of address|id verified|consent/i],
  ['bi_financials', /business interruption|gross profit|\bbi\b.*(sum insured|financial)/i],
  ['liability_limit', /liability limit|employers liability|public liability/i],
  ['premium_confirmation', /renewal premium|premium.*(confirm|accept|agreed|figure|pay)/i],
  ['risk_profile_change', /risk profile/i],
  ['replacement_advice', /replacement/i],
  ['excess_structure', /excess/i],
  ['renewal_reference', /policy number|policy reference/i],
  ['sum_insured', /sum insured/i],
  ['git_cover', /goods in transit|\bgit\b/i]
];
const gapCategories = Array.from(new Set(gaps.map(function(g) {
  for (var i = 0; i < gapCategoryRules.length; i++) {
    if (gapCategoryRules[i][1].test(g)) return gapCategoryRules[i][0];
  }
  return 'other';
})));
console.log('SUFFICIENCY metrics: token=' + (token || 'unknown') + ' trigger=' + (triggerEvent || 'unknown') + ' lines=' + (linesOfBusiness || 'unknown') + ' gapCount=' + gaps.length + ' categories=' + gapCategories.join(','));
return res.json({ gaps: gaps });
}`;

if (content.indexOf(oldBlock) === -1) {
  console.log('PATCH FAILED: exact old block not found in index.js. No changes made.');
  process.exit(1);
}

content = content.split(oldBlock).join(newBlock);
if (usesCRLF) content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(backupPath, original, 'utf8');
fs.writeFileSync(path, content, 'utf8');
console.log('Gap-category diagnostic logging added. Backup saved as: ' + backupPath);
