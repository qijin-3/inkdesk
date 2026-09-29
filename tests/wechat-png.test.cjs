const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let mod;
test.before(async () => {
  // 同 review-diff：ESM 源码经 esbuild 转 CJS 后测试，保证测的是同一份实现。
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "ui", "wechat-png.js")],
    outfile: "/tmp/wechat-png.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  mod = require("/tmp/wechat-png.test.cjs");
});

/** 按宽度 10px/字符计的假 ctx */
const fakeCtx = () => ({
  measureText: (s) => ({ width: String(s).length * 10 }),
});

test("normalizeHeadingText 压空格去空行", () => {
  assert.equal(mod.normalizeHeadingText("  a   b \n\n c \n"), "a b\nc");
  assert.equal(mod.normalizeHeadingText(""), "");
});

test("wechatWrapLines 按中文字符换行", () => {
  assert.deepEqual(mod.wechatWrapLines(fakeCtx(), "abcdef", 35), ["abc", "def"]);
  assert.deepEqual(mod.wechatWrapLines(fakeCtx(), "ab\ncdef", 35), [
    "ab",
    "cde",
    "f",
  ]);
  assert.deepEqual(mod.wechatWrapLines(fakeCtx(), "", 10), [""]);
});

test("splitH1ZhEn 拆中英标题", () => {
  assert.deepEqual(mod.splitH1ZhEn("增长实战 Growth Playbook"), {
    zh: "增长实战",
    en: "Growth Playbook",
  });
  assert.deepEqual(mod.splitH1ZhEn("纯中文标题"), {
    zh: "纯中文标题",
    en: "",
  });
  assert.deepEqual(mod.splitH1ZhEn(""), { zh: "", en: "" });
});

test("主题常量与原实现一致", () => {
  assert.equal(mod.WECHAT_BLUE, "#0f3ff7");
  assert.equal(mod.WECHAT_BLOCK_W, 360);
  assert.equal(mod.WECHAT_BLOCK_SCALE, 4);
});
