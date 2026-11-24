(function() {
  'use strict';
  const fields = window.PatentAIFields, localCodex = window.PatentLocalCodex;
  let engine = localCodex?.available ? 'local' : 'choose';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',md:'text/markdown',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
  let adapter, apiKey = '', model = 'gpt-6.2-sol', resumeUpload = false, selectedFiles = [], pending = null, controller = null, busy = false, targetId = null, baseline = null;
  let formOptions = {note:'',include:true,delivery:'package'}, lastDiagnostic = null, artifact = null;
  function dialog() { return $('#ai-dialog'); }
  function error(message) { const el = $('#ai-error'); if (el) { el.textContent = message; el.focus(); } }
  function show(html) {
    dialog().innerHTML = `<div class="ai-dialog-head"><span class="eyebrow">CONRAD · PATENT AI</span><button class="icon-btn" data-ai="close" aria-label="关闭 AI 面板">×</button></div>${html}<p id="ai-error" class="ai-error" role="alert" tabindex="-1"></p>`;
    if (!dialog().open) dialog().showModal();
  }
  function close() {
    if (busy) return error('正在处理。请先取消生成，再关闭面板。');
    const keyInput = $('#ai-key'); if (keyInput) keyInput.value = '';
    dialog().close(); dialog().innerHTML = ''; selectedFiles = []; pending = null; baseline = null; targetId = null; artifact = null; lastDiagnostic = null;
  }
  function header() {
    return `<button class="btn small ai-account-button" data-ai="settings">${engine === 'local' ? '本机 Codex' : apiKey ? 'AI 已配置' : 'AI 设置'}<span class="ai-dot ${engine === 'local' || apiKey ? 'online' : ''}"></span></button>`;
  }
  function settingsPanel(continueUpload = false) {
    resumeUpload = continueUpload;
    if (engine !== 'api') return localSettings();
    show(`<h2>使用自己的 OpenAI Key</h2><p>无需注册工坊账号。每位使用者填写自己的 Key，API 费用由各自的 OpenAI 账号承担。</p><form id="ai-settings"><div class="field"><label for="ai-key">OpenAI API Key</label><input id="ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="600" placeholder="${apiKey ? '已配置；留空保留当前 Key，输入可更换' : '粘贴以 sk- 开头的完整 secret'}" ${apiKey ? '' : 'required'}><small>需要完整 secret；key_ 开头的 tracking ID 无法使用。</small></div><div class="field"><label for="ai-model">生成模型</label><select id="ai-model"><option value="gpt-6.2-sol" ${model === 'gpt-6.2-sol' ? 'selected' : ''}>GPT-6.2 Sol · 专利整理（推荐）</option><option value="gpt-6.2-astra" ${model === 'gpt-6.2-astra' ? 'selected' : ''}>GPT-6.2 Astra · 复杂材料（费用较高）</option><option value="gpt-5.4-mini" ${model === 'gpt-5.4-mini' ? 'selected' : ''}>GPT-5.4 mini · 经济方案</option><option value="gpt-5.4" ${model === 'gpt-5.4' ? 'selected' : ''}>GPT-5.4 · 备选模型</option></select><small>模型能否调用取决于你自己的 API 账号权限和额度；工坊不会自动切换到其他模型。</small></div><div class="ai-info">Key 仅在当前页面内存中使用，刷新或关闭后清除，不写入草稿、备份或浏览器存储。文件由你的浏览器直接发送到 OpenAI，不经过工坊后台。请只在你信任的设备和此工坊页面输入自己的 Key。</div><p class="ai-muted">保存设置不会发起 API 请求。只有点击“开始整理并生成”时才会使用额度。</p><div class="actions">${apiKey ? '<button type="button" class="btn" data-ai="clear-key">清除 Key</button>' : ''}<a class="btn" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">管理自己的 Key</a><button class="btn primary" type="submit">${continueUpload ? '使用此 Key，继续上传' : '仅本次使用'}</button></div></form>`);
  }
  function localSettings() {
    if (!localCodex?.available) {
      show(`<h2>使用本机 Codex，无需 API Key</h2><p>让这台电脑已登录的 Codex 整理文件，再由工坊自动生成 Word。使用 ChatGPT/Codex 订阅额度，模型推理仍需联网。</p><div class="ai-info">先双击电脑里的“启动康莱德工坊.command”，再打开本机工坊。GitHub Pages 无法直接运行你电脑上的 Codex。<br>第一次在其他电脑使用：下载源码 ZIP、解压，安装并登录 Codex 后运行启动文件。</div><div class="actions"><a class="btn" href="https://github.com/JJZHANG0/PATENT_GENERATOR/archive/refs/heads/main.zip" target="_blank" rel="noopener noreferrer">下载本机版</a><a class="btn primary" href="http://127.0.0.1:8765/" target="_blank" rel="noopener noreferrer">打开本机工坊</a></div><p class="ai-muted">本机网址与在线网址的浏览器草稿分别保存。需要迁移时，先备份再导入。</p><button class="btn" data-ai="use-api">其他方式：使用自己的 API Key</button>`);
      return;
    }
    show(`<h2>本机 Codex 已接入</h2><p id="local-status" role="status">正在检查 ChatGPT 登录状态…</p><form id="local-settings"><div class="field"><label for="local-model">Codex 模型</label><select id="local-model"><option value="gpt-6.2-sol" ${model==='gpt-6.2-sol'?'selected':''}>GPT-6.2 Sol · 专利整理</option><option value="gpt-6.2-astra" ${model==='gpt-6.2-astra'?'selected':''}>GPT-6.2 Astra · 复杂材料</option></select></div><div class="ai-info">无需 API Key，不读取 API 余额。任务由这台电脑的官方 Codex CLI 处理，使用其 ChatGPT 登录和订阅用量。文件会在本机解析；文字和需识别的图片会交给 Codex 云端模型，任务临时文件完成后清除。</div><button type="submit" class="btn primary">${resumeUpload?'继续上传材料':'使用本机 Codex'}</button></form>`);
    localCodex.status().then(status=>{const el=$('#local-status');if(el)el.textContent=status.message;}).catch(e=>error(e.message));
  }
  function saveLocalSettings() {
    model = $('#local-model').value; engine='local'; apiKey=''; adapter.render();
    if(resumeUpload)start(true);else close();
  }
  async function saveSettings() {
    const field = $('#ai-key'), nextKey = field.value.trim();
    busy = true;
    try {
    if (nextKey) {
      const {validateKey} = await import('./ai-core.mjs?v=20261124-local1');
      validateKey(nextKey);
      apiKey = nextKey;
    }
    if (!apiKey) throw Error('请填写自己的 OpenAI API Key。');
    model = $('#ai-model').value;
    field.value = '';
    adapter.render();
    busy = false;
    if (resumeUpload) start(true);
    else { close(); adapter.toast('Key 仅用于本次页面，尚未发起 API 请求。'); }
    } finally { busy = false; }
  }
  function clearKey() {
    apiKey = '';
    const field = $('#ai-key'); if (field) field.value = '';
    adapter.render(); settingsPanel(resumeUpload);
    adapter.toast('已清除当前页面的 Key。专利草稿仍然保留。');
  }
  function start(preserve = false) {
    if (engine !== 'local' && !apiKey) return settingsPanel(true);
    const project = (preserve && targetId && adapter.project(targetId)) || adapter.ensureProject('个人课题');
    targetId = project.id; baseline = fields.snapshot(project);
    if (!preserve) { selectedFiles = []; pending = null; artifact = null; formOptions = {note:'',include:true,delivery:'package'}; }
    show(`<h2>上传材料，直接生成专利文件</h2><p>项目报告、技术交底、实验记录与结构图，可以一起上传。</p><form id="ai-generate"><div class="ai-upload"><span class="ai-upload-icon">↥</span><strong>选择一份或多份技术材料</strong><span>PDF · DOCX · PPTX · TXT · MD · PNG · JPG</span><label class="btn primary" for="ai-files">添加文件</label><input id="ai-files" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg" multiple><small>最多 8 份，单份 5 MB，合计 15 MB</small></div><div id="ai-file-list" class="ai-file-list"></div><p class="ai-muted">${engine === 'local' ? '本机读取 PDF 图页及 Word / PPT 中的 PNG、JPG 图片；单份 PDF 最多 30 页，共最多 24 张需识别图像。' : '含结构图的 Word / PPT 请优先转成 PDF；非 PDF 文档只提取文字。'}加密文件请先解除密码。</p><div class="field"><label for="ai-type">本次起草的专利类型</label><select id="ai-type" disabled><option>${project.type === 'utility' ? '实用新型专利' : '发明专利'}</option></select><small>与当前专利一致。需要调整时，请先在“专利信息”中修改。</small></div><div class="field"><label for="ai-note">希望重点整理什么？<span class="ai-muted">（选填）</span></label><textarea id="ai-note" rows="3" maxlength="3000" placeholder="例如：重点突出检测装置的结构关系；报告中的第二版方案为准。">${esc(formOptions.note)}</textarea></div><div class="field"><label for="ai-output">生成方式</label><select id="ai-output"><option value="package" ${formOptions.delivery === 'package' ? 'selected' : ''}>自动整理并直接下载 Word 材料包</option><option value="review" ${formOptions.delivery === 'review' ? 'selected' : ''}>先逐项审阅，再自行导出</option></select></div><label class="ai-check"><input type="checkbox" id="ai-include" ${formOptions.include ? 'checked' : ''}><span>同时参考当前专利的已有技术草稿（不发送人员、证件和联系信息）</span></label><label class="ai-check"><input type="checkbox" id="ai-consent" required><span>我有权使用这些材料，同意将所选文件、补充说明及勾选的草稿${engine === 'local' ? '交给本机 Codex 整理（使用订阅额度，模型推理需联网）' : '直接发送至 OpenAI API 处理'}。</span></label><div class="ai-info">AI 会整理技术说明、权利要求与摘要，列出来源线索和待补问题。默认自动采用有材料依据且通过检查的内容，套用模板生成独立材料包，保留原专利。缺失的人员、签署、实验数据或附图会列入待补清单，不会编造。</div><div class="ai-bottom"><span>${engine === 'local' ? '使用本机 Codex · ChatGPT 订阅额度' : '使用你自己的 '+esc(model)+' API 额度'}<br>已开始的任务即使取消，也可能计入相应服务的用量。</span><button class="btn primary" type="submit">开始整理并生成 →</button></div></form>`);
    listFiles();
  }
  function listFiles() {
    $('#ai-file-list').innerHTML = selectedFiles.map((file, i) => `<div class="ai-file"><span><strong>${esc(file.name)}</strong><small>${(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button class="icon-btn" data-ai="remove-file" data-index="${i}" aria-label="移除 ${esc(file.name)}">×</button></div>`).join('');
  }
  function addFiles(files) {
    const next = [...selectedFiles];
    for (const f of files) {
      if (!types[f.name.split('.').pop().toLowerCase()]) throw Error(`${f.name}：不支持此格式，请转成 PDF。`);
      if (!f.size || f.size > 5 * 1024 * 1024) throw Error(`${f.name}：请使用非空且不超过 5 MB 的文件。`);
      if (f.name.length > 160 || /[\x00-\x1f/\\]/.test(f.name)) throw Error('请缩短文件名，并去掉特殊路径字符。');
      if (next.some(v => v.name === f.name)) throw Error('文件名称重复，请重命名后添加。');
      next.push(f);
    }
    if (next.length > 8 || next.reduce((n,f) => n + f.size, 0) > 15 * 1024 * 1024) throw Error('每次最多 8 份文件，合计不超过 15 MB。');
    selectedFiles = next; listFiles(); error('');
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Error(`无法读取 ${file.name}`));
      reader.onload = () => resolve({name:file.name,dataUrl:`data:${types[file.name.split('.').pop().toLowerCase()]};base64,${String(reader.result).split(',')[1]}`});
      reader.readAsDataURL(file);
    });
  }
  function readableError(e) {
    return ['TimeoutError','AbortError'].includes(e.name) ? '请求已取消或超时。已发出的请求可能仍计入用量，请稍后再试。' : e instanceof TypeError ? '网络连接失败，请检查网络后重试。' : e.message;
  }
  async function generate(retry = false) {
    if (!selectedFiles.length) return error('请先添加至少一份技术材料。');
    if (!retry && !$('#ai-consent').checked) return error('请先确认材料处理授权。');
    const project = adapter.project(targetId);
    if (!project) return error('当前专利不存在，请重新打开。');
    if (!retry) formOptions = {note:$('#ai-note').value,include:$('#ai-include').checked,delivery:$('#ai-output').value};
    const note = formOptions.note, existing = formOptions.include ? fields.snapshot(project) : {};
    lastDiagnostic = null; pending = null; artifact = null;
    baseline = fields.snapshot(project);
    busy = true; controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), engine === 'local' ? 660000 : 300000);
    show(`<div class="ai-progress"><div class="ai-spinner"></div><h2>正在读取材料</h2><p id="ai-progress-text" role="status" aria-live="polite">准备上传所选文件…</p><p>AI 将梳理技术方案、起草字段并整理依据。复杂材料可能需要数分钟，完成后自动检查并按所选方式生成材料。</p><button class="btn" data-ai="cancel">取消本次生成</button></div>`);
    try {
      const files = await Promise.all(selectedFiles.map(readFile));
      const {requestDraft} = await import('./ai-core.mjs?v=20261124-local1');
      activeController.signal.throwIfAborted();
      $('#ai-progress-text').textContent = '已读取文件，正在上传并请求 AI 整理专利建议稿…';
      const input = {patentType:project.type,note,existing,files};
      if (engine === 'local') {
        pending = await localCodex.generate(input,model,activeController.signal,message=>{const el=$('#ai-progress-text');if(el)el.textContent=message;});
      } else {
      pending = await requestDraft({apiKey, model, input,signal:activeController.signal,onRetry:({seconds})=>{ $('#ai-progress-text').textContent = `OpenAI 暂时限流，等待 ${seconds} 秒后自动重试一次（不是余额不足）…`; }});
      }
      if (formOptions.delivery === 'package') await producePackage();
      else { selectedFiles = []; review(); }
    } catch (e) {
      if (pending) packageFailure(e);
      else {
        lastDiagnostic = e.diagnostic ? {...e.diagnostic,model,fileCount:selectedFiles.length} : null;
        show(`<h2>${esc(e.title || '本次生成未完成')}</h2><p>${esc(readableError(e))}</p>${lastDiagnostic ? `<div class="ai-info">HTTP ${lastDiagnostic.status} · 错误代码：${esc(lastDiagnostic.code)}${lastDiagnostic.requestId ? `<br>请求编号：${esc(lastDiagnostic.requestId)}` : ''}</div>` : ''}<p>已保留本次 ${selectedFiles.length} 份文件和补充说明，无需重新上传。原专利没有被覆盖。</p><div class="actions">${e.link ? `<a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">查看对应 API 设置</a>` : ''}<button class="btn" data-ai="retry-settings">${engine === 'local' ? '检查登录 / 更换模型' : '更换 Key / 模型'}</button><button class="btn" data-ai="edit-upload">调整材料</button><button class="btn primary" data-ai="retry">保留材料重试</button></div>${lastDiagnostic ? '<button class="btn" data-ai="diagnostic">下载诊断信息（不含密钥）</button>' : ''}`);
      }
    } finally { clearTimeout(timeout); busy = false; controller = null; }
  }
  function packageFailure(e) {
    show(`<h2>AI 已整理完成，Word 打包未完成</h2><p>${esc(readableError(e))}</p><p>AI 结果已保留，重新打包不会再调用 OpenAI，也不会再次使用 AI 额度。</p><button class="btn primary" data-ai="retry-package">重新生成 Word 材料包</button>`);
  }
  async function producePackage() {
    if (!artifact) {
      const source = adapter.project(targetId);
      if (!source || !pending) throw Error('当前专利或 AI 结果已不可用，请重新打开。');
      show('<div class="ai-progress"><div class="ai-spinner"></div><h2>正在生成 Word 材料包</h2><p>正在检查字段、套用官方模板、整理待补清单并打包…</p></div>');
      artifact = await window.PatentAIPackage.build(source, pending, adapter.issues);
    }
    await adapter.saveGenerated(artifact);
    targetId = artifact.project.id; baseline = fields.snapshot(artifact.project);
    selectedFiles = []; adapter.render();
    show(`<h2>${artifact.draft ? '专利草稿材料包已生成' : '专利 Word 材料包已生成'}</h2><p>已生成 ${artifact.count} 份可编辑 Word 文书，并附自动检查清单、AI 整理依据和专利备份。已发起下载；如果浏览器未开始下载，请点击下方按钮。</p><div class="ai-info">${artifact.checks.length ? `有 ${artifact.checks.length} 项需要补充或核对，已写入 ZIP 内的待补清单。未提供的数据和技术附图没有编造。` : '自动检查未发现缺项；提交前仍需核对技术内容、签署与 Word 实际分页。'}<br>生成结果另存为一份专利，原专利保持不变。</div>${artifact.checks.length ? `<details><summary>查看待补与检查事项</summary><ul>${artifact.checks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}<div class="actions"><button class="btn" data-ai="close">完成</button><button class="btn" data-ai="review">查看 AI 整理内容</button><button class="btn primary" data-ai="download-package">再次下载材料包</button></div>`);
    adapter.download(artifact.blob, artifact.name);
  }
  function review() {
    show(`<h2>专利建议稿，等你确认</h2><p>${esc(pending.summary)}</p><div class="ai-info"><strong>申请类型建议：${{utility:'实用新型',invention:'发明专利',uncertain:'需进一步确认'}[pending.recommendedType] || '待确认'}</strong><br>${esc(pending.typeReason)}<br>当前专利类型保持不变。来源摘录由 AI 提供，请对照原材料核实。</div>${pending.warnings.length ? `<div class="ai-warning"><strong>需要留意</strong><ul>${pending.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}${pending.questions.length ? `<details class="ai-questions" open><summary>还需要补充 ${pending.questions.length} 项信息</summary><ol>${pending.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol></details>` : ''}<p class="ai-muted">默认只勾选“原字段为空且材料支持”的建议。需要替换已有内容或采纳待确认内容时，请主动勾选。所有建议都可先编辑再采纳。</p><form id="ai-apply">${Object.entries(fields.labels).map(([key,label]) => {
      const f = pending.fields[key], hasValue = !fields.empty(f.value), old = baseline[key], wasEmpty = fields.empty(old);
      return `<section class="ai-review-field"><div class="ai-review-title"><label class="ai-check"><input type="checkbox" data-ai-select="${key}" ${hasValue ? '' : 'disabled'} ${hasValue && wasEmpty && f.status === 'supported' ? 'checked' : ''}><strong>${label}</strong></label><span class="pill ${f.status === 'supported' ? 'green' : 'orange'}">${{supported:'材料支持',needs_confirmation:'需确认',missing:'待补材料'}[f.status]}</span></div>${!wasEmpty ? `<details class="ai-original"><summary>查看已有内容（勾选后将替换）</summary><p>${esc(Array.isArray(old) ? old.map((s,i) => `${i + 1}. ${s}`).join('\n\n') : old)}</p></details>` : ''}${hasValue ? key === 'claims' ? f.value.map((claim,i) => `<label class="ai-claim-label" for="ai-claim-${i}">权利要求 ${i+1}</label><textarea id="ai-claim-${i}" data-ai-claim="${i}" rows="5" maxlength="10000">${esc(claim)}</textarea>`).join('') : `<textarea aria-label="${label}建议稿" data-ai-value="${key}" rows="${key === 'title' ? 2 : 6}" maxlength="20000">${esc(f.value)}</textarea>` : '<p class="ai-muted">材料尚不足，暂不填写此字段。</p>'}${f.note ? `<p class="ai-field-note">${esc(f.note)}</p>` : ''}${f.evidence.length ? `<details class="ai-sources"><summary>来源线索 · ${f.evidence.length} 处（待核对）</summary>${f.evidence.map(e => `<blockquote><strong>${esc(e.file)}</strong> · ${esc(e.location)}<p>${esc(e.excerpt)}</p></blockquote>`).join('')}</details>` : ''}</section>`;
    }).join('')}<div class="ai-review-footer"><span>采纳后仍需核对 Word 文书。</span><button class="btn primary" type="submit">采纳勾选字段</button></div></form><button class="btn" data-ai="download-review">下载完整 AI 建议稿</button>`);
  }
  async function apply() {
    const project = adapter.project(targetId);
    if (!project || !pending) throw Error('当前专利已变化，请重新生成。');
    const changes = {};
    for (const checkbox of dialog().querySelectorAll('[data-ai-select]:checked')) {
      const key = checkbox.dataset.aiSelect;
      changes[key] = key === 'claims' ? [...dialog().querySelectorAll('[data-ai-claim]')].map(e => e.value) : dialog().querySelector(`[data-ai-value="${key}"]`).value;
    }
    if (!Object.keys(changes).length) throw Error('请至少勾选一个要采纳的字段。');
    busy = true;
    try {
    const count = fields.apply(project, changes, baseline);
    baseline = fields.snapshot(project);
    project.example = false;
    // Mark dirty synchronously before awaiting persistence, preserving unload protection.
    adapter.changed(project);
    await adapter.save();
    busy = false; close(); adapter.render(); adapter.toast(`已采纳 ${count} 个字段并保存到本浏览器，请继续核对人员与附图。`);
    } finally { busy = false; }
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-ai]');
    if (!button || !adapter) return;
    event.preventDefault();
    const action = button.dataset.ai;
    if (busy && action !== 'cancel' && action !== 'close') return;
    try {
      if (action === 'settings') settingsPanel();
      if (action === 'use-api') { engine='api'; settingsPanel(resumeUpload); }
      if (action === 'start') start();
      if (action === 'retry-settings') settingsPanel(true);
      if (action === 'edit-upload') start(true);
      if (action === 'retry') await generate(true);
      if (action === 'review') review();
      if (action === 'retry-package') { busy = true; try { await producePackage(); } catch (e) { packageFailure(e); } finally { busy = false; } }
      if (action === 'download-package' && artifact) adapter.download(artifact.blob,artifact.name);
      if (action === 'diagnostic' && lastDiagnostic) adapter.download(new Blob([JSON.stringify(lastDiagnostic,null,2)],{type:'application/json'}),'AI请求诊断.json');
      if (action === 'close') close();
      if (action === 'clear-key') clearKey();
      if (action === 'cancel') controller?.abort();
      if (action === 'remove-file') { selectedFiles.splice(Number(button.dataset.index), 1); listFiles(); }
      if (action === 'download-review' && pending) adapter.download(new Blob([JSON.stringify(pending,null,2)],{type:'application/json'}),'专利-AI建议稿.json');
    } catch (e) { error(readableError(e)); }
  });
  document.addEventListener('change', event => {
    if (event.target.id !== 'ai-files') return;
    try { addFiles([...event.target.files]); } catch (e) { error(e.message); }
    event.target.value = '';
  });
  document.addEventListener('submit', event => {
    if (!['ai-settings','local-settings','ai-generate','ai-apply'].includes(event.target.id)) return;
    event.preventDefault();
    if (busy) return;
    if (event.target.id === 'local-settings') { saveLocalSettings(); return; }
    const task = event.target.id === 'ai-settings' ? saveSettings() : event.target.id === 'ai-generate' ? generate(false) : apply();
    Promise.resolve(task).catch(e => error(readableError(e)));
  });
  window.addEventListener('pagehide', () => { apiKey = ''; controller?.abort(); const field = $('#ai-key'); if (field) field.value = ''; });
  window.addEventListener('pageshow', event => { if (event.persisted && adapter) { adapter.render(); if (!busy) close(); } });
  window.PatentAI = {header, init(api) {
    adapter = api;
    const element = document.createElement('dialog'); element.id = 'ai-dialog'; element.className = 'ai-dialog';
    element.setAttribute('aria-label','康莱德专利 AI'); document.body.append(element);
    element.addEventListener('cancel', event => { event.preventDefault(); close(); });
  }};
})();
