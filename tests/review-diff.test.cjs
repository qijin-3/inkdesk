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
    entryPoints: [path.join(__dirname, "..", "ui", "review-diff.js")],
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

test("reviewPlainHTML/reviewNewHTML 转义与换行", () => {
  assert.equal(mod.reviewPlainHTML("", "（空段落）"), "（空段落）");
  assert.equal(mod.reviewPlainHTML("a<b\nc"), "a&lt;b<br>c");
  assert.equal(mod.reviewNewHTML({ next: "x\ny" }), "x<br>y");
  assert.equal(mod.reviewNewHTML({ next: "  " }), "");
});

test("reviewOldDiffHTML 有 diff 用高亮、无 diff 回退纯文本", () => {
  const html = mod.reviewOldDiffHTML({ old: "ab", next: "ac" });
  assert.match(html, /<ins>|<del>/);
  assert.equal(mod.reviewOldDiffHTML({ old: "", next: "" }), "（空段落）");
});

test("reviewEqualHTML 按空行分段", () => {
  const html = mod.reviewEqualHTML("p1\nline2\n\np2");
  assert.match(html, /review-para/);
  assert.match(html, /p1<br>line2/);
  assert.match(html, /p2/);
  assert.equal(mod.reviewEqualHTML(""), "");
});
test("reviewPageHTML 显式传参与空态", () => {
  assert.equal(mod.reviewPageHTML(null, "T"), "");
  assert.equal(mod.reviewPageHTML({}, "T"), "");
  const html = mod.reviewPageHTML(
    {
      doc: "d1",
      hunks: [
        { kind: "equal", value: "首段" },
        { kind: "change", id: "h1", old: "ab", next: "ac", status: "pending" },
        { kind: "change", id: "h2", old: "x", next: "", status: "accepted" },
      ],
    },
    "我的标题",
  );
  assert.match(html, /我的标题/);
  assert.match(html, /首段/);
  assert.match(html, /data-review-hunk="h1"/);
  assert.match(html, /is-decided is-accepted/);
  assert.match(html, /（已删除）/);
});

test("summarizeRewrite 统计润色与标点", () => {
  const plan = { hunks: [
    { kind: "change", old: "你好，世界", next: "你好世界" },
    { kind: "change", old: "abc", next: "abx" },
    { kind: "equal", value: "same" },
  ] };
  const out = mod.summarizeRewrite(plan);
  assert.match(out, /共 2 处修改/);
  assert.match(out, /1 处文字润色/);
  assert.match(out, /1 处标点 \/ 断句微调/);
  assert.match(out, /未动大结构/);
  assert.equal(mod.summarizeRewrite(null).includes("共 0 处修改"), true);
});
