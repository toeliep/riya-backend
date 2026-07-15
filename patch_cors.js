const fs = require('fs');
let h = fs.readFileSync('index.js', 'utf8');

const corsCode = `const cors = require('cors');
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
`;

// Add after express is initialized
h = h.replace(
  "const app = express();",
  "const app = express();\n" + corsCode
);

fs.writeFileSync('index.js', h, 'utf8');
console.log('done');