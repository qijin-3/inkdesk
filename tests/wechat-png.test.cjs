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

test("主题常量与原实现一致", () => {
  assert.equal(mod.WECHAT_BLUE, "#0f3ff7");
  assert.equal(mod.WECHAT_BLOCK_W, 360);
  assert.equal(mod.WECHAT_BLOCK_SCALE, 4);
  assert.match(mod.WECHAT_SANS_PUBLISH, /PingFang SC/);
  assert.ok(!mod.WECHAT_SANS_PUBLISH.includes("OPPO"));
});

test("公众号块主题与预览新版样式一致", () => {
  const theme = mod.WECHAT_BLOCK_THEME;
  assert.equal(mod.WECHAT_BLUE_SOFT, "#f2f5ff");
  assert.equal(theme.h1.fontSize, 20);
  assert.equal(theme.h1.fontWeight, 700);
  assert.match(theme.h1.fontFamily, /PingFang SC/);
  assert.equal(theme.h2.fontSize, 15);
  assert.equal(theme.h2.fontWeight, 600);
  assert.equal(theme.h2.prefix, "## ");
  assert.equal(theme.quote.fontSize, 15);
  assert.equal(theme.quote.fontWeight, 300);
  assert.equal(theme.quote.markFontSize, 18.75);
  assert.equal(theme.quote.markFontWeight, 700);
  assert.match(mod.wechatBlockCSS("h2"), /font-size:15px/);
  assert.match(mod.wechatBlockCSS("quote"), /background:#f2f5ff/);
});

test("推送块图使用共享主题而非旧宋体参数", () => {
  const fonts = [];
  const fills = [];
  const texts = [];
  const ctx = {
    scale() {},
    measureText: (value) => ({ width: String(value).length * 10 }),
    fillRect() {},
    fillText(value) {
      texts.push(value);
    },
    set font(value) {
      fonts.push(value);
    },
    set fillStyle(value) {
      fills.push(value);
    },
    set textBaseline(value) {},
    set imageSmoothingEnabled(value) {},
    set imageSmoothingQuality(value) {},
    set letterSpacing(value) {},
  };
  const prevDocument = global.document;
  global.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,x",
      };
    },
  };
  try {
    mod.renderWechatH1Png("增长 Growth Playbook", "01");
    mod.renderWechatH2Png("增长方法");
    mod.renderWechatQuotePng("一句引用");
  } finally {
    global.document = prevDocument;
  }
  assert.ok(fonts.some((f) => /700 20px/.test(f)));
  assert.ok(fonts.some((f) => /600 15px/.test(f)));
  assert.ok(fonts.some((f) => /300 15px/.test(f)));
  assert.ok(fonts.every((f) => !/Songti|STSong|SimSun/i.test(f)));
  assert.ok(texts.includes("—— 01"));
  assert.ok(texts.some((t) => String(t).startsWith("## ")));
  assert.ok(fills.includes("#f2f5ff"));
});

test("H1 宽度足够时按实际宽度单行渲染", () => {
  const texts = [];
  const ctx = {
    scale() {},
    measureText: (value) => ({ width: String(value).length * 10 }),
    fillRect() {},
    fillText(value) {
      texts.push(value);
    },
    set font(value) {},
    set fillStyle(value) {},
    set textBaseline(value) {},
    set imageSmoothingEnabled(value) {},
    set imageSmoothingQuality(value) {},
    set letterSpacing(value) {},
  };
  const prevDocument = global.document;
  global.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,x",
      };
    },
  };
  try {
    mod.renderWechatH1Png("从 Pinterest 到前端 UI", "01");
  } finally {
    global.document = prevDocument;
  }
  assert.ok(texts.includes("从 Pinterest 到前端 UI"));
  assert.ok(!texts.includes("UI"));
});
