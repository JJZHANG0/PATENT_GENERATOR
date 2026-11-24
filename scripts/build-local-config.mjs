import {SYSTEM_PROMPT, OUTPUT_SCHEMA} from '../dist/ai-prompt.mjs';
import {writeFileSync,readFileSync} from 'node:fs';
const destination = new URL('./local-codex-config.json',import.meta.url);
const contents = JSON.stringify({prompt:SYSTEM_PROMPT,schema:OUTPUT_SCHEMA},null,2)+'\n';
if(process.argv.includes('--check')) {
  if(readFileSync(destination,'utf8')!==contents) throw Error('Run node scripts/build-local-config.mjs to refresh the local Codex prompt/schema');
} else writeFileSync(destination,contents);
