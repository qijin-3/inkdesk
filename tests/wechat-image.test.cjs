const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  CONTENT_MAX_BYTES,
  ensureImageMaxBytes,
} = require("../wechat-image.cjs");
const Wechat = require("../core/wechat.cjs");

const logo = path.join(__dirname, "..", "assets", "logo.png");

function makeOversizedJpeg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-wximg-test-"));
  const out = path.join(dir, "file-oversized.jpg");
  const r = spawnSync(
    "sips",
    [
      "-z",
      "4200",
      "4200",
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "100",
      logo,
      "--out",
      out,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !fs.existsSync(out)) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw Error(`sips 生成测试图失败：${r.stderr || r.stdout || r.status}`);
  }
  const buf = fs.readFileSync(out);
  return { dir, out, buf };
}

test("ensureImageMaxBytes 未超限原样返回", () => {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const r = ensureImageMaxBytes(buf, CONTENT_MAX_BYTES, "tiny.jpg");
  assert.equal(r.buf, buf);
  assert.equal(r.name, "tiny.jpg");
});

test("ensureImageMaxBytes 空缓冲抛错", () => {
  assert.throws(() => ensureImageMaxBytes(Buffer.alloc(0), 100, "a.jpg"), /空/);
});

test(
  "ensureImageMaxBytes 超 1MB 自动压成 jpg 且 ≤ 上限",
  { skip: process.platform !== "darwin" },
  () => {
    const { dir, buf, out } = makeOversizedJpeg();
    try {
      assert.ok(buf.length > CONTENT_MAX_BYTES, `fixture 应 >1MB，实际 ${buf.length}`);
      const r = ensureImageMaxBytes(buf, CONTENT_MAX_BYTES, path.basename(out));
      assert.match(r.name, /\.jpg$/i);
      assert.ok(r.buf.length <= CONTENT_MAX_BYTES);
      assert.ok(r.buf.length > 1000);
      // JPEG SOI
      assert.equal(r.buf[0], 0xff);
      assert.equal(r.buf[1], 0xd8);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "loadWechatImageBuffer 超大 data URL 自动压缩而非抛错",
  { skip: process.platform !== "darwin" },
  () => {
    const { dir, buf } = makeOversizedJpeg();
    try {
      assert.ok(buf.length > CONTENT_MAX_BYTES);
      const src =
        "data:image/jpeg;base64," + buf.toString("base64");
      const r = Wechat.loadWechatImageBuffer(
        { store: {}, vault: null, data: "/tmp", wechatTokenCache: {} },
        src,
      );
      assert.ok(r);
      assert.match(r.name, /\.jpg$/i);
      assert.ok(r.buf.length <= CONTENT_MAX_BYTES);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "readImageForUpload 超大本地文件压到上限内并改名 jpg",
  { skip: process.platform !== "darwin" },
  () => {
    const wechatMp = require("../wechat-mp.cjs");
    const { dir, out, buf } = makeOversizedJpeg();
    try {
      assert.ok(buf.length > CONTENT_MAX_BYTES);
      const r = wechatMp.readImageForUpload(out, CONTENT_MAX_BYTES);
      assert.match(r.name, /\.jpg$/i);
      assert.ok(r.buf.length <= CONTENT_MAX_BYTES);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
