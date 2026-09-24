const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-ui-"));
  const vaultRoot = path.join(dir, "Content_OS");
  for (const sub of ["00_Profile", "01_Topics", "02_Drafts", "03_Archive"])
    fs.mkdirSync(path.join(vaultRoot, "Demo_AI", sub), { recursive: true });
  const env = { ...process.env, INKDESK_DATA: dir, INKDESK_VAULT: vaultRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve("main.cjs")], env });
  try {
    const win = await app.firstWindow();
    const errors = [];
    win.on("pageerror", (e) => errors.push(e.message));
    await win.locator("#start").click();
    await win.locator("#title").fill("把写作还给自己");
    await win
      .locator(".paper .tiptap")
      .fill("最近写文章，我总在几个软件之间切换。\n我想把注意力放回文字本身。");
    await win.waitForTimeout(900);
    await win.locator("#layout").click();
    await win.locator("#copy-publish").click();
    const html = await app.evaluate(async ({ clipboard }) => {
      const items = await clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/html"))
          return (await item.getType("text/html")).text();
      }
      return "";
    });
    assert.match(html, /最近写文章/);
    assert.match(html, /line-height/);
    await win.locator('[data-tab="titles"]').click();
    await win.screenshot({ path: path.resolve("screenshot-writing.png") });
    await win.locator('[data-page="dashboard"]').click();
    await win.screenshot({ path: path.resolve("screenshot-dashboard.png") });
    await win.locator(".doc").first().click();
    await win.waitForTimeout(700);
    const saved = fs.readFileSync(
      path.join(vaultRoot, "Demo_AI/02_Drafts/把写作还给自己.md"),
      "utf8",
    );
    assert.match(saved, /注意力/);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: create, rich editing, autosave, publish clipboard, tabs, dashboard.",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
