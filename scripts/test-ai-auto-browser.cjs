const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const JSZip=require('../dist/vendor/jszip.js');
const {labels}=require('../dist/ai-fields.js');
const base=process.env.TEST_SITE_URL||'http://127.0.0.1:4175/';
const draft={summary:'测试交底整理',recommendedType:'invention',typeReason:'产品结构',warnings:[],questions:['请填写真实申请人'],fields:Object.fromEntries(Object.keys(labels).map(k=>[k,{value:k==='claims'?['一种装置，包括外壳和探头。']:k==='title'?'一种自动编制测试装置':'资料支持的技术描述',status:k==='benefits'?'needs_confirmation':'supported',note:k==='benefits'?'缺少测试数据，不自动采用效果断言':'',evidence:[{file:'交底.txt',location:'第一段',excerpt:'外壳与探头连接'}]}]))};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSER_PATH}:{})});
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1360,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let attempts=0,quotaError=true,templateFailure=true;
 await page.route('**/templates/100002.docx',r=>templateFailure?r.fulfill({status:503,body:'test failure'}):r.continue());
 await page.route('https://api.openai.com/**',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
  attempts++;assert.equal(JSON.parse(route.request().postData()).input[0].content.length,3);
  return route.fulfill({status:quotaError?429:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','x-request-id':'req_test_auto','access-control-expose-headers':'x-request-id'},body:JSON.stringify(quotaError?{error:{code:'project_spend_limit_exceeded',type:'insufficient_quota',message:'private-error'}}:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(draft)}]}]})});
 });
 await page.goto(base);await page.locator('.ai-entry button').click();await page.locator('#ai-key').fill('sk-fake-key-for-tests');await page.locator('#ai-settings button[type=submit]').click();
 assert.equal(await page.locator('#ai-output').inputValue(),'package');
 await page.locator('#ai-note').fill('使用第二版方案');
 await page.locator('#ai-files').setInputFiles([{name:'交底.txt',mimeType:'text/plain',buffer:Buffer.from('外壳与探头连接')},{name:'备注.txt',mimeType:'text/plain',buffer:Buffer.from('无实验数据')}]);
 await page.locator('#ai-consent').check();await page.locator('#ai-generate button[type=submit]').click();
 await page.getByRole('heading',{name:'项目消费上限',exact:true}).waitFor();assert.equal(attempts,1);
 assert((await page.locator('#ai-dialog').innerText()).includes('不代表余额为零'));
 let dl=page.waitForEvent('download');await page.locator('[data-ai=diagnostic]').click();const diagDownload=await dl;const diag=JSON.parse(fs.readFileSync(await diagDownload.path(),'utf8'));assert.equal(diag.code,'project_spend_limit_exceeded');assert.equal(diag.fileCount,2);assert(!JSON.stringify(diag).includes('sk-fake'));
 await page.locator('[data-ai=retry-settings]').click();await page.locator('#ai-model').selectOption('gpt-5.4-mini');await page.locator('#ai-settings button[type=submit]').click();assert.equal(await page.locator('.ai-file').count(),2);assert.equal(await page.locator('#ai-note').inputValue(),'使用第二版方案');
 quotaError=false;await page.locator('#ai-consent').check();await page.locator('#ai-generate button[type=submit]').click();
 await page.getByRole('heading',{name:'AI 已整理完成，Word 打包未完成'}).waitFor();assert.equal(attempts,2);
 templateFailure=false;dl=page.waitForEvent('download');await page.locator('[data-ai=retry-package]').click();
 await page.getByRole('heading',{name:'专利草稿材料包已生成'}).waitFor();const download=await dl;await download.saveAs('qa/ai-auto-package.zip');assert.equal(attempts,2);
 const zip=await JSZip.loadAsync(fs.readFileSync('qa/ai-auto-package.zip'));const docs=Object.keys(zip.files).filter(n=>n.endsWith('.docx'));assert.equal(docs.length,4);
 const backup=JSON.parse(await zip.file('课题备份.json').async('string'));assert.equal(backup.projects[0].title,'一种自动编制测试装置');assert.equal(backup.projects[0].benefits,'');assert.equal(backup.projects[0].applicants[0].name,'');
 assert((await zip.file('自动检查与待补清单.txt').async('string')).includes('缺少测试数据'));assert(zip.file('AI整理依据.json'));
 const doc=await JSZip.loadAsync(await zip.file('03_说明书.docx').async('uint8array'));assert((await doc.file('word/document.xml').async('string')).includes('资料支持的技术描述'));
 await page.screenshot({path:'qa/ai-auto-complete.png'});
 await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.sidebar [data-nav=projects]').click();assert.equal(await page.locator('[data-open]').count(),6); // sample, original draft, generated copy; two buttons each
 assert.deepEqual(errors,[]);console.log('PASS precise quota diagnosis, retained files/settings, automatic Word ZIP, safe draft markers, original preserved, package retry without another AI call');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
