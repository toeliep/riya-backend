const https = require('https');

// PASTE YOUR SUPABASE_SERVICE_KEY BELOW, BETWEEN THE QUOTES
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1bmlodmd4dHFiamp1dm5ycG9mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ5NTA4MCwiZXhwIjoyMDk3MDcxMDgwfQ.GE__xUKTNP3uOQ7WirQgBzAdtIzysSdylnpGd7rnQys';

const SUPABASE_URL = 'sunihvgxtqbjjuvnrpof.supabase.co';

const sql = `
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS fsp_firm_name TEXT;
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS fsp_address TEXT;
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS compliance_officer TEXT;
`;

const payload = JSON.stringify({ query: sql });

const options = {
  hostname: SUPABASE_URL,
  path: '/rest/v1/rpc/exec_sql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});
req.on('error', e => console.error('Error:', e.message));
req.write(payload);
req.end();