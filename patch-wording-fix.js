const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const broken = "each phrased as 'Not confirmed in your input: [the specific detail]' rather than using the word invented or fabricated";
const fixed = "each phrased as Not confirmed in your input - followed by the specific detail - rather than using the word invented or fabricated";

if (!content.includes(broken)) {
  console.log('ERROR: broken text not found.');
} else {
  content = content.replace(broken, fixed);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: quote issue fixed.');
}