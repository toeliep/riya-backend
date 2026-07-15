const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

code = code.replace(
  "starter:  { credits: 50,  amount: '20.00',  name: 'Riya Starter — 50 RoAs' },\n    standard: { credits: 200, amount: '80.00',  name: 'Riya Standard — 200 RoAs' },\n    pro:      { credits: 500, amount: '200.00', name: 'Riya Pro — 500 RoAs' }",
  "starter:  { credits: 50,   amount: '20.00',  name: 'Riya Starter — 50 RoAs' },\n    standard: { credits: 200,  amount: '80.00',  name: 'Riya Standard — 200 RoAs' },\n    pro:      { credits: 500,  amount: '200.00', name: 'Riya Pro — 500 RoAs' },\n    catchup:  { credits: 1000, amount: '350.00', name: 'Riya Catch-Up — 1,000 RoAs' }"
);

fs.writeFileSync('index.js', code, 'utf8');
console.log('SUCCESS — Catch-Up bundle added to backend');