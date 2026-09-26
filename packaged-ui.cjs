const { _electron: electron } = require("@playwright/test"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const pkg = require("./package.json");
(async () => {
  const asar = path.resolve(
    "dist-0.2.2/AsIde-darwin-arm64/AsIde.app/Contents/Resources/app.asar",
  );
  const { listPackage, extractFile } = await import("@electron/asar");
  const files = listPackage(asar);
  assert.ok(
    !files.includes("/vault.json") && !files.includes("vault.json"),
    "packaged app must not embed vault.json",
  );
  for (const rel of ["desk-core.cjs", "vault.cjs", "renderer.js", "bundle.js"]) {
    const text = extractFile(asar, rel).toString("utf8");
    assert.ok(!text.includes("金奇"), `${rel} must not contain 金奇`);
    assert.ok(!text.includes("/Users/jin"), `${rel} must not contain /Users/jin`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-package-"));
  const vaultRoot = path.join(dir, "Content_OS");
  fs.mkdirSync(path.join(vaultRoot, "Demo_AI/02_Drafts"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "Demo_AI/00_Profile"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "Demo_AI/01_Topics"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "Demo_AI/03_Archive"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "workspace.json"),
    JSON.stringify({ version: 2, vaultPath: vaultRoot, provider: "cursor" }, null, 2),
  );
  const env = { ...process.env, INKDESK_DATA: dir, INKDESK_VAULT: vaultRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: path.resolve(
      "dist-0.2.2/AsIde-darwin-arm64/AsIde.app/Contents/MacOS/AsIde",
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
    assert.equal(info.packaged, true);
    assert.equal(info.version, pkg.version);
    await w.locator("[data-account]").first().waitFor({ timeout: 10000 });
    await w.locator("#new").click();
    await w.locator("#title").fill("打包验证");
    await w.locator(".paper .tiptap").fill("独立运行保存成功");
    await w.waitForTimeout(800);
    assert.match(
      fs.readFileSync(
        path.join(vaultRoot, "Demo_AI/02_Drafts/打包验证.md"),
        "utf8",
      ),
      /独立运行保存成功/,
    );
    const reader = path.resolve(
      "dist-0.2.2/AsIde-darwin-arm64/AsIde.app/Contents/Resources/reference-reader",
    );
    assert(fs.existsSync(reader));
    console.log(
      `PASS packaged ${pkg.version}: no personal config, launch, edit, Markdown save`,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
