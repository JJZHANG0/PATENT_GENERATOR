import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {requestDraft, parseAPIError, validateKey, validateInput, validateOutput} from '../dist/ai-core.mjs';
import {buildRequest, FIELD_LABELS} from '../dist/ai-prompt.mjs';
const require = createRequire(import.meta.url);
const fields = require('../dist/ai-fields.js');
const input = () => ({patentType:'utility',note:'核对结构关系',existing:{},files:[{name:'交底.txt',dataUrl:'data:text/plain;base64,'+Buffer.from('装置包括外壳和固定在外壳上的探头。').toString('base64')}]});
const result = () => ({summary:'待审阅',recommendedType:'utility',typeReason:'产品构造',questions:[],warnings:[],fields:Object.fromEntries(Object.keys(FIELD_LABELS).map(k=>[k,{value:k==='claims'?['一种检测装置，包括外壳和固定在外壳上的探头。']:'材料支持的描述',status:'supported',evidence:[{file:'交底.txt',location:'第一段',excerpt:'装置包括外壳和固定在外壳上的探头。'}],note:''}]))});
const fakeKey = 'sk-test-not-a-real-key';
function harness(overrides={}) {
  let calls=0, body;
  const run=(options={})=>requestDraft({apiKey:fakeKey,input:input(),fetchImpl:async(url, init)=>{
    calls++;body=JSON.parse(init.body);
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization,'Bearer '+fakeKey);
    assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    assert(!init.body.includes(fakeKey));
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result())}]}]});
  },...overrides,...options});
  return {run,calls:()=>calls,body:()=>body};
}
test('missing Key and tracking IDs rejected without API usage',async()=>{for(const apiKey of ['', 'key_tracking_id', 'sk-short']){const h=harness();await assert.rejects(()=>h.run({apiKey}),/完整/);assert.equal(h.calls(),0);}});
test('users supply their own Key and calls go directly to OpenAI',async()=>{const h=harness();const draft=await h.run();assert.equal(draft.summary,'待审阅');assert.equal(h.calls(),1);assert.equal(h.body().store,false);assert.equal(h.body().model,'gpt-6.2-sol');assert.equal(h.body().text.format.strict,true);});
test('model selection is bounded and does not change API destination',async()=>{const h=harness();for(const model of ['gpt-6.2-sol','gpt-6.2-astra','gpt-5.4-mini','gpt-5.4']){await h.run({model});assert.equal(h.body().model,model);assert.equal(h.body().reasoning.effort,'medium');}await assert.rejects(()=>h.run({model:'unknown-model'}));assert.equal(h.calls(),4);});
test('invalid upload is rejected before using the personal Key',async()=>{const h=harness();await assert.rejects(()=>h.run({input:{...input(),files:[]}}));assert.equal(h.calls(),0);});
test('provider errors never expose bodies or Keys',async()=>{for(const status of [400,401,403,404,429,500]){const h=harness({fetchImpl:async()=>new Response('secret-provider-body',{status})});await assert.rejects(()=>h.run(),e=>!e.message.includes('secret-provider-body')&&!e.message.includes(fakeKey));}});
test('cancellation reaches fetch without retries',async()=>{const controller=new AbortController();controller.abort();let attempts=0;await assert.rejects(()=>requestDraft({apiKey:fakeKey,input:input(),signal:controller.signal,fetchImpl:async(url,init)=>{attempts++;init.signal.throwIfAborted();}}),{name:'AbortError'});assert.equal(attempts,0);});
test('incomplete and refusal responses do not become successful drafts',async()=>{for(const output of [{status:'incomplete',output:[]},{status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]}]){const h=harness({fetchImpl:async()=>Response.json(output)});await assert.rejects(()=>h.run());}});
test('personal and unknown fields are not forwarded from existing draft',()=>{const i=validateInput({...input(),existing:{idNumber:'should-not-leak',contact:{phone:'123'},title:'已有名称'}});assert.deepEqual(Object.keys(i.existing),Object.keys(FIELD_LABELS));assert(!JSON.stringify(buildRequest(i,'test')).includes('should-not-leak'));});
test('file spoofing, duplicate names, too many files and oversized files rejected',()=>{assert.throws(()=>validateInput({...input(),files:[{name:'a.pdf',dataUrl:'data:application/pdf;base64,YWJj'}]}));const f=input().files[0];assert.throws(()=>validateInput({...input(),files:[f,f]}));assert.throws(()=>validateInput({...input(),files:Array(9).fill(f)}));assert.throws(()=>validateInput({...input(),files:[{...f,dataUrl:'data:text/plain;base64,'+Buffer.alloc(5*1024*1024+1).toString('base64')}]}));});
test('images use input_image, never external URLs or file URLs',()=>{const i=validateInput({...input(),files:[{name:'结构.png',dataUrl:'data:image/png;base64,'+Buffer.from('\x89PNG\r\n\x1a\nmore','latin1').toString('base64')}]});assert.equal(buildRequest(i,'test').input[0].content[1].type,'input_image');assert.throws(()=>validateInput({...input(),files:[{name:'x.pdf',dataUrl:'https://internal.example/secret'}]}));});
test('unknown evidence sources and unsupported existing draft references need confirmation',()=>{const r=result();r.fields.title.evidence[0].file='不存在.pdf';r.fields.solution.evidence[0].file='已有草稿';const out=validateOutput(r,validateInput(input()));assert.equal(out.fields.title.status,'needs_confirmation');assert.equal(out.fields.solution.status,'needs_confirmation');});
test('abstract and utility method claims get deterministic review warnings',()=>{const r=result();r.fields.abstract.value='字'.repeat(301);r.fields.claims.value=['一种检测方法，其特征在于检测样本。','根据权利要求2所述的方法'];const out=validateOutput(r,validateInput(input()));assert.equal(out.fields.abstract.status,'needs_confirmation');assert.equal(out.fields.claims.status,'needs_confirmation');assert(out.warnings.length>=3);});
test('only selected fields change; identity and drawings remain untouched',()=>{const p={...Object.fromEntries(Object.keys(FIELD_LABELS).map(k=>[k,'原文'])),claims:[{text:'原权项'}],inventors:[{name:'甲'}],figures:[{dataUrl:'original'}]};const before=fields.snapshot(p);assert.equal(fields.apply(p,{title:'新名称'},before),1);assert.equal(p.title,'新名称');assert.equal(p.solution,'原文');assert.equal(p.inventors[0].name,'甲');assert.equal(p.figures[0].dataUrl,'original');});
test('stale edits and oversized abstract fail atomically without partial application',()=>{const p={title:'原名称',abstract:'原摘要',claims:[]};const before=fields.snapshot(p);assert.throws(()=>fields.apply(p,{title:'新名称',abstract:'字'.repeat(301)},before));assert.equal(p.title,'原名称');p.title='用户更新';assert.throws(()=>fields.apply(p,{title:'新名称'},before));assert.equal(p.title,'用户更新');});
test('cannot apply prototype or administrative fields',()=>{const p={title:'原文',claims:[]};assert.throws(()=>fields.apply(p,{inventors:[]},fields.snapshot(p)));assert.throws(()=>fields.apply(p,JSON.parse('{"__proto__":"attack"}'),fields.snapshot(p)));assert.equal({}.attack,undefined);});

test('billing, spend, quota and rate limit errors remain distinct',async()=>{
  for(const code of ['credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','insufficient_quota','rate_limit_exceeded','slow_down']){
    const e=await parseAPIError(Response.json({error:{code,type:'insufficient_quota',message:'private source text'}},{status:429,headers:{'x-request-id':'req_test123','retry-after':'7'}}));
    assert.equal(e.diagnostic.code,code);assert.equal(e.diagnostic.requestId,'req_test123');assert.equal(e.retryAfter,7);assert(!e.message.includes('private source text'));
    assert.equal(e.retryable,['rate_limit_exceeded','slow_down'].includes(code));
  }
  const e=await parseAPIError(new Response('unknown',{status:429}));assert.equal(e.diagnostic.code,'unknown');assert.match(e.message,/暂不能判断/);assert.equal(e.retryable,false);
});
test('only temporary limits retry once; billing never retries',async()=>{
  for(const code of ['rate_limit_exceeded','credit_balance_exhausted','project_spend_limit_exceeded']){
    let calls=0,sleeps=0;
    const h=harness({fetchImpl:async()=>{calls++;return Response.json({error:{code}},{status:429,headers:{'retry-after':'1'}});},sleepImpl:async(ms)=>{assert.equal(ms,1000);sleeps++;}});
    await assert.rejects(()=>h.run());assert.equal(calls,code==='rate_limit_exceeded'?2:1);assert.equal(sleeps,code==='rate_limit_exceeded'?1:0);
  }
});
test('oversized requests do not retry unchanged',async()=>{let calls=0;const h=harness({fetchImpl:async()=>{calls++;return Response.json({error:{code:'rate_limit_exceeded',message:'Request too large for tokens per min'}},{status:429});}});await assert.rejects(()=>h.run(),/减少文件/);assert.equal(calls,1);});
test('automatic package preserves original and excludes uncertain fields',()=>{
  globalThis.PatentAIFields=fields;const {prepare}=require('../dist/ai-package.js');
  const source={id:'original',title:'原专利',solution:'原方案',claims:[{text:'原权项'}],applicants:[{name:'原申请人'}],figures:[],pageCounts:{request:'3'}};
  const r=result();r.fields.solution.status='needs_confirmation';const out=prepare(source,r);
  assert.equal(source.title,'原专利');assert.notEqual(out.project.id,source.id);assert.equal(out.project.solution,'原方案');assert.equal(out.project.applicants[0].name,'原申请人');assert.equal(out.project.pageCounts.request,'');assert(out.notes.some(n=>n.includes('技术方案')));
});
