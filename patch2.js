const fs = require('fs'); 
let code = fs.readFileSync('index.js', 'utf8'); 
const helper = "\nconst { sendWelcomeEmail } = require('./resend_helper');\n"; 
code = code.replace("const express = require('express');", "const express = require('express');" + helper); 
fs.writeFileSync('index.js', code); 
console.log('Done'); 
