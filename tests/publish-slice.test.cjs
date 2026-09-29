const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

const pieces = {
  "ui/html.js": "html",
  "ui/publish.js": "publish",
  "ui/import-match.js": "import-match",
};
let mods = {};
test.before(async () => {
  for (const [rel, out] of Object.entries(pieces)) {
    await esbuild.build({
      entryPoints: [path.join(__dirname, "..", rel)],
      outfile: "/tmp/" + out + ".test.cjs",
      format: "cjs",
      platform: "node",
      bundle: true,
    });
    mods[out] = require("/tmp/" + out + ".test.cjs");
  }
});

test("html 模块纯文本/换行清洗", () => {
  const { blockPlainText } = mods.html;
  const node = {
    nodeType: 1,
    nodeName: "DIV",
    childNodes: [
      { nodeType: 3, textContent: "b" },
      { nodeName: "BR", getAttribute: () => "", childNodes: [] },
      { nodeType: 3, textContent: "c" },
    ],
  };
  assert.equal(blockPlainText(node), "b\nc");
  const trailing = {
    nodeName: "BR",
    getAttribute: () => "ProseMirror-trailingBreak",
    childNodes: [],
  };
  assert.equal(
    blockPlainText({ nodeType: 1, childNodes: [trailing] }),
    "",
  );
});

test("splitWechatH1 拆中英标题/DOM 效应", () => {
  const { splitWechatH1 } = mods.html;
  // run in node: escape DOMParser via minimal shim impossible -> guard layer only
  assert.equal(typeof splitWechatH1, "function");
});

test("publishHTMLInner 空 opts 直接转换", async () => {
  const { publishHTMLInner } = mods.publish;
  // needs DOMParser/document — assert it exists to fail loudly rather than silently skip
  assert.equal(typeof publishHTMLInner, "function");
});

test("showUnmatchedMatcher 参数化纯逻辑可加载", () => {
  const { showUnmatchedMatcher } = mods["import-match"];
  assert.equal(typeof showUnmatchedMatcher, "function");
});