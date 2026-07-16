const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

const oldMap = `      const logoMap = {
        'RIYA-GOMES-001': { file: 'kensten-logo.png', width: 110, height: 80 },
        'RIYA-MARX-001': { file: '1st-insurance-logo.png', width: 130, height: 50 }
      };`;

const newMap = `      const logoMap = {
        'RIYA-GOMES-001': { file: 'kensten-logo.png', width: 110, height: 80 },
        'RIYA-MARX-001': { file: '1st-insurance-logo.png', width: 130, height: 50 },
        'RIYA-CRAFFORD-0001': { file: 'twk-logo.png', width: 80, height: 80 }
      };`;

if (h.includes(oldMap)) {
  h = h.replace(oldMap, newMap);
  console.log('✓ TWK logo added to PDF generation');
} else {
  console.log('✗ Could not find logo map');
}

fs.writeFileSync('index.js', h, 'utf8');