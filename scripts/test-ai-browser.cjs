// Optional UI integration suite: install Playwright locally or provide NODE_PATH.
// Uses isolated browser contexts and mocked Auth/AI. Never sends real documents.
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {labels} = require('../dist/ai-fields.js');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:4175/';
const draft = {summary:'整理了测试技术材料',recommendedType:'invention',typeReason:'产品技术方案',questions:['请补充实验条件。'],warnings:[],fields:Object.fromEntries(Object.keys(labels).map(key=>[key,{value:key==='claims'?['一种检测装置，包括外壳和固定在外壳上的探头。']:key==='title'?'一种便携式检测装置':key==='background'?'':'测试材料中的技术描述',status:key==='background'?'missing':'supported',note:'请核对原文件。',evidence:[{file:'交底.txt',location:'第一段',excerpt:'<script>alert("unsafe")</script> 装置包括外壳和探头。'}]}]))};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_PATH?{executablePath:process.env.PLAYWRIGHT_BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('heading',{name:'专利申请，从这里开始。'}).waitFor();
  await page.locator('.ai-entry button').click();
  await page.getByRole('heading',{name:'队伍 AI 正在接入'}).waitFor();
  await page.screenshot({path:'qa/ai-unconfigured.png',fullPage:true});
  await page.getByRole('button',{name:'继续编制专利',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  await page.screenshot({path:'qa/ai-mobile.png',fullPage:false});
  await page.setViewportSize({width:1440,height:1080});
  console.log('PASS unconfigured state and mobile layout');
  await context.route('**/ai-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.PATENT_AI_CONFIG={supabaseUrl:"https://test.supabase.co",publishableKey:"sb_publishable_test"};'}));
  let posts=0, account='A', rejectGeneration=false;
  await context.route('https://test.supabase.co/**',async route=>{
    const r=route.request(),url=r.url();
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    let body;
    if(url.includes('/auth/v1/token')){account=JSON.parse(r.postData()).email.startsWith('b@')?'B':'A';body={access_token:'test-'+account,refresh_token:'refresh-test',expires_in:3600,user:{email:account+'@example.test'}};}
    else if(url.includes('/auth/v1/logout'))body={};
    else if(r.method()==='GET')body={account:{userId:account==='A'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',teamName:'康莱德测试队 '+account,dailyLimit:10}};
    else {if(rejectGeneration)return route.fulfill({status:429,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({error:'队伍今日 AI 次数已用完。'})});posts++;const input=JSON.parse(r.postData());assert.equal(input.files.length,2);assert(!input.existing.inventors);body={draft,quota:{remaining:9,limit:10}};}
    return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  });
  await page.reload();
  // Create guest data and verify it is preserved through login/logout.
  await page.locator('.heading-line [data-action=new]').click();
  await page.locator('#new-title').fill('访客原专利');await page.locator('#new-team').fill('访客测试');
  await page.getByRole('button',{name:'创建专利',exact:true}).click();
  async function login(email){await page.locator('[data-ai=account]').click();await page.locator('#ai-email').fill(email);await page.locator('#ai-password').fill('test-password');await page.getByRole('button',{name:'登录队伍账号',exact:true}).click();await page.getByRole('button',{name:'退出账号',exact:true}).waitFor();}
  await login('a@example.test');
  await page.locator('#ai-dialog [data-ai=close]').click();
  assert.equal(await page.getByText('访客原专利',{exact:true}).count(),0);
  await page.locator('.ai-entry button').click();
  await page.locator('#ai-dialog [data-ai=close]').click();
  await page.locator('[data-field=title]').fill('用户原名称');
  await page.locator('[data-step="2"]').first().click();
  await page.locator('[data-field=solution]').fill('用户已有技术方案，不应覆盖。');
  await page.locator('.editor-top [data-ai=start]').click();
  await page.locator('#ai-files').setInputFiles([{name:'交底.txt',mimeType:'text/plain',buffer:Buffer.from('装置包括外壳和探头。')},{name:'实验.txt',mimeType:'text/plain',buffer:Buffer.from('测试条件尚未补充。')}]);
  assert.equal(await page.locator('.ai-file').count(),2);
  await page.locator('#ai-consent').check();await page.getByRole('button',{name:'生成专利建议稿 →',exact:true}).click();
  await page.getByRole('heading',{name:'专利建议稿，等你确认'}).waitFor();
  assert.equal(posts,1);assert.equal(await page.locator('[data-ai-select=title]').isChecked(),false);assert.equal(await page.locator('[data-ai-select=solution]').isChecked(),false);
  assert.equal(await page.locator('[data-ai-select=background]').isDisabled(),true);
  assert.equal(await page.locator('[data-ai-select=technicalField]').isChecked(),true);
  assert.equal(await page.locator('#ai-dialog script').count(),0);
  await page.screenshot({path:'qa/ai-review.png',fullPage:true});
  await page.locator('[data-ai-select=title]').check();
  await page.locator('[data-ai-value=title]').fill('一种经审阅的检测装置');
  await page.getByRole('button',{name:'采纳勾选字段',exact:true}).click();
  await page.locator('#ai-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('[data-field=solution]').inputValue(),'用户已有技术方案，不应覆盖。');
  await page.locator('[data-step="0"]').first().click();assert.equal(await page.locator('[data-field=title]').inputValue(),'一种经审阅的检测装置');
  console.log('PASS login isolation, multi-file upload, safe review and selective adoption');
  await page.locator('[data-step="5"]').first().click();
  const download=page.waitForEvent('download');await page.locator('[data-action=export][data-mode=review]').click();
  const d=await download;await d.saveAs('qa/ai-word-export.zip');assert(fs.statSync('qa/ai-word-export.zip').size>10000);
  console.log('PASS existing Word export after AI adoption');
  async function logout(){await page.locator('[data-ai=account]').click();await page.getByRole('button',{name:'退出账号',exact:true}).click();await page.locator('#ai-dialog').waitFor({state:'hidden'});}
  await logout();await page.getByText('访客原专利',{exact:true}).waitFor();
  await login('b@example.test');await page.locator('#ai-dialog [data-ai=close]').click();
  assert.equal(await page.getByText('一种经审阅的检测装置',{exact:true}).count(),0);
  await logout();await login('a@example.test');await page.locator('#ai-dialog [data-ai=close]').click();
  await page.getByText('一种经审阅的检测装置',{exact:true}).waitFor();
  rejectGeneration=true;await page.getByText('一种经审阅的检测装置',{exact:true}).click();await page.locator('.editor-top [data-ai=start]').click();await page.locator('#ai-files').setInputFiles({name:'交底.txt',mimeType:'text/plain',buffer:Buffer.from('测试材料')});await page.locator('#ai-consent').check();await page.getByRole('button',{name:'生成专利建议稿 →',exact:true}).click();await page.getByRole('heading',{name:'本次生成未完成'}).waitFor();await page.getByText('队伍今日 AI 次数已用完。',{exact:true}).waitFor();await page.getByRole('button',{name:'返回填写',exact:true}).click();assert.equal(await page.locator('[data-field=title]').inputValue(),'一种经审阅的检测装置');console.log('PASS real quota failure is displayed without modifying draft');
  await page.reload();await page.getByText('访客原专利',{exact:true}).waitFor();assert.equal(await page.getByText('一种经审阅的检测装置',{exact:true}).count(),0);
  console.log('PASS account switching, local persistence and no persisted auth session');
  assert.deepEqual(errors,[]);await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
