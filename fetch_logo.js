const https = require('https');
const fs = require('fs');

const url = 'https://convertri.imgix.net/5a1f0041-5490-11e6-829d-066a9bd5fb79/758f2049b8c993e271d89b3e4746e362767b8c8e/Logo%20Image.png';

const file = fs.createWriteStream('assets/1st-insurance-logo.png');
https.get(url, function(response) {
  response.pipe(file);
  file.on('finish', function() {
    file.close();
    console.log('✓ 1st Insurance logo downloaded to assets/');
  });
}).on('error', function(err) {
  fs.unlink('assets/1st-insurance-logo.png', () => {});
  console.error('Error:', err.message);
});