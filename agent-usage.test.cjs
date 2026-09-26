const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AgentUsage,normalizeUsage}=require('./agent-usage.cjs');const {AgentOutput}=require('./agent-output.cjs');const {DeskCore}=require('./desk-core.cjs');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aside-usage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,usage:new AgentUsage(dir)};}
test('calls, conversations, tests and unknown tokens remain distinct and survive reload',t=>{
 const {dir,usage}=setup(t);const m={provider:'codex',account:'a',articleId:'d',conversationId:'c'};
 let id=usage.begin({...m,instruction:'DO NOT LOG'});usage.end(id,'success',{total:125});usage.end(id,'success',{total:125});
 id=usage.begin(m);usage.end(id,'failed',null);
 id=usage.begin({...m,provider:'cursor'});usage.end(id,'cancelled',null);
 id=usage.begin({...m,kind:'test'});usage.end(id,'success',{total:999});
 const s=new AgentUsage(dir).snapshot();assert.equal(s.total.calls,3);assert.equal(s.total.conversations,1);assert.equal(s.total.tests,1);assert.equal(s.total.tokens,125);assert.equal(s.total.unknownTokens,2);assert.equal(s.agents.find(a=>a.provider==='codex').conversations,1);
 assert(!fs.readFileSync(usage.file,'utf8').includes('DO NOT LOG'));
 const only=usage.snapshot({provider:'cursor'});assert.equal(only.total.calls,1);assert.equal(only.total.cancelled,1);
});
test('date windows, zero filled days and unfinished calls',t=>{
 const {dir,usage}=setup(t);const now=new Date(2026,8,26,12);const before=new Date(2026,8,19,23).getTime(),today=now.getTime();
 usage.append({event:'start',id:'old',at:before,provider:'cursor'});usage.append({event:'start',id:'new',at:today,provider:'claude',conversationId:'1'});
 fs.appendFileSync(usage.file,'broken trailing record');
 let s=new AgentUsage(dir).snapshot({days:7},now);assert.equal(s.total.calls,1);assert.equal(s.total.interrupted,1);assert.equal(s.daily.length,7);assert.equal(s.daily.at(-1).calls,1);assert.equal(s.daily[0].calls,0);
 assert.equal(usage.snapshot({days:30},now).total.calls,2);
});
test('tokens respect cache inclusion and missing values',()=>{
 assert.equal(normalizeUsage('codex',{input_tokens:100,cached_input_tokens:70,output_tokens:20}).total,120);
 assert.equal(normalizeUsage('claude',{input_tokens:100,cache_read_input_tokens:70,cache_creation_input_tokens:10,output_tokens:20}).total,200);
 assert.equal(normalizeUsage('cursor',{}),null);
 assert.equal(normalizeUsage('cursor',{input_tokens:100}).total,null);
 assert.equal(normalizeUsage('cursor',{inputTokens:0,outputTokens:0,totalTokens:0}).total,0);
});
test('structured output never leaks tool data and does not double count cumulative usage',()=>{
 const codex=new AgentOutput('codex');codex.push(JSON.stringify({type:'item.completed',item:{type:'command_execution',text:'secret'}})+'\n');codex.push(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'正文'}})+'\n');codex.push(JSON.stringify({type:'turn.completed',usage:{input_tokens:5,output_tokens:4}}));codex.finish('');assert.equal(codex.result(),'正文');assert.equal(codex.usage.total,9);
 const claude=new AgentOutput('claude').finish(JSON.stringify({result:'结果',usage:{input_tokens:5,output_tokens:4},modelUsage:{a:{inputTokens:5,outputTokens:4}}}));assert.equal(claude.usage.total,9);assert.equal(claude.result(),'结果');
 const cursor=new AgentOutput('cursor');cursor.push(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'结果'}]}})+'\n');cursor.push(JSON.stringify({type:'result',result:'结果'})+'\n');cursor.finish('');assert.equal(cursor.result(),'结果');assert.equal(cursor.usage,null);
 const opencode=new AgentOutput('opencode');const event={type:'step_finish',part:{id:'p',tokens:{input:5,output:4,reasoning:1,cache:{read:2,write:3}}}};opencode.event(event);opencode.event(event);assert.equal(opencode.usage.total,15);
 assert(new AgentOutput('claude').finish('{"is_error":true,"result":"error"}').error);
});
test('spawn records real process success, zero-exit CLI failure and cancellation',async t=>{
 const {dir,usage}=setup(t);const core=new DeskCore();core.agentUsage=usage;
 const spec=(js)=>({provider:'claude',cmd:process.execPath,args:['-e',js]});
 const opts={cwd:dir,prompt:'',usageMeta:{provider:'claude',conversationId:'c'}};
 assert.equal(await core.spawnAgent(spec(`console.log(JSON.stringify({result:'done',usage:{input_tokens:3,output_tokens:2}}))`),opts),'done');
 await assert.rejects(core.spawnAgent(spec(`console.log(JSON.stringify({is_error:true,result:'no access'}))`),opts),/no access/);
 const pending=core.spawnAgent(spec('setInterval(()=>{},1000)'),opts);core.active.asideCancelled=true;core.active.kill('SIGTERM');await assert.rejects(pending,/取消/);
 const s=usage.snapshot();assert.equal(s.total.calls,3);assert.equal(s.total.success,1);assert.equal(s.total.failed,1);assert.equal(s.total.cancelled,1);assert.equal(s.total.tokens,5);
});
