const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

const newEndpoint = `
// PDF extraction endpoint - handles large PDFs with longer timeout
app.post('/extract-pdf', async (req, res) => {
  try {
    const { fileBase64, fileType, fileName } = req.body;
    if (!fileBase64) return res.status(400).json({ error: 'No file provided' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    // Handle DOCX files
    if (fileType && (fileType.includes('wordprocessingml') || (fileName && fileName.toLowerCase().endsWith('.docx')))) {
      const mammoth = require('mammoth');
      const buffer = Buffer.from(fileBase64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      return res.json({ text: result.value });
    }

    // Handle plain text files
    if (fileType && (fileType.includes('text/') || (fileName && (fileName.toLowerCase().endsWith('.txt') || fileName.toLowerCase().endsWith('.csv'))))) {
      const decoded = Buffer.from(fileBase64, 'base64').toString('utf-8');
      return res.json({ text: decoded });
    }

    // Handle PDF via Claude API
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
            text: 'Extract all text content from this insurance document. Focus on: client name, ID number, contact details, address, policy number, insurer, vehicles (make, model, year, registration, sum insured, premium, excess, driver, finance), household contents (sum insured, premium, excess, address), all-risk (sum insured, premium), personal liability (limit, premium), total premium, broker details, FSP number, inception date, renewal date. Return the extracted information as structured plain text.'
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
          'anthropic-beta': 'pdfs-2024-09-25',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = require('https').request(options, (response) => {
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
`;

// Add before app.listen
h = h.replace(
  'app.listen(PORT',
  newEndpoint + '\napp.listen(PORT'
);

fs.writeFileSync('index.js', h, 'utf8');
console.log('✓ Railway PDF extraction endpoint added');