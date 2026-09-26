const fmt = n => Number(n || 0).toLocaleString('zh-CN');
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/**
 * @param {HTMLElement} root
 * @param {(cmd:string,payload?:object)=>Promise<any>} api
 * @param {{id:string,label:string}[]} providers
 * @param {{provider?:string,mode?:'overview'|'detail'}} [opts]
 */
export function mountAgentUsage(root, api, providers, opts = {}) {
 if(!root)return;
 const mode = opts.mode === 'detail' ? 'detail' : 'overview';
 const lockedProvider = mode === 'detail' && providers.some(p=>p.id===opts.provider) ? opts.provider : 'all';
 let days=30, provider=lockedProvider, metric='calls', request=0;
 const title = mode === 'detail'
  ? `${esc(providers.find(p=>p.id===provider)?.label || provider)} 调用明细`
  : '总览';
 const hint = mode === 'detail'
  ? '仅统计通过 AsIde 发起的调用，从启用此版本后开始记录。'
  : '仅统计通过 AsIde 发起的调用，从启用此版本后开始记录。进入下方模型卡片可查看各 Agent 明细与连接配置。';
 root.innerHTML=`<div class="usage-head"><div><h3>${title}</h3><p class="settings-hint">${hint}</p></div><div class="usage-filters"><select aria-label="统计周期" id="usage-days"><option value="7">近 7 天</option><option value="30" selected>近 30 天</option><option value="90">近 90 天</option></select><button type="button" class="ghost" id="usage-refresh">刷新</button></div></div><div id="usage-content" aria-live="polite">读取统计…</div>`;
 const content=root.querySelector('#usage-content');
 async function load(){
  const id=++request;const refresh=root.querySelector('#usage-refresh');refresh.disabled=true;
  try{
   const data=await api('agent-usage',{days,provider});if(id!==request||!root.isConnected)return;
   const t=data.total;
   content.innerHTML=`${data.error?`<p class="usage-error">${esc(data.error)}</p>`:''}<div class="usage-summary">
     <div><span>写作调用</span><strong>${fmt(t.calls)}</strong><small>成功 ${fmt(t.success)} · 失败 ${fmt(t.failed)}</small></div>
     <div><span>参与对话</span><strong>${fmt(t.conversations)}</strong><small>同一对话多轮只计一次</small></div>
     <div><span>已记录 Token</span><strong>${t.tokenCalls?fmt(t.tokens):'—'}</strong><small>${fmt(t.tokenCalls)} / ${fmt(t.calls)} 次调用返回用量</small></div>
     <div><span>连通性测试</span><strong>${fmt(t.tests)}</strong><small>不计入写作调用及 Token</small></div>
    </div><div class="usage-chart-head"><strong>每日趋势</strong><select id="usage-metric" aria-label="图表指标"><option value="calls">调用次数</option><option value="conversations">对话次数</option><option value="tokens">已记录 Token</option></select></div><div id="usage-chart"></div>
    <p class="settings-hint">${t.calls?'':'暂无写作调用，发送第一条消息后这里会自动累计。'}${t.cancelled||t.timeout||t.interrupted||t.running?` 取消 ${fmt(t.cancelled)} · 超时 ${fmt(t.timeout)} · 中断 ${fmt(t.interrupted)} · 进行中 ${fmt(t.running)}`:''}</p>
    ${mode==='detail'?`<p class="settings-hint">调用包含成功、失败和取消等已启动请求；对话按文章与对话标识去重。Token 仅汇总 CLI 返回值，未返回不等于 0，也不代表订阅余额。${data.firstAt?` 首条记录：${esc(new Date(data.firstAt).toLocaleString('zh-CN'))}。`:''}</p>`:''}`;
   const select=content.querySelector('#usage-metric');select.value=metric;select.onchange=()=>{metric=select.value;chart(data.daily);};chart(data.daily);
  }catch(e){if(id===request)content.textContent='统计读取失败：'+(e.message||'请刷新重试');}
  finally{if(id===request)refresh.disabled=false;}
 }
 function chart(daily){
  const max=Math.max(1,...daily.map(d=>d[metric]));
  const label={calls:'调用',conversations:'对话',tokens:'已记录 Token'}[metric];
  content.querySelector('#usage-chart').innerHTML=`<div class="usage-scale">${fmt(max)} ${label}</div><div class="usage-bars" role="group" aria-label="每日${label}趋势">${daily.map(d=>{const title=`${d.date} · ${fmt(d[metric])} ${label}${metric==='tokens'?` · ${d.tokenCalls}/${d.calls} 次有用量`:''}`;return `<div class="usage-bar-slot" tabindex="0" role="img" aria-label="${esc(title)}" title="${esc(title)}"><div class="usage-bar ${d[metric]?'':'is-zero'}" style="height:${d[metric]?Math.max(2,d[metric]/max*100):1}%"></div><span class="usage-tooltip">${esc(title)}</span></div>`;}).join('')}</div><div class="usage-axis"><span>${daily[0].date}</span><span>${daily[daily.length-1].date}</span></div>`;
 }
 root.querySelector('#usage-days').onchange=e=>{days=Number(e.target.value);load();};
 root.querySelector('#usage-refresh').onclick=load;
 load();
}
