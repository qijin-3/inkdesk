import { esc, assetUrl } from "./dom.js";
import { safeHTML, sanitizeHtmlPreview } from "./html.js";
import { inferMaterialKind, formatJsonPreview } from "./materials-meta.js";
import { I } from "../icons.js";

/**
 * 生成素材预览卡片 HTML（展示内容缩略而非纯文件名）。
 * @param {object} r
 * @param {{ showRefCount?: boolean }} [opts]
 */
export function materialPreviewCardHTML(r, opts = {}) {
  const kind = r.kind || inferMaterialKind(r.name) || "binary";
  let body = "";
  if (kind === "image") {
    const src = assetUrl(
      r.asset ||
        (r.path ? "inkasset://vault/" + encodeURIComponent(r.path) : ""),
    );
    body = src
      ? `<div class="mat-preview-media"><img src="${esc(src)}" alt="" loading="lazy"></div>`
      : `<div class="mat-preview-placeholder">图片</div>`;
  } else if (kind === "markdown") {
    body = `<div class="mat-preview-body is-md">${safeHTML(r.preview || "")}</div>`;
  } else if (kind === "html") {
    body = `<div class="mat-preview-body is-html">${sanitizeHtmlPreview(r.preview || "")}</div>`;
  } else if (kind === "json") {
    body = `<pre class="mat-preview-body is-code">${esc(formatJsonPreview(r.preview || ""))}</pre>`;
  } else if (kind === "text") {
    body = `<pre class="mat-preview-body is-code">${esc(r.preview || "")}</pre>`;
  } else {
    body = `<div class="mat-preview-placeholder">${esc((r.name.split(".").pop() || "FILE").toUpperCase())}</div>`;
  }
  const refCount = Number(r.refCount) || 0;
  const refBadge = opts.showRefCount
    ? `<span class="mat-preview-refs" title="被 ${refCount} 篇文章引用">${I.link({ size: 12 })}<em>${refCount}</em></span>`
    : "";
  return `<article class="material-card material-preview-card" data-material="${r.id}" title="${esc(r.name)}"><button type="button" class="card-open" data-ref-preview="${r.id}" aria-label="${esc(r.name)}"><div class="mat-preview-frame">${body}</div><span class="mat-preview-name">${esc(r.name)}</span>${refBadge}</button></article>`;
}

/**
 * 渲染素材抽屉正文（按类型预览原格式）。
 * @param {object} r
 */
export function materialDrawerBodyHTML(r) {
  const kind = r.kind || inferMaterialKind(r.name) || "binary";
  const text = r.text || r.error || "";
  if (kind === "image") {
    const src = assetUrl(
      r.asset ||
        (r.path ? "inkasset://vault/" + encodeURIComponent(r.path) : ""),
    );
    return src
      ? `<img class="preview-image" src="${esc(src)}" alt="${esc(r.name)}">`
      : `<p class="muted">无法预览图片</p>`;
  }
  if (kind === "markdown")
    return `<div id="reference-text" class="material-preview is-md">${safeHTML(text)}</div>`;
  if (kind === "html")
    return `<div id="reference-text" class="material-preview is-html">${sanitizeHtmlPreview(text)}</div>`;
  if (kind === "json")
    return `<pre id="reference-text" class="material-preview is-code">${esc(formatJsonPreview(text))}</pre>`;
  if (kind === "text")
    return `<pre id="reference-text" class="material-preview is-code">${esc(text)}</pre>`;
  return `<p class="muted">已保留原文件，当前格式暂不支持内嵌预览。</p><pre id="reference-text" class="material-preview is-code">${esc(text)}</pre>`;
}
