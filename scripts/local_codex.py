#!/usr/bin/env python3
"""Personal loopback-only workshop, using official ChatGPT-authenticated Codex CLI.

No API credentials are read, copied, returned to the browser, or used as fallback.
Uploads and output exist in an isolated temporary directory for a single job.
"""
import argparse
import base64
import binascii
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
import webbrowser
import zipfile
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
CONFIG = json.loads((ROOT / 'scripts/local-codex-config.json').read_text())
MAX_BODY = 22 * 1024 * 1024
MODELS = ('gpt-6.2-sol', 'gpt-6.2-astra')
MIMES = {'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','txt':'text/plain',
         'md':'text/markdown','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg'}
FIELDS = ('title','technicalField','background','problem','solution','benefits','embodiments','claims','abstract')


class WorkshopError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def codex_path():
    found = shutil.which('codex')
    if found:
        return found
    for path in ('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
                 '/Applications/Codex.app/Contents/Resources/codex'):
        if Path(path).is_file():
            return path
    raise WorkshopError('未找到 Codex CLI。请先安装或更新 Codex，并使用 ChatGPT 账号登录。', 503)


def codex_env():
    # Preserve the normal Codex login store, but remove API/provider overrides.
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(('OPENAI_', 'CODEX_API_', 'AZURE_OPENAI_')) or key == 'CODEX_ACCESS_TOKEN':
            del env[key]
    return env


def auth_status():
    try:
        result = subprocess.run([codex_path(), 'login', 'status'], env=codex_env(),
                                capture_output=True, text=True, timeout=15)
        output = (result.stdout + result.stderr).lower()
        if result.returncode == 0 and 'chatgpt' in output:
            return {'ready':True, 'method':'chatgpt', 'message':'已登录 ChatGPT，可使用 Codex 订阅额度。'}
        return {'ready':False, 'method':'not-chatgpt', 'message':'请在终端运行 codex login，选择 ChatGPT 登录。本机模式不使用 API Key。'}
    except (OSError, subprocess.TimeoutExpired, WorkshopError):
        return {'ready':False, 'method':'unavailable', 'message':'Codex CLI 暂不可用，请先安装并用 ChatGPT 账号登录。'}


def validate_payload(raw):
    if not isinstance(raw, dict) or raw.get('patentType') not in ('invention','utility'):
        raise WorkshopError('请选择正确的专利类型。')
    if raw.get('model', MODELS[0]) not in MODELS:
        raise WorkshopError('本机模式请选择 GPT-6.2 Sol 或 Astra。')
    files = raw.get('files')
    if not isinstance(files,list) or not 1 <= len(files) <= 8:
        raise WorkshopError('每次选择 1–8 份材料。')
    note = raw.get('note','')
    if not isinstance(note,str) or len(note)>3000:
        raise WorkshopError('补充说明最多 3000 字。')
    total, names, decoded = 0, set(), []
    for file in files:
        if not isinstance(file,dict): raise WorkshopError('文件结构无效。')
        name = file.get('name','')
        if not isinstance(name,str) or not name.strip() or len(name)>160 or re.search(r'[\x00-\x1f/\\]',name):
            raise WorkshopError('文件名无效。')
        if name in names: raise WorkshopError('请重命名重复的文件。')
        names.add(name)
        ext = name.rsplit('.',1)[-1].lower()
        value = file.get('dataUrl','')
        prefix = f'data:{MIMES.get(ext, "")};base64,'
        if ext not in MIMES or not isinstance(value,str) or not value.startswith(prefix):
            raise WorkshopError('文件格式不受支持。')
        try: data = base64.b64decode(value[len(prefix):],validate=True)
        except (ValueError,binascii.Error): raise WorkshopError('文件编码无效。')
        if not data or len(data)>5*1024*1024: raise WorkshopError('每份文件需非空且不超过 5 MB。')
        total += len(data)
        if total>15*1024*1024: raise WorkshopError('文件合计不能超过 15 MB。')
        signatures = {'pdf':b'%PDF-', 'docx':b'PK\x03\x04', 'pptx':b'PK\x03\x04', 'png':b'\x89PNG\r\n\x1a\n', 'jpg':b'\xff\xd8\xff', 'jpeg':b'\xff\xd8\xff'}
        if ext in signatures and not data.startswith(signatures[ext]): raise WorkshopError('文件实际内容与扩展名不符。')
        decoded.append((name,ext,data))
    existing = raw.get('existing',{})
    if not isinstance(existing,dict): raise WorkshopError('已有草稿无效。')
    clean = {}
    for key in FIELDS:
        value = existing.get(key, [] if key=='claims' else '')
        if key=='claims':
            if not isinstance(value,list) or len(value)>30 or any(not isinstance(t,str) or len(t)>10000 for t in value): raise WorkshopError('权利要求草稿过长。')
        elif not isinstance(value,str) or len(value)>20000: raise WorkshopError('已有草稿字段过长。')
        clean[key] = value
    if len(json.dumps(clean,ensure_ascii=False))>60000: raise WorkshopError('已有草稿过长。')
    return {'patentType':raw['patentType'],'model':raw.get('model',MODELS[0]),'note':note,'existing':clean,'files':decoded}


def extract_materials(files, directory):
    texts, images, image_labels = [], [], []
    def add_image(data, extension, label):
        if len(images)>=24: raise WorkshopError('材料含超过 24 张需要识别的图片/图页，请分批上传。')
        path = directory / f'image-{len(images)+1}.{extension}'
        path.write_bytes(data)
        images.append(str(path)); image_labels.append(label)
    for name,ext,data in files:
        if ext in ('txt','md'):
            try: value=data.decode('utf-8-sig')
            except UnicodeDecodeError:
                try: value=data.decode('gb18030')
                except UnicodeDecodeError: raise WorkshopError('文本编码无法识别，请另存为 UTF-8。')
            texts.append({'file':name,'text':value})
        elif ext in ('png','jpg','jpeg'):
            add_image(data,ext,name)
            texts.append({'file':name,'text':'请参考同名图像。'})
        elif ext=='pdf':
            try: import pymupdf
            except ImportError: raise WorkshopError('PDF 组件未安装，请使用“启动康莱德工坊.command”启动。',503)
            with pymupdf.open(stream=data,filetype='pdf') as pdf:
                if pdf.needs_pass: raise WorkshopError('PDF 已加密，请先解除密码。')
                if len(pdf)>30: raise WorkshopError('单份 PDF 最多 30 页，请按课题拆分。')
                pages=[]
                for index,page in enumerate(pdf):
                    value=page.get_text()
                    pages.append(f'第 {index+1} 页：\n{value}')
                    if not value.strip() or page.get_images() or page.get_drawings():
                        scale=min(1.2,1800/max(1,page.rect.width,page.rect.height))
                        pix=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),alpha=False)
                        add_image(pix.tobytes('jpeg'),'jpg',f'{name} 第 {index+1} 页')
                texts.append({'file':name,'text':'\n\n'.join(pages)})
        else:
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    entries=z.infolist()
                    if len(entries)>2000 or sum(i.file_size for i in entries)>40*1024*1024:
                        raise WorkshopError('文档解压后过大，请转为精简 PDF。')
                    xmls = ['word/document.xml'] if ext=='docx' else sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)],key=lambda n:int(re.search(r'(\d+)\.xml$',n).group(1)))
                    paragraphs=[]
                    for index,xml in enumerate(xmls):
                        tree=ET.fromstring(z.read(xml)); rows=[]
                        for para in tree.iter():
                            if para.tag.rsplit('}',1)[-1]=='p':
                                rows.append(''.join(t.text or '' for t in para.iter() if t.tag.rsplit('}',1)[-1]=='t'))
                        paragraphs.append(f'{"正文" if ext=="docx" else "幻灯片 "+str(index+1)}：\n'+'\n'.join(rows))
                    texts.append({'file':name,'text':'\n\n'.join(paragraphs)})
                    for member in entries:
                        if re.match(r'(word|ppt)/media/',member.filename):
                            suffix=member.filename.rsplit('.',1)[-1].lower()
                            if suffix in ('png','jpg','jpeg'):
                                add_image(z.read(member),suffix,f'{name} 内嵌图片 {Path(member.filename).name}（位置需核对）')
            except (zipfile.BadZipFile,KeyError,ET.ParseError): raise WorkshopError('Word/PPT 文件无法解析，请重新保存或转换 PDF。')
    if sum(len(t['text']) for t in texts)>180000: raise WorkshopError('提取后的文字过长，请按课题缩减材料。')
    return texts,images,image_labels


def codex_command(directory, model, images):
    cmd=[codex_path(),'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check',
         '--sandbox','read-only','-C',str(directory),'-m',model,'--color','never']
    overrides=['forced_login_method="chatgpt"','model_provider="openai"','model_reasoning_effort="medium"',
               'features.shell_tool=false','features.apps=false','features.hooks=false',
               'features.browser_use=false','features.computer_use=false','features.view_image=false',
               'features.multi_agent=false','web_search="disabled"','project_doc_max_bytes=0','history.persistence="none"']
    for option in overrides: cmd+=['-c',option]
    cmd+=['--output-schema',str(directory/'schema.json'),'-o',str(directory/'result.json')]
    for image in images: cmd+=['-i',image]
    return cmd+['-']


class Job:
    def __init__(self):
        self.id=uuid.uuid4().hex; self.status='running'; self.message='正在读取材料'
        self.result=None; self.cancelled=threading.Event(); self.process=None; self.created=time.time()
    def cancel(self):
        self.cancelled.set()
        process=self.process
        if process and process.poll() is None:
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            def force_stop():
                if process.poll() is None:
                    try: os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
            timer=threading.Timer(5,force_stop);timer.daemon=True;timer.start()
    def run(self, payload):
        try:
            if not auth_status()['ready']: raise WorkshopError('请先通过 codex login 登录 ChatGPT。本机模式不会改用 API Key。',401)
            with tempfile.TemporaryDirectory(prefix='conrad-patent-') as name:
                directory=Path(name)
                texts,images,labels=extract_materials(payload['files'],directory)
                if self.cancelled.is_set(): raise WorkshopError('任务已取消。')
                (directory/'schema.json').write_text(json.dumps(CONFIG['schema']),encoding='utf-8')
                instructions=CONFIG['prompt']+'\n只整理本次材料并输出 JSON，不使用任何工具，不读取其他文件。未提供的信息必须留空。\n'
                prompt=instructions+json.dumps({'patentType':payload['patentType'],'note':payload['note'],
                    'existingDraft':payload['existing'],'documents':texts,'attachedImagesInOrder':labels},ensure_ascii=False)
                self.message='Codex 正在整理专利字段，使用 ChatGPT 登录额度'
                self.process=subprocess.Popen(codex_command(directory,payload['model'],images),cwd=directory,
                    env=codex_env(),stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,
                    text=True,start_new_session=True)
                if self.cancelled.is_set(): self.cancel()
                try: _,stderr=self.process.communicate(prompt,timeout=600)
                except subprocess.TimeoutExpired:
                    self.cancel(); self.process.communicate()
                    raise WorkshopError('Codex 处理超过 10 分钟，请减少材料后重试。')
                if self.cancelled.is_set(): raise WorkshopError('任务已取消。')
                if self.process.returncode:
                    low=stderr.lower()
                    if any(x in low for x in ['usage limit','rate limit','quota','limit reached']):
                        raise WorkshopError('Codex 订阅用量受限，请在 Codex 中查看用量或等待恢复。未切换为 API 计费。',429)
                    if any(x in low for x in ['login','unauthorized','authentication','token expired']):
                        raise WorkshopError('Codex 登录已失效，请运行 codex login 重新登录 ChatGPT。',401)
                    if 'model' in low and any(x in low for x in ['not supported','not found','not available']):
                        raise WorkshopError('当前 Codex 登录暂不可用所选模型，请切换模型或更新 Codex。')
                    raise WorkshopError('本机 Codex 执行失败。请确认 Codex 能正常对话、网络可用且版本已更新。未使用 API Key。',502)
                result_path=directory/'result.json'
                if not result_path.is_file() or result_path.stat().st_size>1024*1024:
                    raise WorkshopError('Codex 未返回完整字段，请缩减材料重试。',502)
                result=json.loads(result_path.read_text())
                if not isinstance(result,dict) or not isinstance(result.get('fields'),dict):
                    raise WorkshopError('Codex 返回内容不是有效的专利字段。',502)
                self.result=result; self.status='completed'; self.message='Codex 整理完成'
        except WorkshopError as error:
            self.status='cancelled' if self.cancelled.is_set() else 'error'; self.message=str(error)
        except Exception:
            self.status='error'; self.message='材料解析或本机任务未完成，请检查文件格式后重试。'
        finally: self.process=None


class WorkshopServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self, address):
        super().__init__(address,Handler)
        self.token=secrets.token_urlsafe(32); self.jobs={}; self.lock=threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # Never log uploads, prompts, tokens or responses.
    def send_data(self,data,status=200,content_type='application/json; charset=utf-8'):
        body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','no-referrer');self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError): pass
    def guard(self, authenticated=False):
        port=self.server.server_port
        allowed_hosts={f'127.0.0.1:{port}',f'localhost:{port}'}
        if self.headers.get('Host') not in allowed_hosts: raise WorkshopError('Host rejected',403)
        origin=self.headers.get('Origin')
        if origin and origin not in {f'http://{host}' for host in allowed_hosts}: raise WorkshopError('Origin rejected',403)
        if authenticated and not secrets.compare_digest(self.headers.get('Authorization',''),f'Bearer {self.server.token}'):
            raise WorkshopError('请从本机工坊入口重新打开页面。',403)
    def do_OPTIONS(self): self.send_data({'error':'跨站请求不受支持。'},403)
    def do_GET(self):
        try:
            path=unquote(urlsplit(self.path).path)
            self.guard(path.startswith('/local-codex/'))
            if path=='/local-codex/status': return self.send_data(auth_status())
            if path.startswith('/local-codex/jobs/'):
                job=self.server.jobs.get(path.rsplit('/',1)[-1])
                if not job: raise WorkshopError('任务已过期，请重新生成。',404)
                return self.send_data({'status':job.status,'message':job.message,**({'draft':job.result} if job.status=='completed' else {})})
            if path in ('/','/index.html'):
                html=(DIST/'index.html').read_text()
                config=json.dumps({'token':self.server.token,'version':1})
                html=html.replace('<head>','<head><script>window.PATENT_LOCAL_CODEX='+config+';</script>',1)
                return self.send_data(html.encode(),content_type='text/html; charset=utf-8')
            file=(DIST/path.lstrip('/')).resolve()
            if not file.is_relative_to(DIST.resolve()) or not file.is_file(): raise WorkshopError('Not found',404)
            return self.send_data(file.read_bytes(),content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
        except WorkshopError as error: self.send_data({'error':str(error)},error.status)
    def do_POST(self):
        try:
            self.guard(True)
            if self.headers.get('Transfer-Encoding'): raise WorkshopError('Unsupported body',400)
            try: length=int(self.headers.get('Content-Length','0'))
            except ValueError: raise WorkshopError('Invalid length')
            if length<0 or length>MAX_BODY: raise WorkshopError('文件内容过大。',413)
            if not self.headers.get('Content-Type','').startswith('application/json'): raise WorkshopError('JSON required',415)
            self.connection.settimeout(30)
            try: raw=json.loads(self.rfile.read(length))
            except (ValueError,OSError): raise WorkshopError('请求内容不完整。')
            path=urlsplit(self.path).path
            if path=='/local-codex/generate':
                payload=validate_payload(raw)
                with self.server.lock:
                    if any(j.status=='running' for j in self.server.jobs.values()): raise WorkshopError('本机已有任务在运行，请等待或取消后重试。',409)
                    self.server.jobs={k:j for k,j in self.server.jobs.items() if time.time()-j.created<1200}
                    while len(self.server.jobs)>=8: del self.server.jobs[next(iter(self.server.jobs))]
                    job=Job();self.server.jobs[job.id]=job
                threading.Thread(target=job.run,args=(payload,),daemon=True).start()
                return self.send_data({'jobId':job.id},202)
            if path.startswith('/local-codex/cancel/'):
                job=self.server.jobs.get(path.rsplit('/',1)[-1])
                if job: job.cancel()
                return self.send_data({'cancelled':True})
            raise WorkshopError('Not found',404)
        except WorkshopError as error: self.send_data({'error':str(error)},error.status)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--open-browser',action='store_true');args=parser.parse_args()
    server=WorkshopServer(('127.0.0.1',args.port))
    url=f'http://127.0.0.1:{server.server_port}/'
    print('康莱德工坊 · 本机 Codex 模式\n'+url+'\n仅限本机访问；按 Ctrl+C 停止。',flush=True)
    if args.open_browser: webbrowser.open(url)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        for job in server.jobs.values(): job.cancel()
        server.server_close()


if __name__=='__main__': main()
