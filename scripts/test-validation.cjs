const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
let src=fs.readFileSync('dist/app.js','utf8');src=src.slice(0,src.lastIndexOf('(async()=>{try{db='));
const context={document:{addEventListener(){}},window:{addEventListener(){}},crypto:require('crypto').webcrypto,console,structuredClone,setTimeout,clearTimeout,Intl};vm.createContext(context);vm.runInContext(src+'\nthis.api={blank,issues,normalizeProject,docNames,progress,sample};',context);const {blank,issues,normalizeProject,docNames,progress,sample}=context.api;let checks=0;function test(name,fn){fn();checks++;console.log('PASS',name);}
test('utility must have drawings',()=>{const p=blank();p.type='utility';assert(issues(p).some(x=>x.message.includes('必须上传')))});
test('abstract includes punctuation and rejects 301 characters',()=>{const p=blank();p.abstract='。'.repeat(301);assert(issues(p).some(x=>x.message.includes('超过 300')))});
test('claims cannot reference themselves or later claims',()=>{const p=blank();p.claims=[{text:'根据权利要求2所述的装置'}];assert(issues(p).some(x=>x.message.includes('自身或后面')))});
test('utility method claim is flagged',()=>{const p=blank();p.type='utility';p.claims=[{text:'一种水质检测方法，其特征在于'}];assert(issues(p).some(x=>x.message.includes('以方法为主题')))});
test('utility never includes substantive examination file',()=>{const p=blank();p.type='utility';p.substantive='separate';assert(!docNames(p).includes('实质审查请求书'))});
test('separate substantive request requires application number',()=>{const p=blank();p.substantive='separate';assert(issues(p).some(x=>x.message.includes('已有的申请号')))});
test('more than two inventors gets an attachment',()=>{const p=blank();p.inventors=[{},{},{}];assert(docNames(p).includes('发明人附页'))});
test('backup import creates independent IDs',()=>{const p=blank();assert.notEqual(normalizeProject(p).id,p.id)});
test('backup rejects script data URLs',()=>assert.throws(()=>normalizeProject({figures:[{dataUrl:'data:text/html;base64,AA=='}]})));
test('backup rejects excessive image data and bounds people',()=>{assert.equal(normalizeProject({inventors:Array(50).fill({})}).inventors.length,30);assert.equal(normalizeProject({applicants:Array(8).fill({})}).applicants.length,3)});
test('sample is explicitly marked and not complete',()=>{assert(sample().example);assert(progress(sample())<100);assert(issues(sample()).some(x=>x.severity==='error'))});
test('missing abstract figure index is flagged',()=>{const p=blank();p.figures=[{caption:'示意图',dataUrl:'data:image/png;base64,AA==',width:1000,height:1000}];p.abstractFigure=2;assert(issues(p).some(x=>x.message.includes('有效的摘要附图')))});
console.log(`${checks} validation checks passed.`);
