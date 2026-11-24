(function(root) {
  'use strict';
  const local = root.PATENT_LOCAL_CODEX;
  async function call(path, body, signal) {
    if (!local || !['127.0.0.1','localhost'].includes(location.hostname)) throw Error('请先启动本机工坊。');
    const response = await fetch('/local-codex/'+path, {
      method:body === undefined ? 'GET' : 'POST',
      headers:{Authorization:'Bearer '+local.token,...(body === undefined ? {} : {'Content-Type':'application/json'})},
      body:body === undefined ? undefined : JSON.stringify(body),signal,credentials:'omit',cache:'no-store',keepalive:path.startsWith('cancel/'),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '本机 Codex 服务暂不可用。');
    return result;
  }
  function pause(ms, signal) {
    return new Promise((resolve,reject)=>{
      signal?.throwIfAborted();
      const abort=()=>{clearTimeout(timer);reject(signal.reason);};
      const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
      signal?.addEventListener('abort',abort,{once:true});
    });
  }
  async function generate(input, model, signal, onProgress) {
    const {validateInput,validateOutput}=await import('./ai-core.mjs?v=20261124-local1');
    const checked=validateInput(input);
    const {jobId}=await call('generate',{...input,model},signal);
    const cancel=()=>{call('cancel/'+jobId,{}).catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted) { cancel(); signal.throwIfAborted(); }
    try {
      while(true) {
        const state=await call('jobs/'+jobId,undefined,signal);
        onProgress(state.message);
        if(state.status==='completed')return validateOutput(state.draft,checked);
        if(['error','cancelled'].includes(state.status))throw Error(state.message);
        await pause(1000,signal);
      }
    } finally { signal.removeEventListener('abort',cancel); }
  }
  root.PatentLocalCodex={available:Boolean(local),status:()=>call('status'),generate};
})(globalThis);
