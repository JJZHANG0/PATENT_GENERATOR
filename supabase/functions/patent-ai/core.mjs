import {buildRequest, FIELD_LABELS} from './prompt.mjs';

export const MAX_BODY = 22 * 1024 * 1024;
export const TYPES = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new HttpError(400, message); };

export function validateInput(raw) {
  if (!raw || !['utility', 'invention'].includes(raw.patentType)) fail('请选择专利类型。');
  if (!Array.isArray(raw.files) || !raw.files.length || raw.files.length > 8) fail('每次上传 1–8 份文件。');
  if (typeof raw.note !== 'string' || raw.note.length > 3000) fail('补充说明最多 3000 字。');
  let total = 0;
  const names = new Set();
  const files = raw.files.map(f => {
    if (!f || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 160 || /[\x00-\x1f/\\]/.test(f.name)) fail('文件名无效或过长。');
    if (names.has(f.name)) fail('文件名称重复，请重命名后上传。');
    names.add(f.name);
    const ext = f.name.split('.').pop().toLowerCase(), mime = TYPES[ext];
    if (!mime || typeof f.dataUrl !== 'string') fail('不支持此文件格式，请使用 PDF、DOCX、PPTX、TXT、MD、PNG 或 JPG。');
    const prefix = `data:${mime};base64,`;
    if (!f.dataUrl.startsWith(prefix)) fail('文件类型与扩展名不一致。');
    const b64 = f.dataUrl.slice(prefix.length);
    if (!b64.length || b64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) fail('文件内容无效。');
    const size = b64.length * 3 / 4 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (size > 5 * 1024 * 1024) fail('单个文件最多 5 MB。');
    total += size;
    if (total > 15 * 1024 * 1024) fail('每次文件合计最多 15 MB。');
    let head;
    try { head = atob(b64.slice(0, 32)); } catch { fail('文件编码无效。'); }
    if ((ext === 'pdf' && !head.startsWith('%PDF-')) ||
        (['docx', 'pptx'].includes(ext) && !head.startsWith('PK\x03\x04')) ||
        (ext === 'png' && !head.startsWith('\x89PNG\r\n\x1a\n')) ||
        (['jpg', 'jpeg'].includes(ext) && !head.startsWith('\xff\xd8\xff'))) fail('文件内容与格式不匹配，请重新导出。');
    return {name: f.name, mime, dataUrl: f.dataUrl};
  });
  const existing = {};
  for (const key of Object.keys(FIELD_LABELS)) {
    const value = raw.existing?.[key];
    if (key === 'claims') {
      if (value != null && (!Array.isArray(value) || value.length > 30 || value.some(v => typeof v !== 'string' || v.length > 10000))) fail('已有权利要求过长。');
      existing[key] = value || [];
    } else {
      if (value != null && (typeof value !== 'string' || value.length > 20000)) fail('已有技术字段过长，请先精简。');
      existing[key] = value || '';
    }
  }
  if (JSON.stringify(existing).length > 60000) fail('已有技术草稿过长，请先精简或不附带已有草稿。');
  return {patentType: raw.patentType, note: raw.note, files, existing};
}

export function validateOutput(raw, input) {
  const bad = () => { throw new HttpError(502, 'AI 未返回完整、可用的字段，请精简材料后重试。'); };
  const text = (v, max) => { if (typeof v !== 'string' || v.length > max) bad(); return v.trim(); };
  const list = (v, max, length) => { if (!Array.isArray(v) || v.length > max) bad(); return v.map(s => text(s, length)); };
  if (!raw || !raw.fields || !['invention', 'utility', 'uncertain'].includes(raw.recommendedType)) bad();
  const result = {summary: text(raw.summary, 4000), recommendedType: raw.recommendedType,
    typeReason: text(raw.typeReason, 2000), fields: {}, questions: list(raw.questions, 50, 2000), warnings: list(raw.warnings, 50, 2000)};
  const names = new Set(input.files.map(f => f.name));
  if (Object.values(input.existing).some(v => Array.isArray(v) ? v.some(Boolean) : Boolean(v))) names.add('已有草稿');
  for (const key of Object.keys(FIELD_LABELS)) {
    const f = raw.fields[key];
    if (!f || !['supported', 'needs_confirmation', 'missing'].includes(f.status) || !Array.isArray(f.evidence) || f.evidence.length > 30) bad();
    const value = key === 'claims' ? list(f.value, 30, 10000) : text(f.value, 20000);
    const evidence = f.evidence.map(e => ({file: text(e.file, 160), location: text(e.location, 300), excerpt: text(e.excerpt, 1200)}));
    let status = f.status, note = text(f.note, 3000);
    const hasValue = key === 'claims' ? value.length > 0 : Boolean(value);
    if (!hasValue) status = 'missing';
    if (hasValue && (status === 'missing' || !evidence.length || evidence.some(e => !names.has(e.file) || !e.excerpt))) {
      status = 'needs_confirmation';
      note += '\n缺少有效来源线索，需人工核对。';
    }
    result.fields[key] = {value, status, evidence, note: note.trim()};
  }
  const flag = (key, warning) => {
    result.fields[key].status = 'needs_confirmation';
    result.fields[key].note += '\n' + warning;
    result.warnings.push(warning);
  };
  if ([...result.fields.abstract.value].length > 300) flag('abstract', '摘要超过 300 字，采纳前请精简。');
  result.fields.claims.value.forEach((c, i) => {
    if ([...c.matchAll(/权利要求\s*(\d+)/g)].some(m => +m[1] >= i + 1)) flag('claims', `权利要求 ${i + 1} 存在不合理的引用顺序。`);
    if (input.patentType === 'utility' && /^\s*(?:\d+[.、．]\s*)?一种[^。；]*方法/.test(c)) flag('claims', '实用新型权利要求出现方法主题，请核对申请类型和保护对象。');
  });
  if (result.recommendedType !== 'uncertain' && result.recommendedType !== input.patentType) result.warnings.push('材料建议的专利类型与当前选择不同。系统未改变你的申请类型。');
  result.warnings = [...new Set(result.warnings)];
  return result;
}

async function readJSON(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, '请求必须使用 JSON。');
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new HttpError(413, '上传内容过大。');
  if (!request.body) fail('缺少上传内容。');
  const reader = request.body.getReader(), chunks = [];
  let count = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > MAX_BODY) { await reader.cancel(); throw new HttpError(413, '上传内容过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { fail('上传内容不是有效 JSON。'); }
}

export function createHandler({authenticate, reserveQuota, apiKey, model = 'gpt-5.4-mini', allowedOrigins, fetchImpl = fetch}) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin'};
    if (origin && !allowedOrigins.includes(origin)) return new Response(JSON.stringify({error: '此网站未获准访问工坊后台。'}), {status: 403, headers});
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    try {
      if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, '不支持此请求方式。');
      const bearer = request.headers.get('authorization') || '';
      if (!/^Bearer \S+$/i.test(bearer)) throw new HttpError(401, '请先使用队伍账号登录。');
      const account = await authenticate(bearer);
      if (!account?.userId) throw new HttpError(401, '登录已失效，请重新登录。');
      if (request.method === 'GET') return new Response(JSON.stringify({account}), {headers});
      if (!apiKey?.startsWith('sk-')) throw new HttpError(503, '工坊尚未配置 AI 密钥，请联系管理员。');
      const input = validateInput(await readJSON(request));
      const quota = await reserveQuota(account.userId);
      // Count every upstream attempt, including errors/cancellation, to bound costs.
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(buildRequest(input, model)), signal: AbortSignal.timeout(110000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpError(429, 'AI 服务额度或调用频率受限，请稍后重试或联系管理员。');
        if ([401, 403].includes(response.status)) throw new HttpError(503, 'AI 密钥或模型权限不可用，请联系管理员。');
        if (response.status === 400) throw new HttpError(422, 'AI 无法处理本次材料，请检查文件是否加密、损坏或过长，并尝试转为 PDF。');
        throw new HttpError(502, 'AI 服务暂不可用，请稍后重试。');
      }
      const output = await response.json();
      if (output.status !== 'completed') throw new HttpError(502, 'AI 输出未完成，请减少文件或缩小课题范围后重试。');
      const parts = (output.output || []).flatMap(o => o.content || []);
      if (parts.some(p => p.type === 'refusal')) throw new HttpError(422, 'AI 未能处理本次材料，请核对材料内容后重试。');
      let raw;
      try { raw = JSON.parse(parts.filter(p => p.type === 'output_text').map(p => p.text).join('')); }
      catch { throw new HttpError(502, 'AI 返回格式异常，请稍后重试。'); }
      return new Response(JSON.stringify({draft: validateOutput(raw, input), quota}), {headers});
    } catch (error) {
      const timedOut = ['TimeoutError', 'AbortError'].includes(error?.name);
      const status = error instanceof HttpError ? error.status : timedOut ? 504 : 500;
      const message = error instanceof HttpError ? error.message : timedOut ? 'AI 处理超时，请减少文件后重试。' : '后台处理未完成，请稍后重试或联系管理员。';
      // Never return upstream exception bodies, documents, credentials or stack traces.
      return new Response(JSON.stringify({error: message}), {status, headers});
    }
  };
}
