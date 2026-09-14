const { _electron: electron } = require("@playwright/test"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-package-"));
  const env = { ...process.env, INKDESK_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: path.resolve(
      "dist-v4/Inkdesk-darwin-arm64/Inkdesk.app/Contents/MacOS/Inkdesk",
    ),
    args: [],
    env,
  });
  try {
    const w = await app.firstWindow();
    const info = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
    }));
    const { extractFile } = await import("@electron/asar");
    info.config = JSON.parse(
      extractFile(
        path.resolve(
          "dist-v4/Inkdesk-darwin-arm64/Inkdesk.app/Contents/Resources/app.asar",
        ),
        "development-vault.json",
      ).toString(),
    );
    assert.equal(info.packaged, true);
    assert.equal(info.version, "0.4.0");
    assert.equal(
      info.config.developmentVault,
      "/Users/jin/Documents/Dev/Content_OS-dev",
    );
    await w.locator("#start").click();
    await w.locator("#title").fill("打包验证");
    await w.locator(".paper .tiptap").fill("独立运行保存成功");
    await w.waitForTimeout(800);
    assert.match(
      fs.readFileSync(
        path.join(dir, "Content_OS/金奇_AI/02_Drafts/打包验证.md"),
        "utf8",
      ),
      /独立运行保存成功/,
    );
    const reader = path.resolve(
      "dist-v4/Inkdesk-darwin-arm64/Inkdesk.app/Contents/Resources/reference-reader",
    );
    assert(fs.existsSync(reader));
    const { execFileSync } = require("node:child_process");
    assert.match(
      execFileSync(reader, ["/tmp/ink-reference-test.png"], {
        encoding: "utf8",
      }),
      /6789/,
    );
    console.log(
      "PASS packaged 0.4.0: embedded dev config, launch, edit, Markdown save",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
