const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

const oldLine = `    doc.font('Bold').fontSize(18).fillColor('#1F4E5F').text('Record of Advice', { align: 'left' });`;

const newLine = `    // Add broker logo if available (top-right corner)
    try {
      const brokerToken = req.body.brokerToken || '';
      const logoPath = __dirname + '/assets/kensten-logo.png';
      if (brokerToken === 'RIYA-GOMES-001' && fs.existsSync(logoPath)) {
        doc.image(logoPath, 430, 30, { width: 110, height: 80, fit: [110, 80] });
      }
    } catch(logoErr) {
      console.warn('Logo error:', logoErr.message);
    }
    doc.font('Bold').fontSize(18).fillColor('#1F4E5F').text('Record of Advice', { align: 'left' });`;

if (h.includes(oldLine)) {
  h = h.replace(oldLine, newLine);
  console.log('✓ Kensten logo added to PDF generation');
} else {
  console.log('✗ Could not find target line');
}

fs.writeFileSync('index.js', h, 'utf8');