// NEW /generate-pdf endpoint — agreement style (no banners)
// Replace the entire app.post('/generate-pdf', ...) block in index.js with this

app.post('/generate-pdf', async (req, res) => {
  const { text, clientName, fspName, triggerLabel, adviceDate, brokerToken } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const NAVY = '#1B2A4A';
    const GOLD = '#C9A84C';
    const DARK = '#333333';

    const doc = new PDFDocument({ margin: 60, size: 'A4', info: { Title: 'Record of Advice', Author: 'Riya' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="RoA-' + (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '') + '.pdf"');
      res.send(pdfBuffer);
    });

    const pageWidth = doc.page.width;
    const marginLeft = 60;
    const marginRight = 60;
    const contentWidth = pageWidth - marginLeft - marginRight;

    // ===== HEADER — right-aligned, agreement style =====
    doc.fontSize(13).font('Helvetica-Bold').fillColor(NAVY)
      .text('AFRICA BLOOM (PTY) LTD  |  T/A RIYA', marginLeft, 40, { width: contentWidth, align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor(GOLD)
      .text('toelie@riya.co.za  |  www.riya.co.za', marginLeft, 56, { width: contentWidth, align: 'right' });

    // Gold header rule
    doc.moveTo(marginLeft, 72).lineTo(pageWidth - marginRight, 72).strokeColor(GOLD).lineWidth(1.5).stroke();

    // ===== LOGO — top right, below header rule =====
    let logoBottom = 85;
    try {
      const logoMap = {
        'RIYA-GOMES-001': { file: 'kensten-logo.png', width: 90, height: 45 },
        'RIYA-MARX-001': { file: '1st-insurance-logo.png', width: 100, height: 40 },
        'RIYA-CRAFFORD-0001': { file: 'twk-logo.png', width: 60, height: 60 },
        'RIYA-GROBLER-001': { file: 'galinco-logo.png', width: 110, height: 38 },
        'RIYA-TWK-001': { file: 'twk-logo.png', width: 60, height: 60 },
        'RIYA-APBCO-001': { file: 'apbco-logo.jpg', width: 90, height: 45 },
        'RIYA-LIBRA-001': { file: 'Libra-Brokers-Logo.png', width: 90, height: 60 },
        'RIYA-BUXMAN-001': { file: 'million-bux-logo.png', width: 120, height: 44 }
      };
      const logoConfig = logoMap[brokerToken];
      if (logoConfig) {
        const logoPath = __dirname + '/assets/' + logoConfig.file;
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, pageWidth - marginRight - logoConfig.width, 80, {
            width: logoConfig.width, height: logoConfig.height, fit: [logoConfig.width, logoConfig.height]
          });
          logoBottom = 80 + logoConfig.height + 10;
        }
      }
    } catch (logoErr) { console.warn('Logo error:', logoErr.message); }

    // ===== TITLE =====
    doc.y = Math.max(logoBottom, 85);
    doc.fontSize(20).font('Helvetica-Bold').fillColor(NAVY)
      .text('RECORD OF ADVICE', marginLeft, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.3);

    const triggerBadge = triggerLabel || 'Record of Advice';
    const dateStr = adviceDate || new Date().toLocaleDateString('en-ZA');
    doc.fontSize(10).font('Helvetica').fillColor(GOLD)
      .text(triggerBadge + '  |  ' + (fspName || '') + (fspName ? '  |  ' : '') + dateStr,
        marginLeft, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.8);

    // Second gold rule
    doc.moveTo(marginLeft, doc.y).lineTo(pageWidth - marginRight, doc.y).strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.moveDown(1);

    // ===== PARSE SECTIONS =====
    const normalized = forceHeadingLinebreaks(text)
      .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .split('\n')
      .map(l => l.replace(/^\s+/, '').replace(/^#{1,3}\s*/, ''))
      .join('\n');

    const sectionRegex = /(?:^|\n)([1-9]|1[0-2])\.\s+((?:FSP|CLIENT|NEEDS|MARKET|PRODUCT|REMUNERATION|REPLACEMENT|CLIENT ACCEPTANCE|FSP AND|KLIENT|BEHOEFTE|MARK|AANBEVOLE|VERGOEDING|VERVANG)[^\n]{0,80})/g;
    let match;
    const matches = [];
    while ((match = sectionRegex.exec(normalized)) !== null) {
      matches.push({ number: match[1], title: match[2].trim(), index: match.index + (match[0].startsWith('\n') ? 1 : 0) });
    }

    const sections = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
      const headingLine = normalized.slice(start, end).split('\n')[0];
      const content = normalized.slice(start + headingLine.length, end).trim();
      sections.push({ number: matches[i].number, title: matches[i].title, content });
    }

    if (sections.length === 0) {
      doc.fontSize(9.5).font('Helvetica').fillColor(DARK).text(normalized, marginLeft, doc.y, { width: contentWidth });
    }

    // ===== RENDER SECTIONS =====
    for (const section of sections) {
      if (doc.y > doc.page.height - 120) { doc.addPage(); doc.y = 60; }

      // Section heading — navy bold + gold underline
      doc.fontSize(11).font('Helvetica-Bold').fillColor(NAVY)
        .text(section.number + '.   ' + section.title.toUpperCase(), marginLeft, doc.y, { width: contentWidth });
      doc.moveTo(marginLeft, doc.y).lineTo(pageWidth - marginRight, doc.y).strokeColor(GOLD).lineWidth(1).stroke();
      doc.moveDown(0.6);

      // Content lines
      const lines = section.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) { doc.moveDown(0.35); continue; }
        if (doc.y > doc.page.height - 80) { doc.addPage(); doc.y = 60; }

        const isBullet = /^[•\u2022\-\*]\s*/.test(trimmed);
        const isSubHeading = !isBullet && trimmed.endsWith(':') && trimmed.length < 70;
        const isSignatureLine = /^(Client Signature|Client Name|Adviser Signature|Adviser Name|Date):/.test(trimmed);

        if (isSubHeading) {
          doc.moveDown(0.3);
          doc.fontSize(9.5).font('Helvetica-Bold').fillColor(NAVY).text(trimmed, marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.3);
        } else if (isBullet) {
          const bulletText = trimmed.replace(/^[•\u2022\-\*]\s*/, '');
          doc.fontSize(9.5).font('Helvetica').fillColor(DARK)
            .text('\u2022  ' + bulletText, marginLeft + 16, doc.y, { width: contentWidth - 16 });
          doc.moveDown(0.35);
        } else if (isSignatureLine) {
          doc.moveDown(0.4);
          doc.fontSize(9.5).font('Helvetica').fillColor(DARK).text(trimmed, marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.8);
        } else {
          doc.fontSize(9.5).font('Helvetica').fillColor(DARK).text(trimmed, marginLeft, doc.y, { width: contentWidth });
          doc.moveDown(0.4);
        }
      }

      doc.moveDown(0.6);
      doc.moveTo(marginLeft, doc.y).lineTo(pageWidth - marginRight, doc.y).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
      doc.moveDown(0.8);
    }

    // ===== FOOTER =====
    if (doc.y > doc.page.height - 60) doc.addPage();
    doc.moveDown(0.5);
    doc.moveTo(marginLeft, doc.y).lineTo(pageWidth - marginRight, doc.y).strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.moveDown(0.4);
    doc.fontSize(7.5).font('Helvetica').fillColor(GOLD)
      .text('Riya — Africa Bloom (Pty) Ltd  |  toelie@riya.co.za  |  POPIA Compliant  |  FAIS Act 37/2002  |  BN 80/2003  |  GN 706/2020  |  5-year retention required',
        marginLeft, doc.y, { width: contentWidth, align: 'center' });

    doc.end();
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
