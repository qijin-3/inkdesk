const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let mod;
test.before(async () => {
  // 同 review-diff：ESM 源码经 esbuild 转 CJS 后测试，保证测的是同一份实现。
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "ui", "groups.js")],
    outfile: "/tmp/groups.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  mod = require("/tmp/groups.test.cjs");
});

const st = () => ({
  groups: { 增长: { backupPath: "/g" }, 产品: {} },
  backupPaths: { a1: "/a1" },
  metrics: [{ path: "p1", 分组: " 增长 " }],
  archives: [{ path: "p2", group: "产品" }],
});

test("groupNames 中文排序", () => {
  assert.deepEqual(mod.groupNames(st()), ["产品", "增长"]);
  assert.deepEqual(mod.groupNames({}), []);
});

test("groupChipTone 稳定且 chip 转义", () => {
  assert.equal(mod.groupChipTone("增长"), mod.groupChipTone("增长"));
  assert.ok(mod.groupChipTone("x") >= 0 && mod.groupChipTone("x") < 8);
  assert.match(mod.groupChipHtml("<b>"), /&lt;b&gt;/);
  assert.match(
    mod.groupChipHtml("增长"),
    new RegExp(`group-chip-${mod.groupChipTone("增长")}`),
  );
});

test("publishedGroup 优先 metrics，其次 archive", () => {
  const s = st();
  assert.equal(mod.publishedGroup(s, "p1"), "增长");
  assert.equal(mod.publishedGroup(s, "p2"), "产品");
  assert.equal(mod.publishedGroup(s, "nope"), null);
});

test("backupPathFor 分组优先，缺省回退账号", () => {
  const s = st();
  assert.equal(mod.backupPathFor(s, "增长", "a1"), "/g");
  assert.equal(mod.backupPathFor(s, "产品", "a1"), "/a1");
  assert.equal(mod.backupPathFor(s, null, "a1"), "/a1");
  assert.equal(mod.backupPathFor(s, "增长", "no"), "/g");
  assert.equal(mod.backupPathFor({}, "x", "y"), "");
});

test("groupOptionsHtml 选中态与空选项", () => {
  const html = mod.groupOptionsHtml(st(), "增长");
  assert.match(html, /<option value="">无分组<\/option>/);
  assert.match(html, /<option value="增长" selected>/);
  const noEmpty = mod.groupOptionsHtml(st(), null, { allowEmpty: false });
  assert.doesNotMatch(noEmpty, /无分组/);
  const custom = mod.groupOptionsHtml(st(), null, { emptyLabel: "全部" });
  assert.match(custom, /全部/);
});
