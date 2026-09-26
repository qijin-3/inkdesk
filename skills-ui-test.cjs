const { _electron: electron } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aside-skills-ui-"));
  const vaultRoot = path.join(dir, "Content_OS");
  for (const sub of ["00_Profile", "01_Topics", "02_Drafts", "03_Archive"])
    fs.mkdirSync(path.join(vaultRoot, "Demo_AI", sub), { recursive: true });
  const env = { ...process.env, INKDESK_DATA: dir, INKDESK_VAULT: vaultRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve("main.cjs")], env });
    const w = await app.firstWindow();
    assert.equal(await w.locator(".sidebar #manage-skills").count(),0);
    await w.locator('[data-page="settings"]').click();
    await w.locator('[data-settings-tab="skills"]').click();
    await w.locator("#manage-skills").click();
    await w.locator("#skill-new").click();
    await w.locator("#skill-name").fill("我的核查");
    await w.locator("#skill-prompt").fill("逐项标记没有来源的论断。");
    await w.locator("#skill-enabled").check();
    await w.locator("#skill-save").click();
    await w.waitForFunction(() =>
      document.querySelector(".skill-list")?.textContent.includes("默认启用"),
    );
    await w.screenshot({path:"/tmp/aside-skills.png"});
    await w.locator("#skill-close").click();
    await w.locator("#new").click();
    await w.locator("#toggle-assistant").click();
    await w
      .locator("#skill-picker input:checked")
      .waitFor({ state: "attached" });
    assert.equal(await w.locator('[data-tab="titles"]').count(), 0);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("agent");
      ipcMain.handle("agent", (_, req) => "收到技能 " + req.skillIds?.length);
    });
    await w.screenshot({path:"/tmp/aside-agent-chat.png"});
    await w.locator("#instruction").fill("检查这一段");
    await w.locator("#send").click();
    await w.locator(".message.assistant").waitFor();
    assert.match(
      await w.locator(".message.assistant").innerText(),
      /收到技能 1/,
    );
    console.log(
      "PASS skills UI: create, defaults, picker, request, removed old tabs",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
