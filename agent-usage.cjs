const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const PROVIDERS = ['cursor','codex','claude','zcode','opencode','antigravity'];
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
function normalizeUsage(provider, u) {
  if (!u || typeof u !== 'object') return null;
  const input = number(u.input_tokens ?? u.inputTokens ?? u.input);
  const output = number(u.output_tokens ?? u.outputTokens ?? u.output);
  const cacheRead = number(u.cached_input_tokens ?? u.cache_read_input_tokens ?? u.cacheReadTokens ?? u.cache?.read);
  const cacheWrite = number(u.cache_creation_input_tokens ?? u.cacheWriteTokens ?? u.cache?.write);
  const reasoning = number(u.reasoning_tokens ?? u.thinking_tokens ?? u.reasoningTokens ?? u.reasoning);
  let total = number(u.total_tokens ?? u.totalTokens ?? u.total);
  if (total === null && ['codex','claude','opencode'].includes(provider) && input !== null && output !== null) {
    total = input + output;
    // Codex cached input is already part of input; Claude and OpenCode report cache separately.
    if (['claude','opencode'].includes(provider)) total += (cacheRead || 0) + (cacheWrite || 0);
    if (['opencode','antigravity'].includes(provider)) total += reasoning || 0;
  }
  if ([input,output,total,cacheRead,cacheWrite,reasoning].every(v=>v===null)) return null;
  return {input,output,cacheRead,cacheWrite,reasoning,total};
}
class AgentUsage {
  constructor(directory) {
    this.file = path.join(directory,'agent-usage.jsonl');
    this.active = new Set();
    this.error = '';
  }
  append(event) {
    try { fs.appendFileSync(this.file, '\n'+JSON.stringify(event)+'\n', {mode:0o600}); }
    catch { this.error = '用量记录保存失败，请检查本地数据目录权限'; }
  }
  begin(meta) {
    const id = randomUUID();
    this.active.add(id);
    const {provider,model,account,articleId,conversationId,kind} = meta;
    this.append({event:'start',id,at:Date.now(),provider,model,account,articleId,conversationId,kind:kind || 'writing'});
    return id;
  }
  end(id, status, usage) {
    if (!this.active.delete(id)) return;
    this.append({event:'end',id,at:Date.now(),status,usage:usage || null});
  }
  snapshot({days=30,provider='all'} = {}, now = new Date()) {
    days = [7,30,90].includes(Number(days)) ? Number(days) : 30;
    provider = PROVIDERS.includes(provider) ? provider : 'all';
    let text='';try {text=fs.readFileSync(this.file,'utf8');} catch(e) {if(e.code!=='ENOENT')this.error='无法读取用量记录';}
    const records=new Map();let firstAt=null;
    for (const line of text.split('\n')) {
      let e;try{e=JSON.parse(line);}catch{continue;}
      if(e.event==='start' && PROVIDERS.includes(e.provider)) { records.set(e.id,{...e,status:this.active.has(e.id)?'running':'interrupted'});firstAt=firstAt===null?e.at:Math.min(firstAt,e.at); }
      if(e.event==='end' && records.has(e.id))Object.assign(records.get(e.id),{status:e.status,usage:e.usage});
    }
    const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-days+1);
    const blank=()=>({calls:0,conversations:0,success:0,failed:0,cancelled:0,timeout:0,interrupted:0,running:0,tests:0,tokens:0,tokenCalls:0,unknownTokens:0,keys:new Set()});
    const rows=Object.fromEntries(PROVIDERS.map(p=>[p,blank()])),total=blank(),daily=[];
    for(let i=0;i<days;i++){const d=new Date(start);d.setDate(d.getDate()+i);daily.push({date:dayKey(d),...blank()});}
    const byDay=new Map(daily.map(d=>[d.date,d]));
    function add(bucket,r) {
      if(r.kind==='test'){bucket.tests++;return;}
      bucket.calls++; if(Object.hasOwn(bucket,r.status) && typeof bucket[r.status]==='number') bucket[r.status]++;
      if(r.conversationId)bucket.keys.add(JSON.stringify([r.account,r.articleId,r.conversationId]));
      if(number(r.usage?.total)!==null){bucket.tokens+=r.usage.total;bucket.tokenCalls++;}else bucket.unknownTokens++;
    }
    for(const r of records.values()) {
      if(r.at<start.getTime() || r.at>now.getTime())continue;
      add(rows[r.provider],r);
      if(provider!=='all' && provider!==r.provider)continue;
      add(total,r);const d=byDay.get(dayKey(new Date(r.at)));if(d)add(d,r);
    }
    const clean=b=>{const {keys,...rest}=b;return {...rest,conversations:keys.size};};
    return {days,provider,firstAt,error:this.error,total:clean(total),agents:PROVIDERS.map(p=>({provider:p,...clean(rows[p])})),daily:daily.map(clean)};
  }
}
module.exports={AgentUsage,normalizeUsage,dayKey};
