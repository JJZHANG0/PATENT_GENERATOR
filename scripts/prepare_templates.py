from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json,hashlib
ROOT=Path(__file__).resolve().parents[1];NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};W='{'+NS['w']+'}'
OUT=ROOT/'dist/templates';OUT.mkdir(exist_ok=True)
def save(z,changed,path):
 with ZipFile(path,'w',ZIP_DEFLATED) as o:
  for n in z.namelist():o.writestr(n,changed.get(n,z.read(n)))
def xml(r):return E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
records={}
for code in ['110101','120101','110401']:
 z=ZipFile(ROOT/f'qa/{code}.docx');r=E.fromstring(z.read('word/document.xml'));ti=ci=0;rec=[]
 for pi,p in enumerate(r.xpath('//w:p',namespaces=NS)):
  text=''.join(p.xpath('.//w:t/text()',namespaces=NS));current=None;state='';result=[];start=None
  for child in list(p):
   fs=child.find('.//w:fldChar',NS)
   if fs is not None and fs.get(W+'fldCharType')=='begin':
    ff=fs.find('w:ffData',NS)
    if ff is not None:
     if ff.find('w:textInput',NS) is not None:
      current=f'F{ti}';ti+=1;start=ff;state='code';result=[]
      d=ff.find('w:textInput',NS);de=d.find('w:default',NS)
      if de is None:de=E.SubElement(d,W+'default')
      de.set(W+'val','{{'+current+'}}');rec.append({'key':current,'p':pi,'label':text})
     elif ff.find('w:checkBox',NS) is not None:
      current=f'C{ci}';ci+=1;state='checkbox';box=ff.find('w:checkBox',NS)
      for tag in ['default','checked']:
       t=box.find('w:'+tag,NS)
       if t is None:t=E.SubElement(box,W+tag)
       t.set(W+'val','{{'+current+'}}')
      rec.append({'key':current,'p':pi,'label':text})
   if fs is not None and fs.get(W+'fldCharType')=='separate' and state=='code':state='result'
   if state=='result':result.extend(child.findall('.//w:t',NS))
   if fs is not None and fs.get(W+'fldCharType')=='end':
    if state=='result' and current:
     if not result:
      run=E.Element(W+'r');t=E.SubElement(run,W+'t');p.insert(list(p).index(child),run);result=[t]
     for j,t in enumerate(result):t.text='{{'+current+'}}' if j==0 else ''
    current=None;state='';result=[]
  if '指定说明书附图中的图' in text:
   ts=p.findall('.//w:t',NS)
   for j,t in enumerate(ts):t.text='指定说明书附图中的图 {{abstractFigure}} 为摘要附图' if j==0 else ''
 # Formal application copies use black text even where official blank fields are red.
 for color in r.xpath('//w:color',namespaces=NS):
  color.set(W+'val','000000')
  for attr in list(color.attrib):
   if attr != W+'val':del color.attrib[attr]
 # Filled rows must grow instead of clipping legal identity numbers. Keep original minimum heights.
 for row in r.xpath('//w:tr',namespaces=NS):
  if '{{' in E.tostring(row,encoding='unicode'):
   for height in row.findall('w:trPr/w:trHeight',NS):
    if height.get(W+'hRule')=='exact':height.set(W+'hRule','atLeast')
 if code=='110401':
  for row in r.xpath('//w:tr',namespaces=NS):
   txt=''.join(row.xpath('.//w:t/text()',namespaces=NS))
   if '{{F3}}' in txt and '{{F4}}' in txt:
    for height in row.findall('w:trPr/w:trHeight',NS):height.set(W+'val','1000')
   if '⑥备注' in txt:
    for height in row.findall('w:trPr/w:trHeight',NS):height.set(W+'val','2200')
   if '本框由国家知识产权局填写' in txt:
    for height in row.findall('w:trPr/w:trHeight',NS):height.set(W+'hRule','atLeast')
 if code=='120101':
  rows=r.xpath('//w:tr',namespaces=NS);group=False
  for row in rows:
   text=''.join(row.xpath('.//w:t/text()',namespaces=NS))
   if '姓名或名称' in text:group=True
   last=group and '城区（乡）、街道、门牌号' in text
   if group:
    for p in row.xpath('.//w:p',namespaces=NS):
     pp=p.find('w:pPr',NS)
     if pp is None:pp=E.Element(W+'pPr');p.insert(0,pp)
     for old in pp.findall('w:keepNext',NS):pp.remove(old)
     if not last:E.SubElement(pp,W+'keepNext')
   if last:group=False
  for cell in r.xpath('//w:tc[w:tcPr/w:vMerge]',namespaces=NS):
   props=cell.find('w:tcPr',NS);val=props.find('w:vAlign',NS)
   if val is None:val=E.SubElement(props,W+'vAlign')
   val.set(W+'val','top')
 changed={'word/document.xml':xml(r)}
 if 'word/settings.xml' in z.namelist():
  s=E.fromstring(z.read('word/settings.xml'))
  for t in s.findall('w:documentProtection',NS):s.remove(t)
  u=s.find('w:updateFields',NS)
  if u is None:u=E.SubElement(s,W+'updateFields')
  u.set(W+'val','true');changed['word/settings.xml']=xml(s)
 save(z,changed,OUT/f'{code}.docx');records[code]=rec
for code in ['100001','100002','100003','100004','100014']:
 z=ZipFile(ROOT/f'qa/{code}.docx');r=E.fromstring(z.read('word/document.xml'));body=r.find('w:body',NS);sect=deepcopy(r.find('.//w:sectPr',NS))
 for c in list(body):body.remove(c)
 p=E.SubElement(body,W+'p');t=E.SubElement(E.SubElement(p,W+'r'),W+'t');t.text='{{BODY}}';body.append(sect)
 mar=sect.find('w:pgMar',NS)
 for k,v in dict(top=1418,left=1418,right=851,bottom=851,header=680,footer=567).items():mar.set(W+k,str(v))
 for g in sect.findall('w:docGrid',NS):sect.remove(g)
 num=sect.find('w:pgNumType',NS)
 if num is None:num=E.SubElement(sect,W+'pgNumType')
 num.set(W+'start','1')
 rels=E.fromstring(z.read('word/_rels/document.xml.rels'));rid=sect.find('w:footerReference',NS).get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id');target=next(x.get('Target') for x in rels if x.get('Id')==rid)
 footer=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="'+NS['w']+'"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:sz w:val="21"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>').encode()
 changed={'word/document.xml':xml(r),'word/'+target:footer}
 if 'word/settings.xml' in z.namelist():
  s=E.fromstring(z.read('word/settings.xml'));u=s.find('w:updateFields',NS)
  if u is None:u=E.SubElement(s,W+'updateFields')
  u.set(W+'val','true');changed['word/settings.xml']=xml(s)
 save(z,changed,OUT/f'{code}.docx')
(OUT/'field-map.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
manifest={}
for code in ['110101','120101','110401','100001','100002','100003','100004','100014']:
 p=ROOT/f'qa/{code}.docx';z=ZipFile(p);r=E.fromstring(z.read('word/document.xml'))
 manifest[code]={'reference':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sections':len(r.xpath('//w:sectPr',namespaces=NS)),'parts':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}}
(ROOT/'qa/word-reference-manifest.json').write_text(json.dumps(manifest,indent=2))
print('Prepared',len(manifest),'official templates')
