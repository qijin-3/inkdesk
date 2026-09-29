const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

let mod;
test.before(async () => {
  // ui/*.js 是 ESM（随 renderer 进 esbuild bundle）；单测时用 esbuild 转成 CJS 再加载，
  // 测的是同一份源码，避免为测试维护第二份实现。
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "review-diff-")),
    "review-diff.cjs",
  );
  await esbuild.build({
    entryPoints: [path.join(__dirname, "ui", "review-diff.js")],
    outfile: out,
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  mod = require(out);
});

test("diffHTML 转义并标记增删", () => {
  const html = mod.diffHTML("a<b", "a<b c");
  assert.match(html, /<span>a&lt;b <\/span>/);
  assert.match(html, /<ins>c<\/ins>/);
  assert.equal(mod.diffHTML("", ""), "");
});

test("buildEditHunks 拆出行级 change/equal", () => {
  const hunks = mod.buildEditHunks("a\nb\n", "a\nc\n");
  assert.equal(hunks[0].kind, "equal");
  const ch = hunks.find((h) => h.kind === "change");
  assert.equal(ch.old, "b\n");
  assert.equal(ch.next, "c\n");
  assert.equal(ch.status, "pending");
  assert.ok(ch.id);
});

test("buildEditHunks 全等文本不产生待审 change", () => {
  const hunks = mod.buildEditHunks("same", "same");
  // 结构保护把 trim 全等的 change 降级为 equal：无可审内容
  assert.equal(
    hunks.filter((h) => h.kind === "change").length,
    0,
  );
});

test("buildEditHunks 保护误删配图与标题", () => {
  const hunks = mod.buildEditHunks("# T\n![](a.png)\nbody\n", "body changed\n");
  const ch = hunks.find((h) => h.kind === "change");
  assert.match(ch.next, /!\[\]\(a\.png\)/);
  assert.match(ch.next, /# T/);
});

test("composeHunks 按接受/拒绝合成", () => {
  const out = mod.composeHunks([
    { kind: "equal", value: "a\n" },
    { kind: "change", old: "b\n", next: "c\n", status: "accepted" },
    { kind: "change", old: "d\n", next: "e\n", status: "rejected" },
  ]);
  assert.equal(out, "a\nc\nd\n");
});

test("protectStructure 补回配图标题并提示", () => {
  const { next, notes } = mod.protectStructure("# T\n![](a.png)\n", "body\n");
  assert.match(next, /!\[\]\(a\.png\)/);
  assert.match(next, /# T/);
  assert.ok(notes.length >= 2);
  const clean = mod.protectStructure("a", "a");
  assert.deepEqual(clean.notes, []);
});
