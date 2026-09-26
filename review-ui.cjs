const { _electron: electron } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-review-"));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "ink-source-"));
  fs.writeFileSync(
    path.join(src, "pic.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  fs.writeFileSync(path.join(src, "article.md"), "正文\n![[pic.png]]");
  fs.writeFileSync(
    path.join(dir, "workspace.json"),
    JSON.stringify({ source: src }),
  );
  const vaultRoot=path.join(dir,"Content_OS");
  for(const sub of ["00_Profile","01_Topics","02_Drafts","03_Archive"]) fs.mkdirSync(path.join(vaultRoot,"Demo_AI",sub),{recursive:true});
  const env = { ...process.env, INKDESK_DATA: dir, INKDESK_VAULT:vaultRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve("main.cjs")], env });
  try {
    const w = await app.firstWindow();
    w.setDefaultTimeout(6000);
    await w.locator("#new").click();
    await w.locator("#toggle-assistant").click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("agent");
      ipcMain.handle("agent", () => "这是更自然的表达。");
    });
    await w.locator(".paper .tiptap").fill("这是原始的表达。");
    await w.locator(".paper .tiptap").press("Meta+a");
    await w.locator("#agent-output").selectOption("rewrite");
    await w.locator("#send").click();
    await w.waitForTimeout(300);
    await w.locator("#accept").waitFor();
    await w.locator("#reject").click();
    assert.match(await w.locator(".paper .tiptap").textContent(), /原始/);
    await w.locator(".paper .tiptap").click();
    await w.locator(".paper .tiptap").press("Meta+a");
    await w.locator("#agent-output").selectOption("rewrite");
    await w.locator("#send").click();
    await w.waitForTimeout(300);
    await w.locator("#accept").click();
    assert.match(await w.locator(".paper .tiptap").textContent(), /自然/);
    await w.locator(".paper .tiptap").click();
    await w.locator(".paper .tiptap").press("Meta+a");
    await w.locator("#agent-output").selectOption("rewrite");
    await w.locator("#send").click();
    await w.waitForTimeout(300);
    await w.locator("#accept").waitFor();
    await w.locator(".paper .tiptap").fill("用户刚刚改过的新正文");
    await w.locator("#accept").click();
    assert.match(await w.locator(".paper .tiptap").textContent(), /用户刚刚/);
    console.log("PASS: proposal reject/accept, stale proposal protection.");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
