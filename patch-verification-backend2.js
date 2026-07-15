const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const anchorLine = "const combined = (part1 + '\\n\\n---\\n\\n' + part2 + '\\n\\n---\\n\\n' + part3).trim();";

const verificationBlock = "\n\n    let warnings = [];\n    try {\n      const verifyPrompt = 'BROKER INPUT:\\n' + user + '\\n\\nGENERATED DOCUMENT:\\n' + combined + '\\n\\nList ONLY specific facts in the GENERATED DOCUMENT that do NOT appear anywhere in the BROKER INPUT above - this includes invented insurer ratings, complaint counts, claims timeframes, specific sums insured not stated by the broker, fabricated conflict-of-interest scenarios, or any invented dates/numbers/names. Return ONLY a JSON array of short strings describing each issue. If nothing is fabricated, return exactly: []';\n      const verifyResult = await callClaude(apiKey, 'You are a strict fact-checker. Output ONLY a raw JSON array, nothing else.', verifyPrompt, 800);\n      const cleaned = verifyResult.trim().replace(/^```json\\s*/i, '').replace(/```\\s*$/i, '');\n      warnings = JSON.parse(cleaned);\n      if (!Array.isArray(warnings)) warnings = [];\n    } catch(e) { warnings = []; }";

if (!content.includes(anchorLine)) {
  console.log('ERROR: combined-line anchor not found, no changes made.');
} else {
  content = content.replace(anchorLine, anchorLine + verificationBlock);

  const oldReturn = "return res.json({ content: [{ type: 'text', text: combined }] });";
  if (!content.includes(oldReturn)) {
    console.log('WARNING: return-line anchor not found, warnings field NOT added to response. Verification logic was still inserted.');
  } else {
    content = content.replace(oldReturn, "return res.json({ content: [{ type: 'text', text: combined }], warnings: warnings });");
    console.log('Return line updated to include warnings.');
  }

  fs.writeFileSync(path, content);
  console.log('SUCCESS: file saved.');
}