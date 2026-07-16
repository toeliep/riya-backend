const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

// Add fs require at the top after express
h = h.replace(
  "const express = require('express');",
  "const express = require('express');\nconst fs = require('fs');"
);

fs.writeFileSync('index.js', h, 'utf8');
console.log('done');