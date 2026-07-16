const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');

// Replace Netlify PDF extraction with Railway
h = h.replace(
  "const res = await fetch('/.netlify/functions/extract-text', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ fileBase64: base64, fileType: 'application/pdf', fileName: uploadedFileName })\n      });",
  "const res = await fetch('https://riya-backend-production.up.railway.app/extract-pdf', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ fileBase64: base64, fileType: 'application/pdf', fileName: uploadedFileName })\n      });"
);

// Replace Netlify DOCX extraction with Railway
h = h.replace(
  "const res = await fetch('/.netlify/functions/extract-text', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ fileBase64: base64, fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: uploadedFileName })\n      });",
  "const res = await fetch('https://riya-backend-production.up.railway.app/extract-pdf', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ fileBase64: base64, fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: uploadedFileName })\n      });"
);

if (h.includes('riya-backend-production.up.railway.app/extract-pdf')) {
  console.log('✓ Frontend PDF extraction now routes to Railway');
} else {
  console.log('✗ Could not find extraction calls - check manually');
}

fs.writeFileSync('index.html', h, 'utf8');