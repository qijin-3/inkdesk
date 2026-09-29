const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

async function load(rel, out) {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", rel)],
    outfile: "/tmp/" + out,
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  return require("/tmp/" + out);
}

test("sameAccount 兼容 AI/Dev 后缀", async () => {
  const { sameAccount } = await load("ui/accounts.js", "accounts.test.cjs");
  assert.equal(sameAccount("a", "a"), true);
  assert.equal(sameAccount("x_AI", "AI"), true);
  assert.equal(sameAccount("x_Dev", "Dev"), true);
  assert.equal(sameAccount("a", "b"), false);
  assert.equal(sameAccount("", "b"), false);
  assert.equal(sameAccount(null, "b"), false);
});

test("accountInitial 取首字（含 emoji 与空值）", async () => {
  const { accountInitial } = await load("ui/accounts.js", "accounts.test.cjs");
  assert.equal(accountInitial("增长"), "增");
  assert.equal(accountInitial("  ab "), "a");
  assert.equal(accountInitial(""), "?");
  assert.equal(accountInitial(null), "?");
});

test("accountLabelOf 列表优先，未知回退", async () => {
  const { accountLabelOf } = await load("ui/accounts.js", "accounts.test.cjs");
  const list = [{ id: "a1", label: "主号" }];
  assert.equal(accountLabelOf(list, "a1"), "主号");
  assert.equal(accountLabelOf(list, "my_id"), "my id");
  assert.equal(accountLabelOf([], ""), "");
});

test("accountAvatarHtml 有图用图否则首字", async () => {
  const { accountAvatarHtml } = await load(
    "ui/accounts.js",
    "accounts.test.cjs",
  );
  const withImg = accountAvatarHtml({ label: "主", avatar: "a b.png" });
  assert.match(withImg, /account-avatar-img/);
  assert.match(withImg, /a%20b\.png/);
  const fallback = accountAvatarHtml({ label: "主号" });
  assert.match(fallback, /account-avatar-fallback/);
  assert.match(fallback, /主/);
});

test("formatJsonPreview 美化或原样", async () => {
  const { formatJsonPreview } = await load(
    "ui/materials-meta.js",
    "materials-meta.test.cjs",
  );
  assert.equal(formatJsonPreview('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(formatJsonPreview("not json"), "not json");
  assert.equal(formatJsonPreview(""), "");
});

test("inferMaterialKind 按扩展名", async () => {
  const { inferMaterialKind, uint8ToBase64 } = await load(
    "ui/materials-meta.js",
    "materials-meta.test.cjs",
  );
  assert.equal(inferMaterialKind("a.PNG"), "image");
  assert.equal(inferMaterialKind("doc.md"), "markdown");
  assert.equal(inferMaterialKind("p.html"), "html");
  assert.equal(inferMaterialKind("d.json"), "json");
  assert.equal(inferMaterialKind("n.csv"), "text");
  assert.equal(inferMaterialKind("bin.exe"), "binary");
  assert.equal(inferMaterialKind(""), "binary");
  const bytes = new TextEncoder().encode("hello");
  assert.equal(
    uint8ToBase64(bytes),
    Buffer.from("hello").toString("base64"),
  );
  assert.equal(uint8ToBase64(new Uint8Array(0)), "");
});

test("formatDelta 空值与符号", async () => {
  const { formatDelta } = await load("ui/metrics.js", "metrics.test.cjs");
  assert.equal(formatDelta(null), "");
  assert.equal(formatDelta(0), "");
  assert.equal(formatDelta("x"), "");
  assert.equal(formatDelta(1200), "+1,200");
  assert.equal(formatDelta(-5), "-5");
});
