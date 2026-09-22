/**
 * 微信公众号开放接口封装：access_token、正文图上传、封面永久素材、草稿箱。
 * 仅应在主进程 / 服务端调用。
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {{ token?: string, expiresAt?: number }} TokenCache
 */

/**
 * 请求微信 JSON API，失败时带上 errcode。
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function wechatJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json();
  if (data.errcode && data.errcode !== 0)
    throw Error(
      `微信接口错误 ${data.errcode}：${data.errmsg || "未知错误"}`,
    );
  return data;
}

/**
 * 获取并缓存 access_token。
 * @param {string} appId
 * @param {string} appSecret
 * @param {TokenCache} cache
 */
async function getAccessToken(appId, appSecret, cache) {
  if (cache.token && (cache.expiresAt || 0) > Date.now() + 60_000)
    return cache.token;
  const q = new URLSearchParams({
    grant_type: "client_credential",
    appid: appId,
    secret: appSecret,
  });
  const data = await wechatJson(
    `https://api.weixin.qq.com/cgi-bin/token?${q}`,
  );
  if (!data.access_token) throw Error("未返回 access_token，请检查 AppID/AppSecret");
  cache.token = data.access_token;
  cache.expiresAt = Date.now() + ((data.expires_in || 7200) - 120) * 1000;
  return cache.token;
}

/**
 * 上传图文正文图片（不占素材库额度），返回 mmbiz CDN URL。
 * @param {string} token
 * @param {Buffer} buffer
 * @param {string} filename
 */
async function uploadContentImage(token, buffer, filename) {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(buffer)], { type: mimeOf(filename) }),
    path.basename(filename) || "image.png",
  );
  return wechatJson(
    `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`,
    { method: "POST", body: form },
  ).then((d) => {
    if (!d.url) throw Error("正文图片上传未返回 url");
    return d.url;
  });
}

/**
 * 上传永久图片素材（用作封面 thumb_media_id）。
 * @param {string} token
 * @param {Buffer} buffer
 * @param {string} filename
 */
async function uploadPermanentImage(token, buffer, filename) {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(buffer)], { type: mimeOf(filename) }),
    path.basename(filename) || "cover.jpg",
  );
  const data = await wechatJson(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`,
    { method: "POST", body: form },
  );
  if (!data.media_id) throw Error("封面上传未返回 media_id");
  return data.media_id;
}

/**
 * 新增图文草稿。
 * @param {string} token
 * @param {{ title: string, author?: string, digest?: string, content: string, thumb_media_id: string }} article
 */
async function addDraft(token, article) {
  const data = await wechatJson(
    `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        articles: [
          {
            article_type: "news",
            title: String(article.title || "").slice(0, 32),
            author: String(article.author || "").slice(0, 16),
            digest: String(article.digest || "").slice(0, 120),
            content: article.content,
            thumb_media_id: article.thumb_media_id,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
        ],
      }),
    },
  );
  if (!data.media_id) throw Error("创建草稿未返回 media_id");
  return data.media_id;
}

/**
 * 按扩展名猜测 MIME。
 * @param {string} filename
 */
function mimeOf(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/**
 * 从磁盘读取图片，默认限制约 1MB（uploadimg 上限）；封面可用更大上限。
 * @param {string} filePath
 * @param {number} [maxBytes]
 */
function readImageFile(filePath, maxBytes = 1024 * 1024) {
  const buf = fs.readFileSync(filePath);
  if (buf.length > maxBytes)
    throw Error(
      `图片超过 ${Math.round(maxBytes / 1024 / 1024)}MB，请压缩后重试：${path.basename(filePath)}`,
    );
  return buf;
}

module.exports = {
  getAccessToken,
  uploadContentImage,
  uploadPermanentImage,
  addDraft,
  readImageFile,
  mimeOf,
};
