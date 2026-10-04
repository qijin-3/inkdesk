const {normalizeUsage}=require('./agent-usage.cjs');
// Parse only known CLI envelopes. Raw JSON, tool results and reasoning never become article text.
function parseEnvelope(raw){
  const text=String(raw||'').trim();
  if(!text)return null;
  try{return{ok:true,value:JSON.parse(text)};}catch{}
  const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start>=0&&end>start){
    try{return{ok:true,value:JSON.parse(text.slice(start,end+1))};}catch{}
  }
  for(const line of text.split('\n').reverse()){
    const t=line.trim();if(!t)continue;
    try{return{ok:true,value:JSON.parse(t)};}catch{}
  }
  return{ok:false};
}
class AgentOutput {
 constructor(provider,onText,onEvent){this.provider=provider;this.onText=onText;this.onEvent=onEvent;this.buffer='';this.text='';this.finalText=null;this.usage=null;this.error='';this.seen=new Set();}
 emit(text){if(typeof text!=='string'||!text)return;this.text+=text;this.onText?.(text);try{this.onEvent?.({type:'text_delta',text});}catch{}}
 event(e){
  if(this.provider==='codex'){
   if(e.type==='turn.completed')this.usage=normalizeUsage('codex',e.usage);
   if(e.type==='item.completed' && e.item?.type==='agent_message')this.emit(e.item.text);
   if(e.type==='turn.failed'||e.type==='error')this.error=e.error?.message||e.message||'Agent 返回错误';
  }else if(this.provider==='opencode'){
   if(e.type==='text')this.emit(e.part?.text);
   if(e.type==='error')this.error=e.error?.data?.message||e.error?.message||'Agent 返回错误';
   if(e.type==='step_finish' && (!e.part?.id || !this.seen.has(e.part.id))){
    if(e.part?.id)this.seen.add(e.part.id);
    const u=normalizeUsage('opencode',e.part?.tokens);
    if(u){if(!this.usage)this.usage=u;else for(const k of Object.keys(u))this.usage[k]=this.usage[k]===null||u[k]===null?null:this.usage[k]+u[k];}
   }
  }else if(this.provider==='cursor'){
   if(e.type==='assistant'){for(const b of e.message?.content||[])if(b.type==='text')this.emit(b.text);
     for(const b of e.message?.content||[])if(b.type==='tool_use')try{this.onEvent?.({type:'tool_start',tool:{id:b.id,name:b.name,args:b.input}});}catch{}}
   if(e.type==='result'){if(typeof e.result==='string')this.finalText=e.result;this.usage=normalizeUsage('cursor',e.usage);if(e.is_error)this.error=e.result||'Agent 返回错误';}
  }
 }
 push(chunk){this.buffer+=chunk;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);try{this.event(JSON.parse(line));}catch{}}}
 finish(raw){
  if(['claude','antigravity','zcode'].includes(this.provider)){
   // Empty stdout: leave error unset so spawnAgent can surface stderr (e.g. missing provider config).
   if(!String(raw||'').trim())return this;
   const parsed=parseEnvelope(raw);
   if(!parsed||!parsed.ok){this.error='无法解析 Agent 返回结果，请检查 CLI 版本';return this;}
   const e=parsed.value;
   if(e === null || (typeof e !== 'object' && typeof e !== 'string')){this.error='无法解析 Agent 返回结果，请检查 CLI 版本';return this;}
   this.finalText=typeof e === "string" ? e : e.result??e.response??e.text??e.message;
   if(typeof this.finalText!=='string')this.finalText='';
   this.usage=normalizeUsage(this.provider,e.usage);
   if(e.is_error || ['ERROR','CANCELED','INTERRUPTED'].includes(e.status))this.error=(typeof e.error==='string'?e.error:e.error?.message)||this.finalText||'Agent 返回错误';
  }else if(this.buffer.trim()){try{this.event(JSON.parse(this.buffer));}catch{}}
  return this;
 }
 result(){return this.finalText??this.text;}
}
module.exports={AgentOutput};
