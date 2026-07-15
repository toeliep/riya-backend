const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

const oldEndpoint = `app.post('/send-roa-to-broker', async (req, res) => {
  try {
    const { roaContent, brokerEmail, clientName, brokerName } = req.body;
    if (!roaContent || !brokerEmail || !clientName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await sendRoAEmail(brokerEmail, clientName, brokerName, roaContent);
    if (result.success) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
});`;

const newEndpoint = `app.post('/send-roa-to-broker', async (req, res) => {
  try {
    const { roaContent, brokerToken, clientName, brokerName } = req.body;
    if (!roaContent || !brokerToken || !clientName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Look up broker email from Supabase using token
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: broker, error: brokerError } = await supabase
      .from('brokers')
      .select('email, name')
      .eq('token', brokerToken)
      .single();

    if (brokerError || !broker) {
      return res.status(400).json({ error: 'Invalid broker token' });
    }

    const brokerEmail = broker.email;
    const resolvedBrokerName = brokerName || broker.name || 'Adviser';

    const result = await sendRoAEmail(brokerEmail, clientName, resolvedBrokerName, roaContent);
    if (result.success) {
      return res.status(200).json({ success: true, sentTo: brokerEmail });
    } else {
      return res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
});`;

if (h.includes(oldEndpoint)) {
  h = h.replace(oldEndpoint, newEndpoint);
  console.log('✓ Backend endpoint updated to look up broker email from Supabase');
} else {
  console.log('✗ Could not find old endpoint - check manually');
}

fs.writeFileSync('index.js', h, 'utf8');