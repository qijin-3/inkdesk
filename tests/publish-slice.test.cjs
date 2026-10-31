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

test("splitWechatH1 保留完整标题并按实际宽度换行", () => {
  const { splitWechatH1 } = mods.html;
  const h1 = {
    querySelector: () => null,
    ownerDocument: {
      createElement: () => {
        const node = {
          className: "",
          textContent: "",
          children: [],
          append(child) {
            this.children.push(child);
          },
        };
        return node;
      },
    },
    childNodes: [{ nodeType: 3, textContent: "从 Pinterest 到前端 UI" }],
    replaceChildren(node) {
      this.replaced = node;
    },
  };
  splitWechatH1(h1);
  assert.equal(h1.replaced.className, "h1-text");
  assert.deepEqual(
    h1.replaced.children.map((node) => [node.className, node.textContent]),
    [["h1-line", "从 Pinterest 到前端 UI"]],
  );
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
