const fs = require('node:fs'), assert = require('node:assert/strict');
for (const file of fs.readdirSync('dist').filter(name=>/\.(mjs|js|html)$/.test(name))) {
  const contents=fs.readFileSync('dist/'+file,'utf8');
  assert(!/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(contents),'Potential OpenAI secret in '+file);
  assert(!/sb_secret_[A-Za-z0-9_-]{10,}/.test(contents),'Potential Supabase secret in '+file);
}
console.log('PASS public frontend config contains no privileged key');
