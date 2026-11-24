const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync('dist/ai-config.js','utf8'),context,{timeout:1000});
const {supabaseUrl, publishableKey} = context.window.PATENT_AI_CONFIG;
if (supabaseUrl || publishableKey) {
  assert.match(supabaseUrl,/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
  if (publishableKey.startsWith('eyJ')) {
    const payload = JSON.parse(Buffer.from(publishableKey.split('.')[1],'base64url'));
    assert.equal(payload.role,'anon','Only a legacy anon key may be published, never service_role');
  } else assert.match(publishableKey,/^sb_publishable_[A-Za-z0-9_-]+$/,'Only a Supabase publishable key may be published');
}
for (const file of fs.readdirSync('dist').filter(name=>/\.(js|html)$/.test(name))) {
  const contents=fs.readFileSync('dist/'+file,'utf8');
  assert(!/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(contents),'Potential OpenAI secret in '+file);
  assert(!/sb_secret_[A-Za-z0-9_-]{10,}/.test(contents),'Potential Supabase secret in '+file);
}
console.log('PASS public frontend config contains no privileged key');
