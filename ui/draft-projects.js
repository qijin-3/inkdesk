import { esc } from "./dom.js";

/**
 * 从草稿相对路径取出项目名：02_Drafts 下一级子文件夹。
 * 根目录草稿（无子文件夹）返回 null。
 * @param {string|{ path?: string }|null|undefined} docOrPath
 * @returns {string|null}
 */
export function draftProjectOf(docOrPath) {
  const raw =
    typeof docOrPath === "string" ? docOrPath : docOrPath?.path;
  const parts = String(raw || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  const i = parts.indexOf("02_Drafts");
  if (i < 0) return null;
  // …/02_Drafts/file.md → 无项目；…/02_Drafts/项目/file.md → 项目
  if (parts.length <= i + 2) return null;
  const name = parts[i + 1];
  return name || null;
}

/**
 * 按本地草稿子文件夹分组。未分组在前，项目名中文排序。
 * @param {Array<{ path?: string, updated?: string }>} docs
 * @returns {{ ungrouped: typeof docs, projects: Array<{ name: string, docs: typeof docs }> }}
 */
export function groupDraftsByProject(docs) {
  const ungrouped = [];
  const map = new Map();
  for (const d of docs || []) {
    const name = draftProjectOf(d);
    if (!name) {
      ungrouped.push(d);
      continue;
    }
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(d);
  }
  const projects = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "zh"))
    .map(([name, list]) => ({ name, docs: list }));
  return { ungrouped, projects };
}

/**
 * 单篇草稿侧栏按钮。
 * @param {{ id: string, title?: string, updated?: string, body?: string }} d
 * @param {string|null|undefined} selectedId
 */
export function draftDocButtonHtml(d, selectedId) {
  const updated = d.updated
    ? new Date(d.updated).toLocaleDateString("zh-CN")
    : "";
  const words = (d.body || "").length;
  const meta = updated ? `${updated} · ${words} 字` : `${words} 字`;
  return `<button type="button" class="doc ${selectedId === d.id ? "selected" : ""}" data-id="${esc(d.id)}"><span>${esc(d.title || "未命名文章")}</span><small>${esc(meta)}</small></button>`;
}

/**
 * 「我的草稿」列表 HTML：根目录草稿 + 项目文件夹分组。
 * @param {Array<{ id: string, path?: string, title?: string, updated?: string, body?: string }>} docs
 * @param {string|null|undefined} selectedId
 * @param {string} folderIcon 文件夹图标 SVG HTML
 */
export function draftsSidebarHtml(docs, selectedId, folderIcon) {
  const { ungrouped, projects } = groupDraftsByProject(docs);
  if (!ungrouped.length && !projects.length)
    return '<p class="muted">从一个想法开始。</p>';
  const parts = [];
  for (const d of ungrouped) parts.push(draftDocButtonHtml(d, selectedId));
  for (const p of projects) {
    parts.push(
      `<div class="docs-project"><div class="docs-project-head" aria-hidden="false">${folderIcon}<span>${esc(p.name)}</span></div>${p.docs.map((d) => draftDocButtonHtml(d, selectedId)).join("")}</div>`,
    );
  }
  return parts.join("");
}
