(function(root) {
  'use strict';
  const fields = root.PatentAIFields;
  function prepare(source, draft) {
    const project = structuredClone(source), notes = [...draft.warnings, ...draft.questions];
    project.id = crypto.randomUUID(); project.example = false;
    project.createdAt = project.updatedAt = new Date().toISOString();
    project.pageCounts = Object.fromEntries(Object.keys(project.pageCounts || {}).map(k => [k, '']));
    let filled = 0;
    for (const [key, label] of Object.entries(fields.labels)) {
      const field = draft.fields[key];
      if (field.status !== 'supported' || fields.empty(field.value)) {
        notes.push(`${label}：${field.note || '材料不足或尚需确认，未自动填入不确定内容。'}`);
        continue;
      }
      try { fields.apply(project, {[key]:field.value}, fields.snapshot(project)); filled++; }
      catch (e) { notes.push(`${label}：${e.message}`); }
    }
    project.title ||= 'AI 专利草稿';
    project.aiReview = {summary:draft.summary, notes:[...new Set(notes)], fields:draft.fields};
    return {project, notes:project.aiReview.notes, filled};
  }
  async function build(source, draft, getIssues) {
    const prepared = prepare(source, draft), {project, notes} = prepared;
    const checks = [...new Set([...getIssues(project).map(i => i.message), ...notes])];
    const isDraft = checks.length > 0;
    const files = await root.PatentExport.generate(project, {draft:isDraft});
    const zip = new root.JSZip();
    for (const file of files) zip.file(file.name, file.blob);
    const report = ['康莱德工坊 · AI 自动编制检查清单', `专利：${project.title}`,
      `类型：${project.type === 'utility' ? '实用新型' : '发明专利'}`,
      `状态：${isDraft ? '待补充 / 待核对草稿' : '自动检查未发现缺项的 Word 审阅包'}`,
      '', '本次生成的 Word 文书：', ...files.map(f => '- ' + f.name), '',
      '待补充 / 待核对：', ...(checks.length ? checks.map(x => '- ' + x) : ['- 自动检查未发现缺项；仍需核对技术内容及实际分页。']),
      ...(!project.figures.length ? ['', '附图尚未提供：未伪造或生成技术附图；实用新型在提交前必须补齐结构附图。'] : []),
      '', '说明：仅自动采用材料支持且通过字段校验的内容；未确认的建议保存在 AI整理依据.json。',
      '人员、证件、签名、实际页数和未提供的实验数据不会自动编造。',
      '打开 Word/WPS 核对分页、字体、技术内容与权利归属。电子申请需按官方流程转换、校验并提交。',
      '本材料包不代表申请已提交或通过专利实质审查。'];
    zip.file('自动检查与待补清单.txt', report.join('\n'));
    zip.file('AI整理依据.json', JSON.stringify(draft,null,2));
    zip.file('课题备份.json', JSON.stringify({format:'zhixu-patent-studio',version:1,projects:[project],exports:[]},null,2));
    const blob = await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    const safeTitle = project.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90);
    return {...prepared, blob, checks, count:files.length, draft:isDraft,
      name:`${safeTitle}-AI${isDraft ? '草稿材料包' : 'Word审阅包'}.zip`};
  }
  const api = {prepare, build};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PatentAIPackage = api;
})(globalThis);
