const { Resend } = require('resend');
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendWelcomeEmail(n, e, t) {
  try {
    await getResend().emails.send({
      from: 'Riya <hello@riya.co.za>',
      to: e,
      subject: 'Welcome to Riya — Your Broker Token',
      html: '<div style="margin:0;padding:40px 20px;background:#f4f4f4;font-family:Arial,sans-serif;"><div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"><div style="background:#1F4E5F;padding:28px 32px;"><div style="color:#D4AF37;font-size:26px;font-weight:bold;letter-spacing:1px;">RIYA</div><div style="color:#ffffff;font-size:13px;font-style:italic;margin-top:4px;opacity:0.9;">An RoA that checks its own homework.</div></div><div style="padding:32px;"><p style="font-size:15px;color:#1A1A1A;line-height:1.6;margin-top:0;">Dear ' + n + '</p><p style="font-size:15px;color:#1A1A1A;line-height:1.6;">Welcome to Riya. You are now set up with <strong>5 free Records of Advice</strong> to try it for yourself.</p><div style="background:#F7F5EF;border:1px solid #E0DCC8;border-radius:6px;padding:18px 20px;margin:24px 0;text-align:center;"><div style="font-size:11px;color:#595959;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Broker Token</div><div style="font-size:22px;font-weight:bold;color:#1F4E5F;font-family:Courier New,monospace;">' + t + '</div></div><div style="text-align:center;margin:28px 0;"><a href="https://riya-pilot.netlify.app" style="background:#1F4E5F;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:4px;font-size:14px;font-weight:bold;display:inline-block;">Open Riya and Enter Your Token</a></div><p style="font-size:13px;color:#595959;line-height:1.6;">After your free credits: R10 for personal lines, R15 for commercial, per RoA, no subscription.</p><hr style="border:none;border-top:1px solid #E5E5E5;margin:28px 0;"><p style="font-size:14px;color:#1A1A1A;line-height:1.6;">Toelie Pienaar<br><a href="tel:0833258672" style="color:#1F4E5F;text-decoration:none;">083 325 8672</a></p></div><div style="background:#FAFAFA;padding:16px 32px;border-top:1px solid #EEEEEE;"><div style="font-size:11px;color:#999999;">Africa Bloom (Pty) Ltd</div></div></div></div>'
    });
    console.log('Welcome email sent to:', e);
  } catch(err) {
    console.error('Welcome email failed:', err.message);
  }
}

async function sendRoAEmail(brokerEmail, clientName, brokerName, roaContent) {
  try {
    const wordDoc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'RECORD OF ADVICE', bold: true, size: 28 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Client: ' + clientName, bold: true })],
            spacing: { after: 100 }
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Generated: ' + new Date().toLocaleDateString() })],
            spacing: { after: 300 }
          }),
          new Paragraph({
            children: [new TextRun({ text: roaContent })],
            spacing: { after: 100 }
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(wordDoc);
    const base64Content = buffer.toString('base64');

    await getResend().emails.send({
      from: 'Riya <hello@riya.co.za>',
      to: brokerEmail,
      subject: 'Record of Advice — ' + clientName + ' ' + new Date().toLocaleDateString(),
      html: '<p>Hi ' + (brokerName || 'Adviser') + ',</p><p>Please find attached your Record of Advice for <strong>' + clientName + '</strong>.</p><p>Review and edit as needed before sending to your client.</p><p>Regards,<br/>Riya</p>',
      attachments: [{
        filename: clientName.replace(/\s+/g, '_') + '_RoA.docx',
        content: base64Content
      }]
    });

    console.log('RoA email sent to:', brokerEmail);
    return { success: true };
  } catch(err) {
    console.error('RoA email failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendWelcomeEmail, sendRoAEmail };