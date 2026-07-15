const fs = require('fs');
const path = 'index.js';
let content = fs.readFileSync(path, 'utf8');

const oldLine = "app.use(express.json());";
const newLine = "app.use(express.json());\napp.use(express.urlencoded({ extended: true }));";

if (!content.includes(oldLine)) {
  console.log('ERROR: anchor not found.');
} else {
  content = content.replace(oldLine, newLine);
  fs.writeFileSync(path, content);
  console.log('SUCCESS: urlencoded body parser added.');
}