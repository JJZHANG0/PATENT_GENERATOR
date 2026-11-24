/* Official CNIPA templates, fetched 2026-11-23. All document generation stays in this browser. */
(function (global) {
  'use strict';
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const esc = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const clean = value => String(value ?? '').trim();
  const lines = value => clean(value).split(/\r?\n/).filter(x => x.trim()).map(x => x.trim());
  const prop = '<w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/><w:color w:val="000000"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:eastAsia="zh-CN"/></w:rPr>';
  function paragraph(text, opts = {}) {
    const rp = opts.bold ? prop.replace('</w:rPr>', '<w:b/></w:rPr>') : prop;
    const p = `<w:pPr><w:spacing w:before="0" w:after="${opts.after ?? 0}" w:line="440" w:lineRule="exact"/><w:jc w:val="${opts.align || 'both'}"/><w:snapToGrid w:val="0"/>${opts.firstLine ? '<w:ind w:firstLine="480"/>' : ''}${opts.keep ? '<w:keepNext/>' : ''}${opts.breakBefore ? '<w:pageBreakBefore/>' : ''}<w:widowControl/></w:pPr>`;
    return `<w:p>${p}<w:r>${rp}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  }
  const heading = s => paragraph(s, {bold:true,keep:true,align:'left'});
  async function template(code) {
    const response = await fetch(`${PatentExport.templateBase}${code}.docx`);
    if (!response.ok) throw new Error(`无法读取 Word 模板 ${code}，请刷新后重试`);
    return await global.JSZip.loadAsync(await response.arrayBuffer());
  }
  async function blob(zip) { return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:MIME}); }
  async function replaceBody(code, content, options = {}) {
    const zip = await template(code);
    let xml = await zip.file('word/document.xml').async('string');
    xml = xml.replace(/<w:p>\s*<w:r>\s*<w:t>\{\{BODY\}\}<\/w:t>\s*<\/w:r>\s*<\/w:p>/, content);
    if (xml.includes('{{BODY}}')) throw new Error('模板正文插槽异常');
    zip.file('word/document.xml', xml);
    if(options.header) {
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      const m = xml.match(/<w:headerReference[^>]*r:id="([^"]+)"/);
      if(m) {
        const rel = (rels.match(/<Relationship\b[^>]+\/>/g)||[]).find(x => x.includes(`Id="${m[1]}"`));
        const target = rel && rel.match(/Target="([^"]+)"/);
        if(target) {
          let h = await zip.file('word/'+target[1]).async('string');
          h = h.replace(/说明书附图/g, esc(options.header));
          zip.file('word/'+target[1],h);
        }
      }
    }
    return zip;
  }
  function formData(p) {
    const utility = p.type === 'utility'; const v = {}; const set = (i,x) => v['F'+i] = x || '';
    set(0,p.title);
    (p.inventors||[]).slice(0,2).forEach((x,i)=>{set(2+3*i,x.name);set(3+3*i,x.country);set(4+3*i,x.idNumber);v['C'+i]=x.privateName?'1':'0';});
    const fields = ['name','kind','country','email','idNumber','phone','residence','postcode','province','city','address'];
    const inventionSlots = [[8,10,11,12,13,14,15,16,17,19,20],[22,24,25,26,27,28,29,30,31,33,34],[36,38,39,40,41,42,43,44,45,47,48]];
    const utilitySlots = [[8,10,11,13,14,15,16,17,18,20,21],[23,24,25,27,28,29,30,31,32,34,35],[37,38,39,40,41,42,43,44,45,47,48]];
    (p.applicants||[]).slice(0,3).forEach((a,i)=>fields.forEach((f,j)=>set((utility?utilitySlots:inventionSlots)[i][j],a[f])));
    const c=p.contact||{};['name','phone','email','province','postcode','city','address'].forEach((f,i)=>set((utility?[50,51,52,53,55,56,57]:[50,51,52,53,55,56,58])[i],c[f]));
    v.C2=p.feeReduction?'1':'0'; v[utility?'C10':'C14']=p.sameDay?'1':'0';
    const counts=p.pageCounts||{};
    ['request','abstract','claims','description','drawings'].forEach((f,i)=>set((utility?[87,89,91,93,95]:[99,100,101,102,103])[i],counts[f]));
    set(utility?97:106,Math.max(1,(p.claims||[]).length));
    if(!utility) {v.C15=p.earlyPublication?'1':'0';v.C16=p.substantive==='withApplication'?'1':'0';v.C21=p.substantive==='separate'?'1':'0';set(107,p.substantive==='separate'?counts.substantive:'');}
    const date=clean(p.signDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(date) date.slice(1).forEach((x,i)=>set((utility?115:119)+i,String(Number(x))));
    v.abstractFigure=(p.figures||[]).length ? (p.abstractFigure||1) : '';
    return v;
  }
  async function form(code,values) {
    const zip=await template(code);let xml=await zip.file('word/document.xml').async('string');
    xml=xml.replace(/\{\{([^}]+)\}\}/g,(_,key)=>esc(values[key]??(key.startsWith('C')?'0':'')));
    zip.file('word/document.xml',xml);return blob(zip);
  }
  function figureXML(rid, cx, cy, number, breakBefore) {
    return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="120"/>${breakBefore?'<w:pageBreakBefore/>':''}<w:keepNext/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="图${number}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${number}" name="图${number}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  async function drawings(figures,abstractIndex) {
    const selected=abstractIndex? [{figure:figures[abstractIndex-1],number:abstractIndex}]:figures.map((figure,i)=>({figure,number:i+1}));
    if(selected.some(x=>!x.figure))throw new Error('摘要附图图号不存在');
    let content='';const media=[];
    selected.forEach(({figure:f,number},i)=>{
      const m=String(f.dataUrl||'').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/);
      if(!m)throw new Error(`图${number}需为 PNG 或 JPG 图片`);
      const width=Number(f.width)||1000,height=Number(f.height)||1000;
      if(!(width>0&&height>0))throw new Error(`图${number}尺寸无效`);
      // 160 × 215 mm maximum within the official printable area; retain aspect ratio.
      const scale=Math.min(5760000/width,7740000/height);const cx=Math.round(width*scale),cy=Math.round(height*scale);
      const ext=m[1]==='jpeg'?'jpg':'png',rid='patentImage'+(i+1),name=`patent-image-${i+1}.${ext}`;
      media.push({rid,name,ext,data:m[2].replace(/\s/g,'')});
      content+=figureXML(rid,cx,cy,number,i>0)+paragraph(`图${number}`,{align:'center'});
    });
    const zip=await replaceBody('100003',content,{header:abstractIndex?'摘要附图':undefined});
    let rels=await zip.file('word/_rels/document.xml.rels').async('string');let types=await zip.file('[Content_Types].xml').async('string');
    media.forEach(m=>{zip.file('word/media/'+m.name,m.data,{base64:true});rels=rels.replace('</Relationships>',`<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/></Relationships>`);if(!types.includes(`Extension="${m.ext}"`))types=types.replace('</Types>',`<Default Extension="${m.ext}" ContentType="image/${m.ext==='jpg'?'jpeg':'png'}"/></Types>`);});
    zip.file('word/_rels/document.xml.rels',rels);zip.file('[Content_Types].xml',types);return blob(zip);
  }
  async function generate(p, options={draft:true}) {
    if(!p||typeof p!=='object')throw new Error('项目资料无效');
    if(!['invention','utility'].includes(p.type))throw new Error('请选择发明专利或实用新型');
    if((p.applicants||[]).length>3)throw new Error('当前请求书支持最多 3 位申请人');
    const utility=p.type==='utility'; const files=[]; const add=(name,b)=>files.push({name,blob:b});
    const need=(s,label)=>clean(s)||(options.draft?`【待填写：${label}】`:'');
    add(utility?'01_实用新型专利请求书.docx':'01_发明专利请求书.docx',await form(utility?'120101':'110101',formData(p)));
    let content='';const claims=(p.claims||[]);
    if(!options.draft && (!claims.length || claims.some(x=>!clean(x.text)))) throw new Error('权利要求存在空项，请补充后再导出完整材料');
    (claims.length?claims:[{text:''}]).forEach((c,i)=>{
      const chunks=lines(need(c.text,'权利要求'+(i+1)));content+=paragraph(`${i+1}. ${chunks.shift()?.replace(/^\s*(?:\d+[.．、]|\[\d+\])\s*/, '')||''}`,{firstLine:true});chunks.forEach(t=>content+=paragraph(t,{firstLine:true}));
    });
    add('02_权利要求书.docx',await blob(await replaceBody('100001',content)));
    let n=0;content=paragraph(need(p.title,'发明创造名称'),{align:'center',bold:true,keep:true,after:440});
    const section=(label,value)=>{content+=heading(label);lines(need(value,label)).forEach(t=>content+=paragraph(`[${String(++n).padStart(4,'0')}] ${t.replace(/^\s*(?:\[\d{4}\]|\d{4}[.．、])\s*/,'')}`,{firstLine:true}));};
    section('技术领域',p.technicalField);section('背景技术',p.background);
    content+=heading(utility?'实用新型内容':'发明内容');
    [need(p.problem,'要解决的技术问题'),need(p.solution,'技术方案'),need(p.benefits,'有益效果')].forEach(t=>lines(t).forEach(s=>content+=paragraph(`[${String(++n).padStart(4,'0')}] ${s}`,{firstLine:true})));
    if((p.figures||[]).length){content+=heading('附图说明');p.figures.forEach((f,i)=>content+=paragraph(`[${String(++n).padStart(4,'0')}] 图${i+1}为${clean(f.caption).replace(/^图\s*\d+\s*[为：:]?/,'')||'【待填写附图说明】'}${/[。；]$/.test(f.caption||'')?'':'。'}`,{firstLine:true}));}
    section('具体实施方式',p.embodiments);
    add('03_说明书.docx',await blob(await replaceBody('100002',content)));
    add('04_说明书摘要.docx',await blob(await replaceBody('100004',lines(need(p.abstract,'说明书摘要')).map(t=>paragraph(t,{firstLine:true})).join(''))));
    if((p.figures||[]).length){add('05_说明书附图.docx',await drawings(p.figures));add('06_摘要附图.docx',await drawings(p.figures,Number(p.abstractFigure)||1));}
    if((p.inventors||[]).length>2){
      content=paragraph('发明人信息续页',{align:'center',bold:true,keep:true,after:240})+paragraph(`发明创造名称：${p.title||''}`,{keep:true})+paragraph(`请求书第⑧栏发明人信息续填`,{keep:true,after:200});
      p.inventors.slice(2).forEach((x,i)=>{content+=paragraph(`发明人${i+3}　姓名：${x.name||''}`,{bold:true,keep:true})+paragraph(`国籍或地区：${x.country||''}　身份证件号码：${x.idNumber||''}`,{keep:true})+paragraph(`${x.privateName?'☒':'□'} 不公布姓名`,{after:240});});
      add('07_发明人附页.docx',await blob(await replaceBody('100014',content)));
    }
    if(!utility&&p.substantive==='separate'){
      const v={F0:p.applicationNumber,F1:p.title,F2:p.applicants?.[0]?.name};const d=clean(p.signDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(d)d.slice(1).forEach((x,i)=>v['F'+(5+i)]=String(Number(x)));
      add('08_实质审查请求书.docx',await form('110401',v));
    }
    return files;
  }
  const PatentExport={generate,templateBase:'templates/',formData,version:'2026.11.23'};
  global.PatentExport=PatentExport;
})(typeof window!=='undefined'?window:globalThis);
