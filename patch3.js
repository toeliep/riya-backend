const fs = require('fs'); 
let code = fs.readFileSync('index.js', 'utf8'); 
code = code.replace("app.listen", "app.post('/create-token', async (req, res) => { const {name,email,token,fsp_number,plan,credits} = req.body; if(!name||!email||!token) return res.status(400).json({error:'missing fields'}); try { const r = await fetch(process.env.SUPABASE_URL+'/rest/v1/brokers',{method:'POST',headers:{'Content-Type':'application/json','apikey':process.env.SUPABASE_SERVICE_ROLE_KEY,'Authorization':'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Prefer':'return=representation'},body:JSON.stringify({name,email,token,fsp_number:fsp_number||null,plan:plan||'pilot',credits:credits||5,credits_used:0,status:'active'})}); if(!r.ok){const e=await r.text();return res.status(500).json({error:e});} await sendWelcomeEmail(name,email,token); res.json({success:true}); } catch(err){res.status(500).json({error:err.message});} });\napp.listen"); 
fs.writeFileSync('index.js', code); 
console.log('Done'); 
