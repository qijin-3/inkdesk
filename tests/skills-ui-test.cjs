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
  const skillDir = path.join(vaultRoot, ".agents/skills/fact-check");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: fact-check\ndescription: 核实来源与待核实标注\n---\n\n核对事实。\n",
  );
  fs.mkdirSync(path.join(vaultRoot, "_system/inkdesk"), { recursive: true });
  fs.writeFileSync(
    path.join(vaultRoot, "_system/inkdesk/skills.json"),
    JSON.stringify({ revision: 1, bindings: { "fact-check": "all" } }),
  );
  const env = { ...process.env, INKDESK_DATA: dir, INKDESK_VAULT: vaultRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, "..", "main.cjs")], env });
    const w = await app.firstWindow();
    await w.locator('[data-page="settings"]').click();
    await w.locator('[data-settings-tab="skills"]').click();
    await w.waitForFunction(() =>
      document
        .querySelector(".skill-card-list")
        ?.textContent.includes("fact-check"),
    );
    await w.waitForFunction(() =>
      document
        .querySelector('[data-skill-accounts="fact-check"] summary')
        ?.textContent.includes("全局"),
    );
    assert.ok(
      fs.existsSync(
        path.join(vaultRoot, ".agents/skills/fact-check/SKILL.md"),
      ),
    );
    assert.equal(await w.locator("#skill-new").count(), 0);
    assert.ok(
      (await w.locator("#skill-reveal-root").textContent()).includes(
        "查看本地文件",
      ),
    );
    assert.ok(
      (await w.locator("#skill-import").textContent()).includes("导入技能"),
    );
    await w.locator("#new").click();
    await w.locator("#toggle-assistant").click();
    await w.locator("#chat-upload").click();
    await w
      .locator('#composer-add-menu [data-skill-id="fact-check"]')
      .waitFor({ state: "attached" });
    await w.locator('#composer-add-menu [data-skill-id="fact-check"]').click();
    await w.locator("#instruction .inline-reference").waitFor();
    assert.ok(
      (await w.locator("#instruction .inline-reference").innerText()).includes(
        "fact-check",
      ),
    );
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("agent");
      ipcMain.handle("agent", (_, req) => "收到技能 " + req.skillIds?.length);
    });
    await w.locator("#composer-input").click();
    await w.keyboard.type("检查这一段");
    await w.locator("#send").click();
    await w.waitForFunction(() =>
      document.body.innerText.includes("收到技能"),
    );
    console.log("PASS skills UI: tree page, bindings, picker, symlink store");
  } finally {
    await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
