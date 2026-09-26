const test=require('node:test'), assert=require('node:assert/strict');
const {PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
const {parseModelLines,codexModels}=require('./agent-models.cjs');
const {DeskCore}=require('./desk-core.cjs');
test('model parser retains Claude IDs and rejects help, display names and prose',()=>{
 assert.deepEqual(parseModelLines('Available models\nauto - Auto\nclaude-opus-5-high - Opus\nopenai/gpt-6-sol\nUsage: codex models\nGemini 3 Pro (High)\noptions\nclaude-opus-5-high - duplicate'),['auto','claude-opus-5-high','openai/gpt-6-sol']);
});
function mockServer(respond){return ()=>{const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.stdin=new PassThrough(); child.kill=()=>{}; child.stdin.on('data',b=>{const q=JSON.parse(b.toString()); const r=respond(q); if(r)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:q.id,...r})+'\n'));});return child;};}
test('Codex initializes and paginates using model IDs, not display names',async()=>{
 const methods=[];const models=await codexModels('mock',{}, {spawnImpl:mockServer(q=>{methods.push(q.method);if(q.method==='initialize')return {result:{}};if(q.method==='model/list')return {result:q.params.cursor?{data:[{id:'display-id',model:'model-b'}],nextCursor:null}:{data:[{id:'a',model:'model-a'}],nextCursor:'next'}};})});
 assert.deepEqual(models,['model-a','model-b']); assert.deepEqual(methods,['initialize','initialized','model/list','model/list']);
});
test('Codex error and timeout are visible',async()=>{
 await assert.rejects(codexModels('mock',{}, {spawnImpl:mockServer(()=>({error:{message:'login required'}}))}),/login required/);
 await assert.rejects(codexModels('mock',{}, {spawnImpl:mockServer(()=>null),timeoutMs:10}),/超时/);
});
test('catalog failures never parse stdout; refresh retains previous catalog marked stale',async()=>{
 const core=Object.create(DeskCore.prototype);core.executable=()=>'/mock';let calls=0,fail=false;
 core.runCliCapture=async()=>{calls++;return {ok:!fail,output:fail?'fake-model - Help':'actual-model - Model'}};
 let result=await core.listAgentModels({provider:'cursor'});assert.deepEqual(result.models,['actual-model']);
 await core.listAgentModels({provider:'cursor'});assert.equal(calls,1);
 fail=true;result=await core.listAgentModels({provider:'cursor',refresh:true});assert.equal(result.stale,true);assert.deepEqual(result.models,['actual-model']);assert(result.error);
 assert.equal(core.normalizeProvider('chatgpt'),'codex');assert.equal(core.normalizeProvider('claude'),'claude');
});

test('Antigravity reads slugs rather than human display names',async()=>{
 const core=Object.create(DeskCore.prototype);core.executable=()=>'/mock';core.runCliCapture=async(_,args)=>{assert.deepEqual(args,['models']);return {ok:true,output:'gemini-3.8-flash-high     Gemini 3.8 Flash (High)\nclaude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)'}};
 const result=await core.listAgentModels({provider:'antigravity',refresh:true});assert.deepEqual(result.models,['gemini-3.8-flash-high','claude-sonnet-4-6']);
});
