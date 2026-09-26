const {_electron:electron}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AgentUsage}=require('./agent-usage.cjs');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aside-usage-ui-'));let app;try{
 const root=path.join(dir,'Content_OS');for(const sub of ['00_Profile','01_Topics','02_Drafts','03_Archive'])fs.mkdirSync(path.join(root,'Demo_AI',sub),{recursive:true});
 const usage=new AgentUsage(dir);let id=usage.begin({provider:'codex',conversationId:'c',articleId:'a'});usage.end(id,'success',{total:2345});id=usage.begin({provider:'cursor',conversationId:'c',articleId:'a'});usage.end(id,'success',null);
 const env={...process.env,INKDESK_DATA:dir,INKDESK_VAULT:root};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({...(process.env.ASIDE_TEST_APP?{executablePath:process.env.ASIDE_TEST_APP,args:[]}:{args:[path.resolve('main.cjs')]}),env});const w=await app.firstWindow();const errors=[];w.on('pageerror',e=>errors.push(e.message));
 await w.locator('[data-page="settings"]').click();await w.locator('[data-settings-tab="agents"]').click();await w.locator('.usage-summary').waitFor();
 assert.deepEqual(await w.locator('.usage-summary strong').allTextContents(),['2','1','2,345','0']);assert.equal(await w.locator('.usage-bar-slot').count(),30);
 assert.equal(await w.locator('#usage-provider').count(),0);
 assert.equal(await w.locator('.usage-table').count(),0);
 await w.locator('#usage-days').selectOption('7');await w.waitForFunction(()=>document.querySelectorAll('.usage-bar-slot').length===7);
 await w.locator('#usage-metric').selectOption('tokens');await w.locator('.usage-bar-slot').last().hover();assert.match(await w.locator('.usage-bar-slot').last().getAttribute('aria-label'),/Token/);
 await w.locator('[data-open-agent="cursor"]').click();
 await w.locator('[data-agent-tab="usage"]').click();
 await w.locator('#agent-usage .usage-summary').waitFor();
 assert.deepEqual(await w.locator('#agent-usage .usage-summary strong').allTextContents(),['1','1','—','0']);
 await w.locator('#agent-usage').screenshot({path:'/tmp/aside-agent-usage.png'});assert.deepEqual(errors,[]);console.log('PASS usage overview dashboard, agent detail stats, missing tokens and accessible chart');
 }finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
