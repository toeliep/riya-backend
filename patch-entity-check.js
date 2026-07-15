const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const oldText = "List ONLY specific facts in the GENERATED DOCUMENT that do NOT appear anywhere in the BROKER INPUT above - this includes invented insurer ratings, complaint counts, claims timeframes, specific sums insured not stated by the broker, fabricated conflict-of-interest scenarios, or any invented dates/numbers/names.";

const newText = "List ONLY specific facts in the GENERATED DOCUMENT that do NOT appear anywhere in the BROKER INPUT above. Check CAREFULLY for: any insurer, company, or institution name mentioned in the document that does NOT appear in the broker input at all - this is the most serious issue, flag the entire fabricated company by name; invented insurer ratings, complaint counts, claims timeframes; specific sums insured not stated by the broker; fabricated conflict-of-interest scenarios; any invented dates, numbers, or names.";

if (!content.includes(oldText)) {
  console.log('ERROR: anchor not found.');
} else {
  content = content.replace(oldText, newText);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: entity check added.');
}