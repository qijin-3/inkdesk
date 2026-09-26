const { _electron: electron } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-v4-")),
    root = path.join(dir, "Content_OS");
  let app;
  try {
    fs.mkdirSync(path.join(root, "Demo_AI/03_Archive"), { recursive: true });
    const year = new Date().getFullYear();
    for (const t of ["第一篇", "第二篇"])
      fs.writeFileSync(
        path.join(root, "Demo_AI/03_Archive", t + ".md"),
        `---\n发布时间: ${year}-01-10\n观看量: 100\n涨粉: 3\n---\n文章正文`,
      );
    const capture = path.join(dir, "prompt.txt"),
      boot = path.join(dir, "bootstrap.cjs");
    fs.writeFileSync(
      boot,
      String.raw`const Module=require('module'),EventEmitter=require('events'),fs=require('fs');const load=Module._load;Module._load=function(id,parent,...rest){const real=load.call(this,id,parent,...rest);if(id==='node:child_process'&&parent?.filename===MAIN)return {...real,spawn:(exe,args)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);child.stdin={end(input){const prompt=args.at(-1)==='-'?input:args.at(-1);fs.writeFileSync(CAPTURE,prompt);let result='已参考指定资料。';if(prompt.includes('任务：rewrite-tags')){const ids=prompt.split(String.fromCharCode(10)).filter(line=>line.startsWith('[引用 ')&&line.includes('：当前文章选段')).map(line=>line.slice(4,line.indexOf('：')));result=JSON.stringify(ids.map((id,i)=>({id,text:'改写后的选段 '+(i+1)})));}if(prompt.includes('任务：model-iterate'))result=JSON.stringify([{module:'learning',content:'观察：两篇文章数据相近，样本不足；下次验证更具体的开头。',reason:'根据真实 YAML 作暂时观察',sources:['Demo_AI/00_Profile/Account_Model.md','Demo_AI/03_Archive/第一篇.md']}]);setTimeout(()=>{child.stdout.emit('data',Buffer.from(result));child.emit('close',0)},60);}};return child;}};return real;};require(MAIN);`
        .replaceAll("MAIN", JSON.stringify(path.resolve("main.cjs")))
        .replaceAll("CAPTURE", JSON.stringify(capture)),
    );
    require("node:child_process").execFileSync(process.execPath, [
      "--check",
      boot,
    ]);
    const env = { ...process.env, INKDESK_DATA: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [boot], env });
    const w = await app.firstWindow();
    w.setDefaultTimeout(10000);
    const errors = [];
    w.on("pageerror", (e) => errors.push(e.message));
    await w.locator("#start").click();
    await w.locator("#title").fill("标签测试文章");
    await w.locator(".paper .tiptap").fill("最初正文");
    const file = path.join(dir, "采访资料.txt");
    fs.writeFileSync(
      file,
      "不可引用的第一行\n精确第二行证据 6789\n不可引用的第三行",
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    await w.locator("#instruction").fill("请对这里修改，并说明原因。");
    await w.locator("#instruction").evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.querySelector("p").firstChild, 2);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await w.waitForTimeout(80);
    await w.locator("#chat-upload").click();
    await w.locator("#instruction .inline-reference").waitFor();
    assert.match(
      await w.locator("#instruction").innerText(),
      /^请对采访资料.txt/,
    );
    const first = await w.locator("#conversation").inputValue();
    await w.locator("#new-conversation").click();
    assert.equal(await w.locator("#instruction .inline-reference").count(), 0);
    await w.locator("#conversation").selectOption(first);
    assert.equal(await w.locator("#instruction .inline-reference").count(), 1);
    await w.locator("#instruction .inline-reference").click();
    await w.locator("#instruction").press("Backspace");
    assert.equal(await w.locator("#instruction .inline-reference").count(), 0);
    await w.locator("#chat-reference").click();
    await w.locator("[data-pick-ref]").first().click();
    await w.locator("#send").click();
    await w.locator(".message.assistant").waitFor();
    assert.match(fs.readFileSync(capture, "utf8"), /请对\[引用 [\w-]+\]/);
    await w.locator("#article-materials").click();
    await w.locator(".material-card").first().waitFor();
    assert.equal(await w.locator("#project-files table").count(), 0);
    await w.locator("[data-ref-preview]").click();
    await w.locator("#reference-text").waitFor();
    await w.locator("#reference-text").evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild, el.textContent.indexOf("精确"));
      r.setEnd(el.firstChild, el.textContent.indexOf("\n不可引用的第三行"));
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await w.locator("#cite-file-range").click();
    assert.match(
      await w.locator("#instruction .inline-reference").innerText(),
      /L2–2/,
    );
    await w.locator("#send").click();
    await w.waitForTimeout(200);
    const prompt = fs.readFileSync(capture, "utf8");
    assert.match(prompt, /精确第二行证据 6789/);
    assert.doesNotMatch(prompt, /不可引用的第一行|不可引用的第三行/);
    const paper = w.locator(".paper .tiptap");
    await paper.fill("第一段旧文字。");
    await paper.press("End");
    await paper.press("Enter");
    await paper.pressSequentially("中间这段绝对保留。");
    await paper.press("Enter");
    await paper.pressSequentially("第三段旧文字。");
    const select = async (i) => {
      await paper.click();
      await w
        .locator(".paper .tiptap p")
        .nth(i)
        .evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        });
      await w.waitForTimeout(70);
      await w.locator("#tag-selection").click();
    };
    await select(0);
    await select(2);
    assert.equal(await w.locator("#instruction .inline-reference").count(), 2);
    await w.locator("#rewrite-tags").click();
    await w.locator("#accept").waitFor();
    await w.locator("#accept").click();
    assert.match(await paper.innerText(), /中间这段绝对保留/);
    assert.match(await paper.innerText(), /改写后的选段 1/);
    assert.doesNotMatch(await paper.innerText(), /第一段旧文字|第三段旧文字/);
    await select(0);
    await paper.fill("后来修改过的正文");
    await w.locator("#rewrite-tags").click();
    assert.match(await w.locator("#toast").innerText(), /过期/);
    assert.match(await paper.innerText(), /后来修改过/);
    await w.locator('[data-page="dashboard"]').click();
    assert.equal(
      await w.locator('.heatmap-day.is-today[aria-current="date"]').count(),
      1,
    );
    assert.match(
      await w.locator(`[data-heat-date="${year}-01-10"]`).getAttribute("title"),
      /2 篇[\s\S]*第一篇/,
    );
    await w.locator('[data-page="settings"]').click();
    await w.locator('[data-settings-tab="accounts"]').click();
    await w.locator('[data-open-account]').first().click();
    await w.locator("[data-model-tab]").first().waitFor();
    assert.equal(await w.locator("[data-model-tab]").count(), 5);
    await w.locator('[data-model-tab="voice"]').click();
    await w.locator("#model-text").fill("保持自然，保留我的判断。");
    await w.locator("#save-model").click();
    await w.locator('[data-model-tab="history"]').click();
    await w.locator("#iterate-model").click();
    await w.locator("#apply-model").waitFor();
    await w.locator("#apply-model").click();
    await w.locator('[data-model-tab="learning"]').click();
    assert.match(await w.locator("#model-text").inputValue(), /样本不足/);
    assert.equal(await w.locator("[data-model-tab]").count(), 5);
    assert(
      fs.existsSync(path.join(root, "Demo_AI/00_Profile/Account_Model.md")),
    );
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    app = await electron.launch({ args: [boot], env });
    const reopened = await app.firstWindow();
    await reopened.locator("#instruction .inline-reference").waitFor();
    assert.equal(
      await reopened.locator("#instruction .inline-reference").count(),
      1,
    );
    assert.match(
      await reopened
        .locator(".message.user .inline-reference")
        .first()
        .innerText(),
      /采访资料/,
    );
    console.log(
      "PASS v4: inline file caret order, conversation drafts, card/right preview, line-specific payload, multiple selected-range edits with untouched middle, stale protection, today+hover, fixed model tabs and AI iteration",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
