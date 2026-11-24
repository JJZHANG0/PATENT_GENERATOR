import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

import local_codex as bridge


def payload():
    return {'patentType':'invention','model':'gpt-6.2-sol','note':'','existing':{},
            'files':[{'name':'交底.txt','dataUrl':'data:text/plain;base64,'+base64.b64encode('外壳连接探头'.encode()).decode()}]}


class LocalCodexTests(unittest.TestCase):
    def test_credentials_are_not_inherited(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY':'dummy','CODEX_API_KEY':'dummy','CODEX_ACCESS_TOKEN':'dummy','OPENAI_BASE_URL':'https://example.test'}):
            env=bridge.codex_env()
            self.assertNotIn('OPENAI_API_KEY',env);self.assertNotIn('CODEX_API_KEY',env)
            self.assertNotIn('CODEX_ACCESS_TOKEN',env);self.assertNotIn('OPENAI_BASE_URL',env)
            self.assertEqual(env.get('HOME'),os.environ.get('HOME'))

    def test_only_chatgpt_login_and_restricted_cli(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bridge,'codex_path',return_value='/test/codex'):
            cmd=bridge.codex_command(Path(directory),'gpt-6.2-sol',[])
            for arg in ['forced_login_method="chatgpt"','features.shell_tool=false','features.apps=false','features.view_image=false','--ephemeral','--ignore-user-config','read-only']:
                self.assertIn(arg,cmd)
            self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',cmd)

    def test_reject_path_duplicate_and_invalid_model(self):
        for change in [lambda p:p.update(model='evil'),lambda p:p['files'][0].update(name='../secret.txt'),lambda p:p['files'].append(p['files'][0])]:
            p=payload();change(p)
            with self.assertRaises(bridge.WorkshopError): bridge.validate_payload(p)

    def test_plain_text_and_personal_fields_filtered(self):
        p=payload();p['existing']['idNumber']='private'
        parsed=bridge.validate_payload(p)
        self.assertNotIn('idNumber',parsed['existing'])
        with tempfile.TemporaryDirectory() as directory:
            texts,images,labels=bridge.extract_materials(parsed['files'],Path(directory))
            self.assertIn('外壳连接探头',texts[0]['text']);self.assertEqual(images,[])

    def test_docx_text_extraction(self):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as z:z.writestr('word/document.xml','<document><p><r><t>技术方案</t></r></p></document>')
        with tempfile.TemporaryDirectory() as directory:
            texts,images,labels=bridge.extract_materials([('交底.docx','docx',buffer.getvalue())],Path(directory))
            self.assertIn('技术方案',texts[0]['text'])

    @unittest.skipUnless(importlib.util.find_spec('pymupdf'),'PDF dependency not installed in this test environment')
    def test_pdf_text_and_diagram_extraction(self):
        import pymupdf
        pdf=pymupdf.open();page=pdf.new_page();page.insert_text((30,30),'Test structure');page.draw_rect(pymupdf.Rect(30,60,120,130));data=pdf.tobytes();pdf.close()
        with tempfile.TemporaryDirectory() as directory:
            texts,images,labels=bridge.extract_materials([('结构.pdf','pdf',data)],Path(directory))
            self.assertIn('Test structure',texts[0]['text']);self.assertEqual(len(images),1)
            self.assertIn('第 1 页',labels[0]);self.assertTrue(Path(images[0]).is_file())

    def test_local_http_requires_token_host_and_origin(self):
        server=bridge.WorkshopServer(('127.0.0.1',0));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(url) as response:
                html=response.read().decode();self.assertIn('PATENT_LOCAL_CODEX',html)
                self.assertEqual(response.headers['X-Frame-Options'],'DENY')
            for headers in [{},{'Authorization':'Bearer '+server.token,'Origin':'https://evil.example'},
                            {'Authorization':'Bearer '+server.token,'Host':'evil.example'}]:
                with self.assertRaises(HTTPError) as e:urlopen(Request(url+'/local-codex/status',headers=headers))
                self.assertEqual(e.exception.code,403)
            with patch.object(bridge,'auth_status',return_value={'ready':True,'method':'chatgpt'}):
                result=json.load(urlopen(Request(url+'/local-codex/status',headers={'Authorization':'Bearer '+server.token})))
                self.assertTrue(result['ready'])
            with self.assertRaises(HTTPError):urlopen(url+'/%2e%2e/scripts/local_codex.py')
            with self.assertRaises(HTTPError):urlopen(Request(url+'/local-codex/generate',data=b'{}',headers={'Authorization':'Bearer '+server.token,'Content-Type':'application/json'}))
        finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
