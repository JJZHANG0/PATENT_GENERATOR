// Mock only the local service; no CLI run or API usage.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.TEST_SITE_URL||'http://127.0.0.1:4175/';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSER_PATH}:{})});
 try {
  const page=await browser.newPage();
  let calls=0,cancelled=0,upstream=0,mode='error';const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://api.openai.com/**',r=>{upstream++;return r.abort();});
  await page.goto(base);await page.locator('.ai-entry button').click();
  await page.getByRole('heading',{name:'使用本机 Codex，无需 API Key'}).waitFor();
  assert.equal(await page.locator('#ai-key').count(),0);
  assert.equal(await page.getByRole('link',{name:'打开本机工坊'}).getAttribute('href'),'http://127.0.0.1:8765/');
  await page.addInitScript(()=>{window.PATENT_LOCAL_CODEX={token:'test-local-token'};});
  await page.route('**/local-codex/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   assert.equal(req.headers().authorization,'Bearer test-local-token');
   let result;
   if(path.endsWith('/status'))result={ready:true,message:'已登录 ChatGPT'};
   else if(path.endsWith('/generate')){
    calls++;const input=JSON.parse(req.postData());assert.equal(input.files.length,1);
    assert.equal(input.model,'gpt-6.2-sol');assert(!('apiKey' in input));result={jobId:'mock-job'};
   }else if(path.includes('/cancel/')){cancelled++;result={cancelled:true};}
   else result=mode==='error'?{status:'error',message:'Codex 订阅用量受限，未使用 API Key。'}:{status:'running',message:'正在测试取消'};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.reload();await page.locator('.ai-account-button').click();
  await page.getByText('已登录 ChatGPT',{exact:true}).waitFor();
  await page.locator('#local-settings button[type=submit]').click();
  await page.locator('.ai-entry button').click();assert.equal(await page.locator('#ai-key').count(),0);
  await page.locator('#ai-note').fill('保留这个说明');
  await page.locator('#ai-files').setInputFiles({name:'交底.txt',mimeType:'text/plain',buffer:Buffer.from('外壳连接探头')});
  await page.locator('#ai-consent').check();await page.locator('#ai-generate button[type=submit]').click();
  await page.getByRole('heading',{name:'本次生成未完成'}).waitFor();assert.equal(calls,1);
  assert((await page.locator('[data-ai=retry-settings]').innerText()).includes('检查登录'));
  await page.locator('[data-ai=edit-upload]').click();
  assert.equal(await page.locator('.ai-file').count(),1);assert.equal(await page.locator('#ai-note').inputValue(),'保留这个说明');
  mode='running';await page.locator('#ai-consent').check();await page.locator('#ai-generate button[type=submit]').click();
  await page.getByText('正在测试取消',{exact:true}).waitFor();
  const cancelRequest=page.waitForRequest('**/local-codex/cancel/mock-job');await page.locator('[data-ai=cancel]').click();await cancelRequest;
  await page.getByRole('heading',{name:'本次生成未完成'}).waitFor();
  assert.equal(calls,2);assert.equal(cancelled,1);assert.equal(upstream,0);assert.deepEqual(errors,[]);
  console.log('PASS Pages local handoff, ChatGPT status, no Key/API calls, retained uploads, cancellation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
