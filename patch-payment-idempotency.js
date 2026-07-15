const fs = require('fs');

const filePath = 'index.js';
let content = fs.readFileSync(filePath, 'utf8');

const oldWebhook = "app.post('/payfast-webhook', async (req, res) => {\n  const { payment_status, custom_str1, custom_int1 } = req.body;\n\n  if (payment_status !== 'COMPLETE') return res.sendStatus(200);\n\n  const token = custom_str1;\n  const credits = parseInt(custom_int1 || '0');\n\n  if (!token || !credits) return res.sendStatus(200);\n\n  try {\n    const broker = await validateBrokerToken(token);\n    if (!broker) return res.sendStatus(200);\n\n    await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {\n      credits: broker.credits + credits\n    });\n\n    console.log('Credits added: ' + credits + ' to ' + token);\n  } catch(e) {\n    console.error('Webhook error:', e.message);\n  }\n\n  return res.sendStatus(200);\n});";

const newWebhook = "app.post('/payfast-webhook', async (req, res) => {\n  const { payment_status, custom_str1, custom_int1, pf_payment_id } = req.body;\n\n  if (payment_status !== 'COMPLETE') return res.sendStatus(200);\n\n  const token = custom_str1;\n  const credits = parseInt(custom_int1 || '0');\n\n  if (!token || !credits) return res.sendStatus(200);\n\n  if (!pf_payment_id) {\n    console.error('Webhook missing pf_payment_id - cannot verify idempotency, skipping to avoid duplicate credit risk');\n    return res.sendStatus(200);\n  }\n\n  try {\n    // Check if this exact payment has already been processed\n    const existing = await supabaseRequest('GET', 'processed_payments?pf_payment_id=eq.' + encodeURIComponent(pf_payment_id) + '&select=id');\n    if (existing && existing.length > 0) {\n      console.log('Payment ' + pf_payment_id + ' already processed - skipping duplicate webhook call');\n      return res.sendStatus(200);\n    }\n\n    const broker = await validateBrokerToken(token);\n    if (!broker) return res.sendStatus(200);\n\n    await supabaseRequest('PATCH', 'brokers?token=eq.' + encodeURIComponent(token), {\n      credits: broker.credits + credits\n    });\n\n    await supabaseRequest('POST', 'processed_payments', {\n      pf_payment_id: pf_payment_id,\n      broker_token: token,\n      credits_added: credits\n    });\n\n    console.log('Credits added: ' + credits + ' to ' + token + ' (payment ' + pf_payment_id + ')');\n  } catch(e) {\n    console.error('Webhook error:', e.message);\n  }\n\n  return res.sendStatus(200);\n});";

if (!content.includes(oldWebhook)) {
  console.log('ERROR: Could not find the exact old webhook text. No changes made.');
  process.exit(1);
}

const occurrences = content.split(oldWebhook).length - 1;
if (occurrences > 1) {
  console.log('ERROR: Found ' + occurrences + ' matches, expected exactly 1. Aborting.');
  process.exit(1);
}

content = content.replace(oldWebhook, newWebhook);
fs.writeFileSync(filePath, content, 'utf8');
console.log('SUCCESS: payment idempotency check added.');