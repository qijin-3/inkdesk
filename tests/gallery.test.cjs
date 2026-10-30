const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let mod;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "ui", "gallery.js")],
    outfile: "/tmp/gallery.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  mod = require("/tmp/gallery.test.cjs");
});

test("galleryImages 解析 inkasset 图片、按账号过滤并去重", () => {
  const body = (rel) =>
    `正文\n![图片](inkasset://vault/${encodeURIComponent(rel)})\n尾`;
  const st = {
    documents: [
      { account: "A", title: "甲", body: body("Attachment/甲/file-1.png") },
      { account: "A", title: "乙", body: body("Attachment/甲/file-1.png") },
      { account: "B", title: "丙", body: body("Attachment/丙/file-2.jpg") },
    ],
    archives: [
      { account: "A", title: "已发", body: body("Attachment/甲/file-1.png") },
    ],
  };
  const items = mod.galleryImages(st, "A");
  assert.equal(items.length, 1);
  assert.equal(items[0].path, "Attachment/甲/file-1.png");
  assert.equal(items[0].name, "file-1.png");
  assert.equal(items[0].src, "inkasset://vault/Attachment%2F%E7%94%B2%2Ffile-1.png");
  assert.deepEqual(items[0].articles, ["甲", "乙", "已发"]);
});

test("galleryImages 支持 AI/Dev 后缀账号别名", () => {
  const st = {
    documents: [
      {
        account: "Demo_AI",
        title: "t",
        body: "![图片](inkasset://vault/a.png)",
      },
    ],
  };
  assert.equal(mod.galleryImages(st, "AI").length, 1);
  assert.equal(mod.galleryImages(st, "Dev").length, 0);
});

test("galleryImages 兼容网页版 /api/asset/vault 地址并与之去重", () => {
  const st = {
    documents: [
      {
        account: "A",
        title: "网页稿",
        body: "![图片](/api/asset/vault/Attachment%2F%E7%94%B2%2Ffile-1.png)",
      },
      {
        account: "A",
        title: "本地稿",
        body: "![图片](inkasset://vault/Attachment%2F%E7%94%B2%2Ffile-1.png)",
      },
      {
        account: "A",
        title: "网页图二",
        body: "![图片](/api/asset/vault/b.png)",
      },
    ],
  };
  const items = mod.galleryImages(st, "A");
  assert.equal(items.length, 2);
  const one = items.find((i) => i.path === "Attachment/甲/file-1.png");
  assert.deepEqual(one.articles, ["网页稿", "本地稿"]);
  assert.equal(one.src, "inkasset://vault/Attachment%2F%E7%94%B2%2Ffile-1.png");
  assert.ok(items.some((i) => i.path === "b.png"));
});

test("galleryGridHTML 空态与卡片转义", () => {
  assert.match(mod.galleryGridHTML([]), /empty-state/);
  const html = mod.galleryGridHTML([
    {
      src: "inkasset://vault/a.png",
      name: "<x>.png",
      articles: ["<b>", "c"],
    },
  ]);
  assert.match(html, /class="gallery-card"/);
  assert.match(html, /data-gallery-copy="0"/);
  assert.match(html, /&lt;x&gt;\.png/);
  assert.match(html, /等 2 篇/);
  assert.doesNotMatch(html, /<x>\.png/);
});
