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
 * 汇总草稿与已归档文章中嵌入的图片（按账号过滤，路径去重，附来源标题）。
 * @param {{ documents?: Array<{ account?: string, body?: string, title?: string }>, archives?: Array<{ account?: string, body?: string, title?: string }> }} st
 * @param {string} account
 * @returns {Array<{ path: string, ref: string, src: string, name: string, articles: string[] }>}
 */
export function galleryImages(st, account) {
  const map = new Map();
  const collect = (body, title) => {
    for (const enc of bodyImageRefs(body)) {
      const rel = decodeURIComponent(enc);
      let item = map.get(rel);
      if (!item) {
        item = {
          path: rel,
          ref: enc,
          src: "inkasset://vault/" + enc,
          name: rel.split("/").pop() || rel,
          articles: [],
        };
        map.set(rel, item);
      }
      if (title && !item.articles.includes(title)) item.articles.push(title);
    }
  };
  for (const d of st.documents || [])
    if (sameAccount(d.account, account)) collect(d.body, d.title);
  for (const a of st.archives || [])
    if (sameAccount(a.account, account)) collect(a.body, a.title);
  return [...map.values()];
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
