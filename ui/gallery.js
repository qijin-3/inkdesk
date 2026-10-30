import { esc, assetUrl } from "./dom.js";
import { sameAccount } from "./accounts.js";
import { I } from "../icons.js";

/**
 * 取出正文里嵌入的图片相对路径（保持出现顺序）。
 * 兼容 Electron 的 inkasset://vault/ 与网页版的 /api/asset/vault/ 两种地址。
 * @param {string} [body]
 * @returns {string[]}
 */
function bodyImageRefs(body) {
  const out = [];
  const re =
    /!\[[^\]]*\]\((?:inkasset:\/\/vault\/|\/api\/asset\/vault\/)([^)]+)\)/g;
  let m;
  while ((m = re.exec(String(body || "")))) out.push(m[1]);
  return out;
}

/**
 * 从图片文件名 file-<YYYYMMDDHHmmssSSS> 解析上传时间（毫秒），取不到返回 0。
 * @param {string} rel
 * @returns {number}
 */
function fileTime(rel) {
  const m = /file-(\d{17})/.exec(rel);
  if (!m) return 0;
  const s = m[1];
  const t = new Date(
    +s.slice(0, 4),
    +s.slice(4, 6) - 1,
    +s.slice(6, 8),
    +s.slice(8, 10),
    +s.slice(10, 12),
    +s.slice(12, 14),
    +s.slice(14, 17),
  ).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * 文章时间（毫秒）：草稿取更新时间，归档取发布时间；取不到返回 0。
 * @param {{ updated?: string, fields?: Record<string, unknown> }} a
 * @returns {number}
 */
function articleTime(a) {
  return Date.parse(a.updated || a.fields?.["发布时间"] || "") || 0;
}

/**
 * 汇总草稿与已归档文章中嵌入的图片（按账号过滤，路径去重，附来源标题），按图片时间新→旧排序。
 * @param {{ documents?: Array<{ account?: string, body?: string, title?: string, updated?: string }>, archives?: Array<{ account?: string, body?: string, title?: string, fields?: Record<string, unknown> }> }} st
 * @param {string} account
 * @returns {Array<{ path: string, ref: string, src: string, name: string, time: number, articles: string[] }>}
 */
export function galleryImages(st, account) {
  const map = new Map();
  const collect = (body, title, at) => {
    for (const enc of bodyImageRefs(body)) {
      const rel = decodeURIComponent(enc);
      let item = map.get(rel);
      if (!item) {
        item = {
          path: rel,
          ref: enc,
          src: "inkasset://vault/" + enc,
          name: rel.split("/").pop() || rel,
          time: fileTime(rel),
          articles: [],
        };
        map.set(rel, item);
      }
      if (!item.time && at) item.time = at;
      if (title && !item.articles.includes(title)) item.articles.push(title);
    }
  };
  for (const d of st.documents || [])
    if (sameAccount(d.account, account))
      collect(d.body, d.title, articleTime(d));
  for (const a of st.archives || [])
    if (sameAccount(a.account, account))
      collect(a.body, a.title, articleTime(a));
  return [...map.values()].sort(
    (a, b) => b.time - a.time || a.path.localeCompare(b.path),
  );
}

/**
 * 画廊单张图片卡片 HTML。
 * @param {{ src: string, name: string, articles: string[] }} item
 * @param {number} index
 */
export function galleryCardHTML(item, index) {
  const src = assetUrl(item.src);
  const from = item.articles[0] || "";
  const more =
    item.articles.length > 1 ? ` 等 ${item.articles.length} 篇` : "";
  return `<article class="gallery-card"><img class="gallery-img" src="${esc(src)}" alt="${esc(item.name)}" title="${esc(item.name)}" loading="lazy"><div class="gallery-overlay"><button type="button" class="gallery-copy" data-gallery-copy="${index}" title="复制图片" aria-label="复制图片">${I.copy({ size: 16 })}</button><span class="gallery-from">来自《${esc(from)}》${esc(more)}</span></div></article>`;
}

/**
 * 画廊网格 HTML（空态兜底）。
 * @param {Array<Parameters<typeof galleryCardHTML>[0]>} items
 */
export function galleryGridHTML(items) {
  if (!items.length)
    return '<div class="empty-state"><img src="assets/empty-materials.png" alt="" class="empty-state-img" /><p class="empty-state-text">还没有嵌入图片</p></div>';
  return items.map((it, i) => galleryCardHTML(it, i)).join("");
}
