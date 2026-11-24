(function(root) {
  'use strict';
  const labels = {title:'发明创造名称',technicalField:'技术领域',background:'背景技术',problem:'技术问题',solution:'技术方案',benefits:'有益效果',embodiments:'具体实施方式',claims:'权利要求',abstract:'说明书摘要'};
  const value = (project, key) => key === 'claims' ? (project.claims || []).map(c => c.text) : project[key] || '';
  const empty = v => Array.isArray(v) ? !v.some(s => s.trim()) : !v.trim();
  function snapshot(project) { return Object.fromEntries(Object.keys(labels).map(k => [k, value(project, k)])); }
  function apply(project, changes, before) {
    const prepared = [];
    for (const [key, replacement] of Object.entries(changes)) {
      if (!Object.hasOwn(labels, key)) throw Error('不支持修改此字段。');
      if (JSON.stringify(value(project, key)) !== JSON.stringify(before[key])) throw Error('原字段已发生变化，请关闭审阅面板后重新生成，避免覆盖最新修改。');
      if (key === 'claims') {
        if (!Array.isArray(replacement) || !replacement.length || replacement.length > 30 || replacement.some(s => typeof s !== 'string' || !s.trim() || s.length > 10000)) throw Error('权利要求格式无效。');
        prepared.push([key, replacement.map(text => ({text: text.trim()}))]);
      } else {
        if (typeof replacement !== 'string' || !replacement.trim() || replacement.length > 20000) throw Error('建议字段为空或过长。');
        if (key === 'abstract' && [...replacement].length > 300) throw Error('请先把摘要精简至 300 字以内。');
        if (key === 'title' && replacement.length > 60) throw Error('请先把专利名称精简至 60 字以内。');
        prepared.push([key, replacement.trim()]);
      }
    }
    // Validate all selected changes before applying any, so failure is atomic.
    for (const [key, replacement] of prepared) project[key] = replacement;
    return prepared.length;
  }
  const api = {labels, value, empty, snapshot, apply};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PatentAIFields = api;
})(globalThis);
