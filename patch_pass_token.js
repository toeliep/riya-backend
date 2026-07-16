const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

h = h.replace(
  "const result = await sendRoAEmail(brokerEmail, clientName, resolvedBrokerName, roaContent);",
  "const result = await sendRoAEmail(brokerEmail, clientName, resolvedBrokerName, roaContent, brokerToken);"
);

fs.writeFileSync('index.js', h, 'utf8');
console.log('done');