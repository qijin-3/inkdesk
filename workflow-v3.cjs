const { _electron: electron } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-v3-ui-"));
  let app;
  try {
    const root = path.join(dir, "Content_OS");
    fs.mkdirSync(path.join(root, "金奇_AI/00_Profile/Author_DNA"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "金奇_AI/00_Profile/Persona_Doc.md"),
      "# 我是谁\n真实的 AI 实践者。",
    );
    fs.writeFileSync(
      path.join(root, "金奇_AI/00_Profile/Author_DNA/语言风格.md"),
      "# 语言\n讲人话。",
    );
    fs.writeFileSync(
      path.join(root, "金奇_AI/00_Profile/Author_DNA/禁止规则.md"),
      "# 边界\n不编造。",
    );
    fs.mkdirSync(path.join(root, "金奇_AI/03_Archive"), { recursive: true });
    const year = new Date().getFullYear();
    for (const title of ["第一篇", "第二篇"])
      fs.writeFileSync(
        path.join(root, "金奇_AI/03_Archive", title + ".md"),
        `---\n发布时间: ${year}-01-10\n观看量: 100\n---\n归档正文`,
      );
    const capture = path.join(dir, "prompt.txt"),
      bootstrap = path.join(dir, "bootstrap.cjs"),
      main = path.resolve("main.cjs");
    fs.writeFileSync(
      bootstrap,
      `const Module=require('module'),EventEmitter=require('events'),fs=require('fs');const original=Module._load;Module._load=function(id,parent,...rest){const real=original.call(this,id,parent,...rest);if(id==='node:child_process'&&parent?.filename===${JSON.stringify(main)})return {...real,spawn:(exe,args)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);child.stdin={end(input){const prompt=args.at(-1)==='-'?input:args.at(-1);fs.writeFileSync(${JSON.stringify(capture)},prompt);setTimeout(()=>{const result=prompt.includes('任务：profile-iterate')?JSON.stringify([{path:'Author_DNA/迭代观察.md',content:'# 新观察\\n两篇文章均有记录，但不足以推断因果。',reason:'使用归档 YAML 作为反馈',sources:['金奇_AI/00_Profile/Persona_Doc.md','金奇_AI/03_Archive/第一篇.md']} ]):'已读取当前项目资料。';child.stdout.emit('data',Buffer.from(result));child.emit('close',0);},40)}};return child;}};return real;};require(${JSON.stringify(main)});`,
    );
    const env = { ...process.env, INKDESK_DATA: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [bootstrap], env });
    const w = await app.firstWindow();
    w.setDefaultTimeout(10000);
    const errors = [];
    w.on("pageerror", (e) => errors.push(e.message));
    await w.locator("#start").click();
    await w.locator("#title").fill("项目甲");
    await w.locator(".tiptap").fill("我要写自己的想法。");
    await w.waitForTimeout(600);
    const ref = path.join(dir, "采访资料.txt");
    fs.writeFileSync(ref, "项目甲专属：独家采访关键证据 13579。");
    await app.evaluate(({ dialog }, ref) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [ref],
      });
    }, ref);
    await w.locator("#article-materials").click();
    await w.locator("#upload-reference").click();
    await w.locator("[data-ref-toggle]").waitFor();
    assert.match(await w.locator("#project-files").innerText(), /可读取全文/);
    await w.locator("[data-ref-preview]").click();
    assert.match(await w.locator(".material-preview").innerText(), /13579/);
    await w.locator("#close-ref").click();
    await w.locator('[data-page="write"]').click();
    await w.locator("#instruction").fill("按参考资料找证据");
    await w.locator("#send").click();
    await w.locator(".message.assistant").waitFor();
    assert.match(fs.readFileSync(capture, "utf8"), /项目甲专属/);
    await w.locator("#new").click();
    await w.locator("#title").fill("项目乙");
    await w.locator("#instruction").fill("没有素材也聊一聊");
    await w.locator("#send").click();
    await w.locator(".message.assistant").waitFor();
    assert.doesNotMatch(fs.readFileSync(capture, "utf8"), /项目甲专属/);
    await w.locator("#article-materials").click();
    assert.match(await w.locator("#project-files").innerText(), /把采访稿/);
    await w.locator('[data-page="archive"]').click();
    assert.equal(await w.locator(".archive-table tbody tr").count(), 2);
    assert.equal(await w.locator("#main .result-card").count(), 0);
    await w.locator('[data-page="dashboard"]').click();
    assert.match(
      await w.locator(`[data-heat-date="${year}-01-10"]`).getAttribute("title"),
      /2 篇[\s\S]*第一篇/,
    );
    await w.locator('[data-page="profile"]').click();
    await w.locator('[data-profile-file="Author_DNA/语言风格.md"]').click();
    assert.match(await w.locator("#profile-text").inputValue(), /讲人话/);
    await w.locator("#profile-text").fill("# 语言\n我喜欢自然的表达。");
    await w.locator("#profile-save").click();
    await w.waitForTimeout(150);
    assert.match(
      fs.readFileSync(
        path.join(root, "金奇_AI/00_Profile/Author_DNA/语言风格.md"),
        "utf8",
      ),
      /自然/,
    );
    await w.locator("#simplify-profile").click();
    assert.equal(await w.locator("[data-proposal-edit]").count(), 4);
    await w.locator("#apply-profile").click();
    await w.locator("#iterate-profile").click();
    await w.locator("#apply-profile").waitFor();
    assert.match(await w.locator(".proposal-dialog").innerText(), /归档 YAML/);
    assert.match(fs.readFileSync(capture, "utf8"), /观看量/);
    assert.match(fs.readFileSync(capture, "utf8"), /100/);
    await w.locator("#apply-profile").click();
    await w.locator('[data-profile-file="Author_DNA/迭代观察.md"]').click();
    assert.match(
      await w.locator("#profile-text").inputValue(),
      /不足以推断因果/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS v3 UI: upload, extraction preview, actual Agent prompt contains only current project references, whole Profile editor, simplification/apply, evidence-driven iteration/apply, archive table and publication heatmap",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
