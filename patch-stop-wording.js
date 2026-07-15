
const fs = require('fs');

const filePath = 'index.js';
let content = fs.readFileSync(filePath, 'utf8');

let replacements = 0;

const old1 = "2. Client Identification, KYC, FICA and POPIA. STOP HERE.";
const new1 = "2. Client Identification, KYC, FICA and POPIA. Do not write anything beyond section 2 - end your response immediately after completing it, with no additional text or commentary.";

const old2 = "Do NOT invent insurer names, premiums, or a comparison that was not actually provided. STOP HERE.";
const new2 = "Do NOT invent insurer names, premiums, or a comparison that was not actually provided. Do not write anything beyond section 4 - end your response immediately after completing it, with no additional text or commentary.";

if (content.includes(old1)) {
  content = content.replace(old1, new1);
  replacements++;
  console.log('Replaced section 1-2 stop instruction');
} else {
  console.log('WARNING: section 1-2 stop instruction not found exactly as expected');
}

if (content.includes(old2)) {
  content = content.replace(old2, new2);
  replacements++;
  console.log('Replaced section 3-4 stop instruction');
} else {
  console.log('WARNING: section 3-4 stop instruction not found exactly as expected');
}

if (replacements === 2) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESS: both instructions updated and saved.');
} else {
  console.log('ABORTED: did not find exactly 2 matches (found ' + replacements + '). No changes saved.');
}