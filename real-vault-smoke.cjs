const { _electron: electron } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = process.env.INKDESK_VAULT || process.env.CONTENT_OS_ROOT;
if (!root) {
  console.error("Set INKDESK_VAULT or CONTENT_OS_ROOT to a Content_OS directory");
  process.exit(1);
}
function hashes(dir, result = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      e.name.startsWith(".") ||
      ["inkdesk", "node_modules"].includes(e.name) ||
      e.isSymbolicLink()
    )
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hashes(p, result);
    else if (e.name.endsWith(".md"))
      result[p] = crypto
        .createHash("sha256")
        .update(fs.readFileSync(p))
        .digest("hex");
  }
  return result;
}
(async () => {
  const before = hashes(root),
    data = fs.mkdtempSync(path.join(os.tmpdir(), "ink-real-"));
  const env = { ...process.env, INKDESK_DATA: data, INKDESK_VAULT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve("main.cjs")], env });
  try {
    const w = await app.firstWindow();
    w.setDefaultTimeout(10000);
    const errors = [];
    w.on("pageerror", (e) => errors.push(e.message));
    await w.locator(".doc").first().waitFor();
    const state = await w.evaluate(() => window.desk.call("load"));
    console.log(
      JSON.stringify(
        {
          drafts: state.documents.length,
          archives: state.archives.length,
          materials: state.materials.length,
          warnings: state.warnings,
        },
        null,
        2,
      ),
    );
    await w.screenshot({ path: "screenshot-writing.png" });
    await w.locator('[data-page="dashboard"]').click();
    await w.screenshot({ path: "screenshot-dashboard.png" });
    await w.locator('[data-page="settings"]').click();
    await w.locator('[data-settings-tab="accounts"]').click();
    await w.locator('[data-open-account]').first().click();
    await w.locator("[data-model-tab]").first().waitFor();
    await w.locator("[data-model-tab]").first().click();
    await w.screenshot({ path: "screenshot-profile.png" });
    await w.locator('[data-page="materials"]').click();
    await w.locator(".doc").first().click();
    assert.deepEqual(errors, []);
    const after = hashes(root);
    for (const [p, h] of Object.entries(before)) assert.equal(after[p], h, p);
    console.log(
      "PASS real development copy: navigation leaves existing Markdown unchanged",
    );
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
