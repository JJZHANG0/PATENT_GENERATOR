import {buildRequest, FIELD_LABELS} from './ai-prompt.mjs';

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

export function validateKey(key) {
  if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{10,}$/.test(key) || key.length > 600) {
    throw new Error('请填写以 sk- 开头的完整 OpenAI API Key；key_ 开头的 tracking ID 不能调用 API。');
  }
  return key;
}

const ERROR_REASONS = {
  credit_balance_exhausted: ['余额已耗尽', 'OpenAI 明确返回预付 API 余额已耗尽。请查看该 Key 所属组织的 API 账单；充值或更换有额度的 Key 后再试。', 'https://platform.openai.com/settings/organization/billing/overview'],
  organization_spend_limit_exceeded: ['组织消费上限', 'OpenAI 返回组织消费上限已达到，不代表余额为零。请检查该组织的消费上限。', 'https://platform.openai.com/settings/organization/limits'],
  project_spend_limit_exceeded: ['项目消费上限', 'OpenAI 返回当前项目消费上限已达到，不代表余额为零。请检查该 Key 所属项目的消费设置。', 'https://platform.openai.com/settings/'],
  organization_usage_limit_exceeded: ['组织用量上限', 'OpenAI 返回组织获批的用量上限已达到，请查看组织 Limits 或申请提高限制。', 'https://platform.openai.com/settings/organization/limits'],
  billing_hard_limit_reached: ['计费上限', 'OpenAI 返回 API 计费上限已达到，请检查所属组织的计费和消费限制。', 'https://platform.openai.com/settings/organization/limits'],
  insufficient_quota: ['API 额度不可用', 'OpenAI 返回 insufficient_quota：当前 Key 所属组织或项目的 API 额度不可用。需要核对账单、余额及消费限制，不能仅凭此代码断定余额为零。', 'https://platform.openai.com/settings/organization/billing/overview'],
  rate_limit_exceeded: ['临时限流', 'OpenAI 返回调用频率或每分钟 token 限制。请等待后重试，或减少本次文件量；这不是余额不足。', 'https://platform.openai.com/settings/organization/limits'],
  slow_down: ['调用增长过快', 'OpenAI 要求放慢调用速度，请等待后重试；这不是余额不足。', 'https://platform.openai.com/settings/organization/limits'],
};
export async function parseAPIError(response) {
  let body; try { body = await response.json(); } catch { body = {}; }
  const raw = body?.error || {};
  // Do not return the raw message: it may echo a Key, uploaded text or account IDs.
  const known = Object.hasOwn(ERROR_REASONS, raw.code) ? raw.code :
    raw.type === 'insufficient_quota' ? 'insufficient_quota' :
    raw.type === 'rate_limit_error' ? 'rate_limit_exceeded' : 'unknown';
  const oversized = known === 'rate_limit_exceeded' && /request too large|exceed.*tokens per min|reduce.*tokens/i.test(String(raw.message || ''));
  let [title, message, link] = ERROR_REASONS[known] || ['请求未完成', 'OpenAI 请求未完成，请稍后重试。', ''];
  if (known === 'unknown') {
    if (response.status === 429) { title = '429 原因未明确'; message = 'OpenAI 返回 429，但未提供可识别的具体原因，暂不能判断是额度还是限流。请下载诊断信息，并检查当前 Key 的 API 项目状态。'; link = 'https://platform.openai.com/settings/'; }
    if (response.status === 401) message = 'API Key 无效或已过期，请更换完整 secret。';
    if (response.status === 403) message = '当前账号、地区或项目没有此次请求的访问权限。';
    if (response.status === 404) message = '当前 Key 无法访问所选模型，请检查项目权限或选择其他模型。';
    if (response.status === 400) message = '请求参数或文件不受支持，请检查文件是否加密、损坏或过长，必要时转成 PDF。';
  }
  if (oversized) message = '本次请求的 token 量超过当前模型的限流额度。等待通常不能解决，请减少文件数量或长度后重试；这不是余额不足。';
  const header = response.headers.get('retry-after');
  const delay = header == null ? 3 : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : Math.max(0, (Date.parse(header) - Date.now()) / 1000);
  const retryAfter = Number.isFinite(delay) ? Math.min(86400, Math.ceil(delay)) : 3;
  const requestId = response.headers.get('x-request-id') || '';
  const diagnostic = {status:response.status, code:known, retryAfterSeconds:retryAfter,
    requestId:/^req_[A-Za-z0-9_-]{1,120}$/.test(requestId) ? requestId : '', at:new Date().toISOString()};
  const error = new Error(message);
  Object.assign(error, {title, link, diagnostic, retryAfter,
    retryable:response.status === 429 && !oversized && ['rate_limit_exceeded','slow_down'].includes(known)});
  return error;
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, {once:true});
  });
}

export async function requestDraft({apiKey, input, model = 'gpt-6.2-sol', signal, fetchImpl = fetch, onRetry = () => {}, sleepImpl = delay}) {
  validateKey(apiKey);
  if (!['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-5.4-mini', 'gpt-5.4'].includes(model)) throw new Error('请选择支持的模型。');
  const validated = validateInput(input);
  const body = JSON.stringify(buildRequest(validated, model));
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST', headers:{Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json'},
      body, signal, credentials:'omit', redirect:'error', referrerPolicy:'no-referrer',
    });
    if (response.ok) break;
    const error = await parseAPIError(response);
    if (attempt === 0 && error.retryable && error.retryAfter <= 30) {
      onRetry({seconds:error.retryAfter, code:error.diagnostic.code});
      await sleepImpl(error.retryAfter * 1000, signal);
    } else throw error;
  }
  let output;
  try { output = await response.json(); } catch { throw new Error('AI 返回格式异常，请稍后重试。'); }
  if (output.status !== 'completed') throw new Error('AI 输出未完成，请减少文件或缩小课题范围后重试。');
  const parts = (output.output || []).flatMap(o => o.content || []);
  if (parts.some(p => p.type === 'refusal')) throw new Error('AI 未能处理本次材料，请核对材料内容后重试。');
  let raw;
  try { raw = JSON.parse(parts.filter(p => p.type === 'output_text').map(p => p.text).join('')); }
  catch { throw new Error('AI 返回格式异常，请稍后重试。'); }
  return validateOutput(raw, validated);
}
