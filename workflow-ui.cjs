const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-v2-ui-"));
  const vaultRoot = path.join(dir, "Content_OS");
  for (const sub of ["00_Profile", "01_Topics", "02_Drafts", "03_Archive"])
    fs.mkdirSync(path.join(vaultRoot, "Demo_AI", sub), { recursive: true });
  const env = { ...process.env, INKDESK_DATA: dir, INKDESK_VAULT: vaultRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve("main.cjs")], env });
    const w = await app.firstWindow();
    w.setDefaultTimeout(9000);
    const errors = [];
    w.on("pageerror", (e) => errors.push(e.message));
    await w.locator("#start").click();
    await w.locator("#title").fill("工作台闭环测试");
    await w.locator(".tiptap").fill("这是我自己的初稿。");
    await w.waitForTimeout(700);
    const root = vaultRoot;
    assert(
      fs.existsSync(path.join(root, "Demo_AI/02_Drafts/工作台闭环测试.md")),
    );
    assert.equal(await w.locator("#export").count(), 0);
    await w.locator("#save-version").click();
    await w.waitForTimeout(400);
    await w.locator("#version-menu").click();
    assert.match(await w.locator(".history-items").innerText(), /恢复/);
    await w.locator("body").click({ position: { x: 20, y: 20 } });
    await w.locator(".tiptap").fill("临时更改，需要恢复。");
    await w.locator("#version-menu").click();
    await w
      .locator(".history-items .version-dropdown-item")
      .first()
      .locator("[data-restore]")
      .click();
    assert.match(await w.locator(".tiptap").innerText(), /这是我自己的初稿/);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("agent");
      ipcMain.handle("agent", (_, req) => "收到：" + req.instruction);
    });
    await w.locator("#instruction").fill("第一次聊结构");
    await w.locator("#send").click();
    await w.locator(".message.assistant").waitFor();
    await w.locator("#new-conversation").click();
    assert.equal(await w.locator(".message").count(), 0);
    await w.locator("#instruction").fill("第二次聊案例");
    await w.locator("#send").click();
    await w.locator(".message.assistant").waitFor();
    assert.doesNotMatch(
      await w.locator(".panel-scroll").innerText(),
      /第一次聊结构/,
    );
    const opts = await w
      .locator("#conversation option")
      .evaluateAll((xs) => xs.map((x) => x.value));
    await w.locator("#conversation").selectOption(opts[0]);
    assert.match(await w.locator(".panel-scroll").innerText(), /第一次聊结构/);
    assert.doesNotMatch(
      await w.locator(".panel-scroll").innerText(),
      /第二次聊案例/,
    );
    await w.locator('[data-page="materials"]').click();
    await w.locator("#add-material").click();
    await w.locator("#material-title").fill("可靠案例");
    await w
      .locator("#material-body")
      .fill("这是素材正文。来源：https://example.com");
    await w.locator("#save-material").click();
    await w.locator("[data-bind]").click();
    await w.locator("[data-material]").click();
    await w.locator("#insert-material").click();
    assert.match(await w.locator(".tiptap").innerText(), /可靠案例/);
    const image = await w.evaluate(async () => {
      const s = await window.desk.call("load");
      return window.desk.call("image", {
        articleId: s.documents[0].id,
        bytes: [137, 80, 78, 71],
        type: "image/png",
      });
    });
    assert.match(
      decodeURIComponent(image),
      /Attachment\/工作台闭环测试\/file-\d{17}\.png/,
    );
    await w.locator('[data-page="profile"]').click();
    await w.locator("#profile-contract").waitFor();
    await w
      .locator("#profile-contract")
      .fill("用我的语言，讲亲历的事情；来源不足则待核实。");
    await w.locator("#profile-save").click();
    await w.waitForTimeout(100);
    assert.match(
      fs.readFileSync(
        path.join(root, "Demo_AI/00_Profile/Writing_Contract.md"),
        "utf8",
      ),
      /亲历/,
    );
    await w.locator(".doc").first().click();
    await w.locator("#layout").click();
    await w.locator("#copy-publish").click();
    const html = await app.evaluate(async ({ clipboard }) => {
      for (const i of await clipboard.read())
        if (i.types.includes("text/html"))
          return (await i.getType("text/html")).text();
    });
    assert.match(html, /初稿/);
    assert.match(html, /line-height/);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0 });
    });
    await w.locator("#finalize").click();
    await w.waitForTimeout(200);
    assert(
      fs.existsSync(path.join(root, "Demo_AI/02_Drafts/工作台闭环测试.md")),
    );
    assert(
      !fs.existsSync(path.join(root, "Demo_AI/03_Archive/工作台闭环测试.md")),
    );
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await w.locator("#finalize").click();
    await w.locator("[data-archive]").waitFor();
    assert(
      !fs.existsSync(path.join(root, "Demo_AI/02_Drafts/工作台闭环测试.md")),
    );
    assert(
      fs.existsSync(path.join(root, "Demo_AI/03_Archive/工作台闭环测试.md")),
    );
    assert.equal(await w.locator(".docs .doc").count(), 0);
    await w.locator("[data-archive]").click();
    await w.locator("#archive-history").click();
    await w.locator("#archive-records details").first().waitFor();
    assert.match(await w.locator("#archive-records").innerText(), /对话 2/);
    await w.locator("#close-archive").click();
    await w.locator('[data-page="dashboard"]').click();
    assert.match(await w.locator(".dashboard").innerText(), /工作台闭环测试/);
    await w.screenshot({ path: "screenshot-dashboard.png" });
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    app = await electron.launch({ args: [path.resolve("main.cjs")], env });
    const r = await app.firstWindow();
    await r.locator('[data-page="dashboard"]').click();
    await r.locator("[data-published]").first().waitFor();
    await r.locator('[data-page="materials"]').click();
    assert.match(await r.locator("#material-list").innerText(), /可靠案例/);
    console.log(
      "PASS v2 UI: draft, named version, separate chats, material relation, image destination, persona, rich clipboard, finalize cancel/confirm, archive records, YAML dashboard and restart",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
