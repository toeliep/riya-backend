const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const anchor = "    const combined = (part1 + '\\n\\n---\\n\\n' + part2 + '\\n\\n---\\n\\n' + part3).trim();\n\n    if (broker) {";

const replacement = "    const combined = (part1 + '\\n\\n---\\n\\n' + part2 + '\\n\\n---\\n\\n' + part3).trim();\n\n    let warnings = [];\n    try {\n      const verifyPrompt = 'BROKER INPUT:\\n' + user + '\\n\\nGENERATED DOCUMENT:\\n' + combined + '\\n\\nList ONLY specific facts in the GENERATED DOCUMENT that do NOT appear anywhere in the BROKER INPUT above - this includes invented insurer ratings, complaint counts, claims timeframes, specific sums insured not stated by the broker, fabricated conflict-of-interest scenarios, or any invented dates/numbers/names. Return ONLY a JSON array of short strings describing each issue, e.g. [\\\"King Price complaint statistics not in broker input\\\", \\\"Conflict scenarios invented despite broker stating None\\\"]. If nothing is fabricated, return exactly: []';\n      const verifyResult = await callClaude(apiKey, 'You are a strict fact-checker. Output ONLY a raw JSON array, nothing else.', verifyPrompt, 800);\n      const cleaned = verifyResult.trim().replace(/^```json\\s*/i, '').replace(/```\\s*$/i, '');\n      warnings = JSON.parse(cleaned);\n      if (!Array.isArray(warnings)) warnings = [];\n    } catch(e) { warnings = []; }\n\n    if (broker) {";

if (!content.includes(anchor)) {
  console.log('ERROR: anchor not found, no changes made.');
} else {
  content = content.replace(anchor, replacement);
  content = content.replace(
    "return res.json({ content: [{ type: 'text', text: combined }] });",
    "return res.json({ content: [{ type: 'text', text: combined }], warnings: warnings });"
  );
  fs.writeFileSync(path, content);
  console.log('SUCCESS: verification step inserted into riya-backend.');
}