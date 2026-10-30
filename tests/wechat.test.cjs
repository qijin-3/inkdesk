const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Wechat = require("../core/wechat.cjs");

const core = (store = {}) => ({
  store,
  vault: null,
  data: "/tmp/x",
  wechatTokenCache: {},
});

test("publicWechatAccounts 跳过脏数据只吐快照", () => {
  const out = Wechat.publicWechatAccounts(
    core({ wechatAccounts: { a: { appId: "1", appSecret: "2", author: "n", coverPath: "c", extra: 1 }, b: null, c: "x" } }),
  );
  assert.deepEqual(out, { a: { appId: "1", appSecret: "2", author: "n", coverPath: "c" } });
});

test("wechatConfig 缺凭证抛错/回退全局", () => {
  assert.throws(() => Wechat.wechatConfig(core({})), /AppID/);
  const cfg = Wechat.wechatConfig(core({ wechat: { appId: " 1 ", appSecret: "2" } }));
  assert.equal(cfg.appId, "1");
});

test("wechatConfig 按账号读 wechatAccounts，无 account 不误用其它账号", () => {
  const store = {
    wechatAccounts: {
      Brand_AI: { appId: "wx-a", appSecret: "sec-a", author: "甲" },
    },
    wechat: {},
  };
  const cfg = Wechat.wechatConfig(core(store), "Brand_AI");
  assert.equal(cfg.appId, "wx-a");
  assert.equal(cfg.author, "甲");
  // 已发布预览曾漏传 account：应仍报缺凭证，而不是静默成功用错号
  assert.throws(() => Wechat.wechatConfig(core(store)), /AppID/);
  assert.throws(() => Wechat.wechatConfig(core(store), ""), /AppID/);
});

test("wechatTokenBucket 同 appId 同桶", () => {
  const c = core({});
  assert.equal(Wechat.wechatTokenBucket(c, "a"), Wechat.wechatTokenBucket(c, "a"));
});

test("loadWechatImageBuffer data URL 解析；非法输入为 null", () => {
  const tiny = "data:image/png;base64," + Buffer.from("hi").toString("base64");
  const r = Wechat.loadWechatImageBuffer(core({}), tiny);
  assert.equal(r.name, "block.png");
  assert.equal(r.buf.toString(), "hi");
  assert.equal(Wechat.loadWechatImageBuffer(core({}), "data:image/png;base64,"), null);
  assert.equal(Wechat.loadWechatImageBuffer(core({}), null), null);
  assert.equal(Wechat.loadWechatImageBuffer(core({}), "https://x/y.png"), null);
});

test("resolveWechatImageSrc 非法输入给 null", () => {
  const c = core({});
  assert.equal(Wechat.resolveWechatImageSrc(c, ""), null);
  assert.equal(Wechat.resolveWechatImageSrc(c, "notaurl"), null);
});

test("pushWechatDraft 超 2 万字符时错误带上当前长度", async () => {
  const wechatMp = require("../wechat-mp.cjs");
  const orig = {
    getAccessToken: wechatMp.getAccessToken,
    uploadContentImage: wechatMp.uploadContentImage,
    uploadPermanentImage: wechatMp.uploadPermanentImage,
    addDraft: wechatMp.addDraft,
  };
  wechatMp.getAccessToken = async () => "tok";
  wechatMp.uploadContentImage = async () => "https://mmbiz.qpic.cn/x/0";
  wechatMp.uploadPermanentImage = async () => "thumb";
  wechatMp.addDraft = async () => "mid";
  const c = core({
    wechat: { appId: "wx", appSecret: "sec", coverPath: "/tmp/no-cover" },
  });
  const html = `<p>${"字".repeat(20001)}</p>`;
  await assert.rejects(
    () => Wechat.pushWechatDraft(c, { title: "t", html }),
    /正文 HTML 超过 2 万字符（当前 200\d{2}）/,
  );
  Object.assign(wechatMp, orig);
});

test("pushWechatDraft 上传块图后正文不含 data URL 且低于长度上限", async () => {
  const wechatMp = require("../wechat-mp.cjs");
  const orig = {
    getAccessToken: wechatMp.getAccessToken,
    uploadContentImage: wechatMp.uploadContentImage,
    uploadPermanentImage: wechatMp.uploadPermanentImage,
    addDraft: wechatMp.addDraft,
    readImageForUpload: wechatMp.readImageForUpload,
  };
  const coverPath = path.join(os.tmpdir(), `inkdesk-cover-${process.pid}.png`);
  fs.writeFileSync(coverPath, Buffer.from("cover"));
  let uploaded = 0;
  let draft = null;
  wechatMp.getAccessToken = async () => "tok";
  wechatMp.uploadContentImage = async () =>
    `https://mmbiz.qpic.cn/block/${++uploaded}.png`;
  wechatMp.uploadPermanentImage = async () => "thumb";
  wechatMp.readImageForUpload = () => ({
    buf: Buffer.from("cover"),
    name: "cover.png",
  });
  wechatMp.addDraft = async (_token, article) => {
    draft = article;
    return "mid";
  };
  try {
    const html = `<section>${["一级标题", "二级标题", "引用"]
      .map((alt, i) => {
        const src =
          "data:image/png;base64," +
          Buffer.from(`block-image-${i}`).toString("base64");
        return `<img src="${src}" alt="${alt}">`;
      })
      .join("")}</section>`;
    const result = await Wechat.pushWechatDraft(
      core({
        wechat: {
          appId: "wx",
          appSecret: "sec",
          coverPath,
        },
      }),
      { title: "t", html },
    );
    assert.equal(uploaded, 3);
    assert.equal(result.imageCount, 3);
    assert.ok(draft.content.length < 20000);
    assert.doesNotMatch(draft.content, /data:image/);
    assert.equal(
      (draft.content.match(/https:\/\/mmbiz\.qpic\.cn\/block\//g) || []).length,
      3,
    );
  } finally {
    Object.assign(wechatMp, orig);
    fs.unlinkSync(coverPath);
  }
});
