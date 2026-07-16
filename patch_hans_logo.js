const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

// Add 1st Insurance logo alongside Kensten logo
const oldLogo = `      const brokerToken = req.body.brokerToken || '';
      const logoPath = __dirname + '/assets/kensten-logo.png';
      if (brokerToken === 'RIYA-GOMES-001' && fs.existsSync(logoPath)) {
        doc.image(logoPath, 430, 30, { width: 110, height: 80, fit: [110, 80] });
      }`;

const newLogo = `      const brokerToken = req.body.brokerToken || '';
      const logoMap = {
        'RIYA-GOMES-001': { file: 'kensten-logo.png', width: 110, height: 80 },
        'RIYA-MARX-001': { file: '1st-insurance-logo.png', width: 130, height: 50 }
      };
      const logoConfig = logoMap[brokerToken];
      if (logoConfig) {
        const logoPath = __dirname + '/assets/' + logoConfig.file;
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 430, 30, { width: logoConfig.width, height: logoConfig.height, fit: [logoConfig.width, logoConfig.height] });
        }
      }`;

if (h.includes(oldLogo)) {
  h = h.replace(oldLogo, newLogo);
  console.log('✓ Hans logo added to PDF generation');
} else {
  console.log('✗ Could not find old logo section');
}

fs.writeFileSync('index.js', h, 'utf8');