const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const oldPrompt = "Return ONLY a JSON array of short strings describing each issue. If nothing is fabricated, return exactly: []";
const newPrompt = "Return ONLY a JSON array of short strings, each phrased as 'Not confirmed in your input: [the specific detail]' rather than using the word invented or fabricated. If nothing is unconfirmed, return exactly: []";

if (!content.includes(oldPrompt)) {
  console.log('ERROR: prompt anchor not found.');
} else {
  content = content.replace(oldPrompt, newPrompt);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: wording updated.');
}