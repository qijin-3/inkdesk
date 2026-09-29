const fs = require("node:fs");
const path = require("node:path");
const wechatMp = require("../wechat-mp.cjs");

/**
 * 对外暴露的各账号公众号配置快照。
 * @returns {Record<string, { appId: string, appSecret: string, author: string, coverPath: string }>}
 */
function publicWechatAccounts(core) {
  const out = {};
  const map = core.store.wechatAccounts || {};
  for (const [id, w] of Object.entries(map)) {
    if (!w || typeof w !== "object") continue;
    out[id] = {
      appId: w.appId || "",
      appSecret: w.appSecret || "",
      author: w.author || "",
      coverPath: w.coverPath || "",
    };
  }
  return out;
}

/** 校验公众号凭证能否换取 access_token */
async function testWechatToken(core, payload = {}) {
  const cfg = wechatConfig(core, payload?.account);
  delete core.wechatTokenCache[cfg.appId];
  const token = await wechatMp.getAccessToken(
    cfg.appId,
    cfg.appSecret,
    wechatTokenBucket(core, cfg.appId),
  );
  return { ok: true, preview: token.slice(0, 8) + "…" };
}

/**
 * 将排版 HTML 推送到公众号草稿箱：上传正文图与封面，再 draft/add。
 * @param {{ account?: string, title: string, author?: string, digest?: string, html: string, coverPath?: string }} payload
 */
async function pushWechatDraft(core, payload) {
  const cfg = wechatConfig(core, payload?.account);
  const token = await wechatMp.getAccessToken(
    cfg.appId,
    cfg.appSecret,
    wechatTokenBucket(core, cfg.appId),
  );
  let html = String(payload.html || "");
  if (!html.trim()) throw Error("正文为空");

  const srcs = [
    ...new Set(
      [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(
        (m) => m[1],
      ),
    ),
  ];
  const uploadedFiles = [];
  let blockImageCount = 0;
  for (const src of srcs) {
    const loaded = loadWechatImageBuffer(core, src);
    if (!loaded) {
      // 去掉无法解析的 src，避免残留超长 data URL
      html = html.split(src).join("");
      continue;
    }
    const url = await wechatMp.uploadContentImage(
      token,
      loaded.buf,
      loaded.name,
    );
    html = html.split(src).join(url);
    if (loaded.filePath) uploadedFiles.push(loaded.filePath);
    else blockImageCount++;
  }
  // 去掉上传失败留下的空 img
  html = html.replace(/<img\b[^>]*\bsrc=["']\s*["'][^>]*>/gi, "");

  if (html.length > 20000) throw Error("正文超过 2 万字符，请精简后再推送");

  let coverPath =
    payload.coverPath || cfg.coverPath || uploadedFiles[0] || "";
  if (!coverPath || !fs.existsSync(coverPath))
    throw Error(
      "缺少封面图：请在账号设置中指定默认封面，或在正文加入至少一张本地图片",
    );
  const thumb = await wechatMp.uploadPermanentImage(
    token,
    wechatMp.readImageFile(coverPath, 10 * 1024 * 1024),
    path.basename(coverPath),
  );

  const title = String(payload.title || "未命名文章").slice(0, 32);
  const author = String(payload.author || cfg.author || "").slice(0, 16);
  const digest = String(
    payload.digest ||
      html
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 54),
  ).slice(0, 120);

  const mediaId = await wechatMp.addDraft(token, {
    title,
    author,
    digest,
    content: html,
    thumb_media_id: thumb,
  });
  return {
    media_id: mediaId,
    title,
    imageCount: uploadedFiles.length + blockImageCount,
  };
}

/**
 * 把 img src 读成上传缓冲：支持 data URL 与本地路径。
 * @param {string} src
 * @returns {{ buf: Buffer, name: string, filePath?: string }|null}
 */
function loadWechatImageBuffer(core, src) {
  if (!src) return null;
  if (src.startsWith("data:image/")) {
    const comma = src.indexOf(",");
    if (comma < 0) return null;
    const meta = src.slice(0, comma);
    const buf = Buffer.from(src.slice(comma + 1), "base64");
    if (!buf.length) return null;
    if (buf.length > 1024 * 1024)
      throw Error("标题/引用图片超过 1MB，请精简文字后重试");
    const ext = /image\/(png|jpe?g|gif|webp)/i.exec(meta)?.[1] || "png";
    return { buf, name: `block.${ext === "jpeg" ? "jpg" : ext}` };
  }
  const filePath = resolveWechatImageSrc(core, src);
  if (!filePath) return null;
  return {
    buf: wechatMp.readImageFile(filePath),
    name: path.basename(filePath),
    filePath,
  };
}

/**
 * 按 appId 取 token 缓存桶。
 * @param {string} appId
 */
function wechatTokenBucket(core, appId) {
  const key = String(appId || "");
  if (!core.wechatTokenCache[key]) core.wechatTokenCache[key] = {};
  return core.wechatTokenCache[key];
}

/**
 * 读取并校验指定账号的公众号配置；账号未单独保存过时回退旧版全局 wechat。
 * @param {string} [accountId]
 */
function wechatConfig(core, accountId) {
  let id = String(accountId || "").trim();
  if (id && core.vault) {
    try {
      id = core.vault.resolveAccountId(id);
    } catch {
      /* 保留原 id，便于未绑定 vault 时的测试 */
    }
  }
  const map = core.store.wechatAccounts || {};
  const hasEntry = id && Object.prototype.hasOwnProperty.call(map, id);
  const w = hasEntry ? map[id] || {} : core.store.wechat || {};
  const appId = String(w.appId || "").trim();
  const appSecret = String(w.appSecret || "").trim();
  if (!appId || !appSecret)
    throw Error("请先在该账号设置中填写公众号 AppID 与 AppSecret");
  return {
    appId,
    appSecret,
    author: String(w.author || "").trim(),
    coverPath: String(w.coverPath || "").trim(),
  };
}

/**
 * 把正文里的图片 src 解析为本地绝对路径。
 * @param {string} src
 * @returns {string|null}
 */
function resolveWechatImageSrc(core, src) {
  if (!src) return null;
  try {
    if (src.startsWith("inkasset://vault/"))
      return core.vaultAsset(
        decodeURIComponent(src.slice("inkasset://vault/".length)),
      );
    if (src.startsWith("inkasset://local/"))
      return core.allowedAsset(
        path.join(
          core.data,
          "assets",
          decodeURIComponent(src.slice("inkasset://local/".length)),
        ),
      );
    if (src.startsWith("/api/asset/vault/"))
      return core.vaultAsset(
        decodeURIComponent(src.slice("/api/asset/vault/".length)),
      );
    if (src.startsWith("/api/asset/local/"))
      return core.allowedAsset(
        path.join(
          core.data,
          "assets",
          decodeURIComponent(src.slice("/api/asset/local/".length)),
        ),
      );
    if (path.isAbsolute(src) && fs.existsSync(src)) return src;
  } catch {
    return null;
  }
  return null;
}

module.exports = {
  publicWechatAccounts,
  testWechatToken,
  pushWechatDraft,
  loadWechatImageBuffer,
  wechatTokenBucket,
  wechatConfig,
  resolveWechatImageSrc,
};
