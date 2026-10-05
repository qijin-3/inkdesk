/**
 * 公众号推送前将图片压到接口上限以内。
 * 优先 Electron nativeImage；macOS 回退 sips。不引入新依赖。
 *
 * 策略：未超限且已是公众号可接受格式则原样返回；否则转 JPEG。
 * 先降质、后缩边，尽量保住清晰度。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** 正文 uploadimg 上限 */
const CONTENT_MAX_BYTES = 1024 * 1024;
/** 永久素材封面上限（本应用使用值） */
const COVER_MAX_BYTES = 10 * 1024 * 1024;

/** 微信 uploadimg / 图片素材接受的扩展名 */
const WECHAT_IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
]);

/**
 * 若已在上限内且格式可用则原样返回；否则压成 JPEG，并改扩展名为 .jpg。
 * @param {Buffer} buf
 * @param {number} maxBytes
 * @param {string} [name]
 * @returns {{ buf: Buffer, name: string }}
 */
function ensureImageMaxBytes(buf, maxBytes, name = "image.jpg") {
  if (!Buffer.isBuffer(buf) || !buf.length) throw Error("图片为空");
  const baseName = path.basename(name || "image.jpg") || "image.jpg";
  const ext = path.extname(baseName).toLowerCase();
  const formatOk = WECHAT_IMAGE_EXTS.has(ext);
  if (buf.length <= maxBytes && formatOk) return { buf, name: baseName };

  let compressed = null;
  if (process.versions.electron) {
    try {
      compressed = compressWithElectron(buf, maxBytes);
    } catch {
      /* 回退 sips / 报错 */
    }
  }
  if (!compressed && process.platform === "darwin") {
    compressed = compressWithSips(buf, maxBytes);
  }
  if (!compressed || compressed.length > maxBytes) {
    throw Error(
      `图片超过 ${formatMb(maxBytes)}，自动压缩后仍过大：${baseName}`,
    );
  }
  const stem =
    path.basename(baseName, path.extname(baseName)).trim() || "image";
  return { buf: compressed, name: `${stem}.jpg` };
}

/**
 * @param {number} maxBytes
 */
function formatMb(maxBytes) {
  const mb = maxBytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

/**
 * Electron 主进程：优先降质，再缩边，直到 ≤ maxBytes。
 * @param {Buffer} buf
 * @param {number} maxBytes
 * @returns {Buffer|null}
 */
function compressWithElectron(buf, maxBytes) {
  const { nativeImage } = require("electron");
  let img = nativeImage.createFromBuffer(buf);
  if (!img || img.isEmpty()) return null;
  let size = img.getSize();
  let width = size.width || 0;
  let height = size.height || 0;
  if (!width || !height) return null;

  // 超大边先温和裁到 2560，多数照片即可在高质量下过关
  const maxEdge0 = Math.max(width, height);
  if (maxEdge0 > 2560) {
    const scale = 2560 / maxEdge0;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    img = img.resize({ width, height, quality: "better" });
    if (img.isEmpty()) return null;
  }

  let quality = 92;
  let best = null;
  for (let i = 0; i < 18; i++) {
    const out = Buffer.from(img.toJPEG(quality));
    if (out.length) {
      if (!best || out.length < best.length) best = out;
      if (out.length <= maxBytes) return out;
    }
    if (quality > 72) {
      quality -= 4;
      continue;
    }
    width = Math.max(480, Math.floor(width * 0.88));
    height = Math.max(360, Math.floor(height * 0.88));
    img = img.resize({ width, height, quality: "better" });
    if (img.isEmpty()) return null;
    quality = 86;
  }
  return best && best.length <= maxBytes ? best : null;
}

/**
 * macOS sips：转 JPEG；优先降质，再缩长边。
 * @param {Buffer} buf
 * @param {number} maxBytes
 * @returns {Buffer|null}
 */
function compressWithSips(buf, maxBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-wximg-"));
  try {
    const input = path.join(dir, "in.bin");
    fs.writeFileSync(input, buf);
    const dims = sipsPixelSize(input);
    let maxEdge = Math.max(dims.width || 0, dims.height || 0) || 2400;
    if (maxEdge > 2560) maxEdge = 2560;
    let quality = 92;
    let best = null;

    for (let i = 0; i < 16; i++) {
      const out = path.join(dir, `out-${i}.jpg`);
      const args = [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        String(quality),
        "--resampleHeightWidthMax",
        String(Math.max(480, Math.round(maxEdge))),
        input,
        "--out",
        out,
      ];
      const r = spawnSync("sips", args, { encoding: "utf8" });
      if (r.status !== 0 || !fs.existsSync(out)) {
        if (quality > 72) {
          quality -= 4;
          continue;
        }
        maxEdge = Math.floor(maxEdge * 0.88);
        if (maxEdge < 480) return best && best.length <= maxBytes ? best : null;
        continue;
      }
      const result = fs.readFileSync(out);
      if (result.length) {
        if (!best || result.length < best.length) best = result;
        if (result.length <= maxBytes) return result;
      }
      if (quality > 72) quality -= 4;
      else {
        maxEdge = Math.floor(maxEdge * 0.88);
        quality = 86;
        if (maxEdge < 480) break;
      }
    }
    return best && best.length <= maxBytes ? best : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} filePath
 * @returns {{ width: number, height: number }}
 */
function sipsPixelSize(filePath) {
  const r = spawnSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", filePath],
    { encoding: "utf8" },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const width = Number(/pixelWidth:\s*(\d+)/.exec(text)?.[1] || 0);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(text)?.[1] || 0);
  return { width, height };
}

module.exports = {
  CONTENT_MAX_BYTES,
  COVER_MAX_BYTES,
  WECHAT_IMAGE_EXTS,
  ensureImageMaxBytes,
  compressWithElectron,
  compressWithSips,
};
