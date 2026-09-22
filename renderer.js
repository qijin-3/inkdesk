import { bindSocialPreview } from "./social-layout.js";
import { Composer } from "./composer.js";
import { I } from "./icons.js";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { gfm } from "turndown-plugin-gfm";
import { marked } from "marked";
import TurndownService from "turndown";
import { diffWords } from "diff";
import { calendar, validDate, publishSummary } from "./calendar.cjs";
let saveProfileEditor = null;
let composer = null,
  profileTab = "identity";
let heatmapYear = new Date().getFullYear();
let metricsSort = "阅读";
let materialsFilter = "all";
const $ = (s) => document.querySelector(s),
  api = (n, d) => window.desk.call(n, d);

/** 是否在浏览器开发预览模式 */
function isWeb() {
  return !!window.desk?.web;
}

/**
 * 资源地址：网页端走 /api/asset，桌面端保留 inkasset 协议（由主进程托管）。
 * @param {string} src
 */
function assetUrl(src) {
  if (typeof src !== "string") return src;
  if (!isWeb()) return src;
  if (src.startsWith("inkasset://vault/"))
    return "/api/asset/vault/" + src.slice("inkasset://vault/".length);
  if (src.startsWith("inkasset://local/"))
    return "/api/asset/local/" + src.slice("inkasset://local/".length);
  return src;
}

/** 打开系统文件选择器 */
function pickFiles({ multiple = false, accept = "" } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.click();
  });
}

/** 上传项目参考文件（网页用文件选择，桌面走原生对话框） */
async function uploadProjectFiles(docId) {
  if (!isWeb()) return api("project-upload", docId);
  const files = await pickFiles({ multiple: true });
  if (!files.length) return null;
  const payload = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      bytes: [...new Uint8Array(await f.arrayBuffer())],
    })),
  );
  return api("project-upload", { id: docId, files: payload });
}

/** 选择一张图片并返回 bytes 与 MIME */
async function pickImagePayload() {
  const files = await pickFiles({ accept: "image/*" });
  const f = files[0];
  if (!f) return null;
  return {
    bytes: [...new Uint8Array(await f.arrayBuffer())],
    type: f.type,
  };
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state,
  editor,
  page = "dashboard",
  tab = "chat",
  account = "AI",
  current,
  saveTimer,
  busy = false,
  pending = null,
  sourceFiles = [],
  selectedText = "",
  selectionContext = null,
  dirty = false;
let editorHTML = "";
let previewMode = false;
let previewDocId = null;
let socialPreviewCtl = null;
/** 写作伙伴侧栏是否展开；仅草稿写作可用，默认收起 */
let assistantOpen = false;
function conversation(doc = current) {
  doc.conversations ||= [];
  if (!doc.conversations.length)
    doc.conversations.push({
      id: crypto.randomUUID(),
      title: "开始聊这篇",
      messages: doc.chat || [],
    });
  let c =
    doc.conversations.find((c) => c.id === doc.activeConversationId) ||
    doc.conversations[0];
  doc.activeConversationId = c.id;
  return c;
}
const td = new TurndownService({ headingStyle: "atx" });
td.use(gfm);
const escapeMarkdown = td.escape.bind(td);
td.escape = (text) =>
  text
    .split(/(!?\[\[[^\]\n]+\]\]|\[![a-z]+\][+-]?)/gi)
    .map((part, i) => (i % 2 ? part : escapeMarkdown(part)))
    .join("");
td.addRule("images", {
  filter: "img",
  replacement: (_, node) =>
    "![" + (node.alt || "图片") + "](" + node.getAttribute("src") + ")",
});
function safeHTML(md) {
  const d = new DOMParser().parseFromString(
    marked.parse(md || ""),
    "text/html",
  );
  d.querySelectorAll(
    "script,iframe,object,embed,style,link,form,input,button",
  ).forEach((n) => n.remove());
  d.body.querySelectorAll("*").forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (
        a.name.startsWith("on") ||
        a.name === "style" ||
        (["href", "src"].includes(a.name) &&
          !/^(https?:|inkasset:|\/api\/asset\/|data:image\/|[^:]*$)/i.test(
            a.value,
          ))
      )
        n.removeAttribute(a.name);
    });
  });
  let html = d.body.innerHTML;
  // 网页端：inkasset → /api/asset；桌面端：/api/asset → inkasset（主进程 protocol 加载）
  if (isWeb())
    return html.replace(
      /inkasset:\/\/(vault|local)\/([^"'\s)]+)/g,
      (_, kind, rel) => "/api/asset/" + kind + "/" + rel,
    );
  return html.replace(
    /\/api\/asset\/(vault|local)\/([^"'\s)]+)/g,
    (_, kind, rel) => "inkasset://" + kind + "/" + rel,
  );
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 3800);
}
async function persist() {
  clearTimeout(saveTimer);
  try {
    const before = JSON.stringify(state);
    await api("save", state);
    if (before === JSON.stringify(state)) dirty = false;
    const n = $("#saved");
    if (n) n.textContent = "已保存到开发副本";
    return true;
  } catch (e) {
    toast("保存失败：" + e.message);
    return false;
  }
}
function changed() {
  const card = document.querySelector('[data-id="' + current.id + '"]');
  if (card) {
    card.querySelector("span").textContent = current.title;
    card.querySelector("small").textContent =
      new Date().toLocaleDateString("zh-CN") +
      " · " +
      current.body.length +
      " 字";
  }
  dirty = true;
  current.updated = new Date().toISOString();
  const n = $("#saved");
  if (n) n.textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}
function newDoc() {
  const d = {
    id: crypto.randomUUID(),
    title: "未命名文章",
    body: "",
    account,
    updated: new Date().toISOString(),
    chat: [],
    titles: [],
    prompts: [],
    topics: [],
    checks: [],
    snapshots: [],
  };
  state.documents.unshift(d);
  current = d;
  page = "write";
  pending = null;
  persist();
  render();
}
function sync() {
  if (editor && current && editor.getHTML() !== editorHTML) {
    current.body = td.turndown(editor.getHTML());
    editorHTML = editor.getHTML();
  }
}
function render() {
  saveProfileEditor = null;
  $("#reference-drawer")?.remove();
  $("#published-drawer")?.remove();
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (editor) {
    editor.destroy();
    editor = null;
  }
  if (socialPreviewCtl) {
    socialPreviewCtl.destroy();
    socialPreviewCtl = null;
  }
  if (page !== "write") {
    previewMode = false;
    previewDocId = null;
  }
  $("#app").innerHTML =
    `<aside class="sidebar"><div class="brand-row"><div class="brand"><span class="brand-icon">i</span> inkdesk <small>写作工作台</small></div><button type="button" data-page="settings" class="icon-btn brand-settings" title="设置" aria-label="设置">${I.settings({ size: 18 })}</button></div><div class="account"><button data-account="AI" class="${account === "AI" ? "active" : ""}">金奇 AI</button><button data-account="Dev" class="${account === "Dev" ? "active" : ""}">金奇 Dev</button></div><nav><button data-page="dashboard" class="${page === "dashboard" ? "chosen" : ""}">${I.dashboard()} <span>仪表盘</span></button><button data-page="topics" class="${page === "topics" ? "chosen" : ""}">${I.sparkles()} <span>选题与灵感</span></button><button data-page="materials" class="${page === "materials" ? "chosen" : ""}">${I.library()} <span>素材库</span></button><button data-page="profile">${I.user()} <span>账号人设</span></button></nav><div class="list-head">我的草稿 <button id="new" title="新建文章" aria-label="新建文章">${I.plus()}</button></div><div class="docs">${
      state.documents
        .filter(
          (d) =>
            d.account === account &&
            d.status !== "final" &&
            d.status !== "archive",
        )
        .map(
          (d) =>
            `<button class="doc ${current?.id === d.id ? "selected" : ""}" data-id="${d.id}"><span>${esc(d.title)}</span><small>${new Date(d.updated).toLocaleDateString("zh-CN")} · ${d.body.length} 字</small></button>`,
        )
        .join("") || '<p class="muted">从一个想法开始。</p>'
    }</div></aside><main id="main"></main><div class="workspace-resizer hidden" id="workspace-resizer" title="拖动调整宽度"></div><aside class="assistant hidden" id="rail"></aside>`;
  if (page === "write") renderWrite();
  else if (page === "dashboard") renderDashboard();
  else if (page === "topics") renderTopics();
  else if (page === "materials") renderMaterials();
  else if (page === "profile") renderProfile();
  else renderSettings();
  if (page !== "write") renderAssistantRail();
  bindWorkspaceResize();
  $$("[data-page]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "profile" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        sync();
        persist();
        page = b.dataset.page;
        render();
      }),
  );
  $$("[data-account]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "profile" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        sync();
        persist();
        account = b.dataset.account;
        current = state.documents.find((d) => d.account === account);
        pending = null;
        render();
      }),
  );
  $$("[data-id]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "profile" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        sync();
        persist();
        current = state.documents.find((d) => d.id === b.dataset.id);
        page = "write";
        pending = null;
        render();
      }),
  );
  $("#new").onclick = newDoc;
  $$(".doc").forEach((b) => {
    b.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "删除草稿",
          danger: true,
          run: () => deleteDraft(b.dataset.id),
        },
      ]);
    };
  });
}

/**
 * 在屏幕坐标处显示简易右键菜单。
 * @param {number} x
 * @param {number} y
 * @param {{ label: string, danger?: boolean, run: () => void }[]} items
 */
function showContextMenu(x, y, items) {
  $("#context-menu")?.remove();
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  menu.style.left = Math.min(x, window.innerWidth - 180) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 80) + "px";
  menu.innerHTML = items
    .map(
      (it, i) =>
        `<button type="button" data-ctx="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`,
    )
    .join("");
  document.body.append(menu);
  const close = () => {
    menu.remove();
    window.removeEventListener("click", close);
    window.removeEventListener("contextmenu", close);
    window.removeEventListener("scroll", close, true);
  };
  [...menu.querySelectorAll("[data-ctx]")].forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const item = items[+b.dataset.ctx];
      close();
      item?.run();
    };
  });
  setTimeout(() => {
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
  }, 0);
}

/**
 * 删除指定草稿，并刷新界面。
 * @param {string} id
 */
async function deleteDraft(id) {
  if (busy) return toast("请等待 AI 完成后再删除");
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  if (!confirm(`确定删除草稿「${doc.title}」？此操作不可恢复。`)) return;
  sync();
  try {
    await persist();
    const result = await api("draft-delete", id);
    Object.assign(state, result);
    if (current?.id === id) {
      current =
        state.documents.find((d) => d.account === account) ||
        state.documents[0] ||
        null;
      page = current ? "write" : "dashboard";
    }
    dirty = false;
    pending = null;
    render();
    toast("草稿已删除");
  } catch (e) {
    toast(e.message);
  }
}
function $$(s) {
  return [...document.querySelectorAll(s)];
}

const WECHAT_BLUE = "#0f3ff7";
const WECHAT_BLUE_SOFT = "rgba(15, 63, 247, 0.2)";
/** 本地预览：寒蝉优先，回退到系统宋体（勿用无衬线，避免退化成黑体） */
const WECHAT_SERIF =
  "'寒蝉锦书宋Compact','Songti SC','STSong','华文宋体','宋体',SimSun,serif";
/**
 * 公众号粘贴专用：不含自定义字体。
 * 微信遇到未知字体名常会丢弃整段 font-family，从而退化成黑体。
 */
const WECHAT_SERIF_PUBLISH =
  "Songti SC,STSong,华文宋体,宋体,SimSun,serif";
const WECHAT_SANS =
  "'OPPO Sans 4.0','PingFang SC','Helvetica Neue',Arial,sans-serif";

/**
 * 将一级标题拆成中文主标题 + 英文副标题（若存在）。
 */
function splitWechatH1(h1) {
  if (h1.querySelector(".h1-en")) return;
  const text = h1.textContent.replace(/\s+/g, " ").trim();
  const m = text.match(
    /^([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef0-9A-Za-z\s\u2014\u2013\-·、，。！？：；“”‘’（）【】《》]+?)\s+([A-Za-z][A-Za-z0-9&/.,'’\- ]{1,60})$/,
  );
  if (!m) return;
  const doc = h1.ownerDocument;
  const zh = doc.createElement("span");
  zh.className = "h1-zh";
  zh.textContent = m[1].trim();
  const en = doc.createElement("span");
  en.className = "h1-en";
  en.lang = "en";
  en.textContent = m[2].trim();
  const wrap = doc.createElement("span");
  wrap.className = "h1-text";
  wrap.append(zh, en);
  h1.replaceChildren(wrap);
}

/**
 * 推送用标题/引用图。
 * 逻辑宽取手机微信正文区约 360px（非整页 677）：图会按栏宽 100% 显示，
 * 若按 677 画 15px 字，缩到 ~360 后只剩约 8px，会远小于正文。
 * 4x → 约 1440px，Retina 仍清晰。
 */
const WECHAT_BLOCK_W = 360;
const WECHAT_BLOCK_SCALE = 4;

/**
 * 按中文字符换行。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 */
function wechatWrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text || "").split(/\n/)) {
    let line = "";
    for (const ch of Array.from(para)) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/**
 * 创建高清画布（逻辑像素 × scale）。
 * @param {number} cssW
 * @param {number} cssH
 */
function wechatBlockCanvas(cssW, cssH) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(cssW * WECHAT_BLOCK_SCALE));
  c.height = Math.max(1, Math.ceil(cssH * WECHAT_BLOCK_SCALE));
  const ctx = c.getContext("2d");
  ctx.scale(WECHAT_BLOCK_SCALE, WECHAT_BLOCK_SCALE);
  ctx.textBaseline = "top";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

/**
 * 画一级标题图（蓝字 + 序号方块）。
 * @param {string} raw
 * @param {string} num
 */
function renderWechatH1Png(raw, num) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const m = text.match(
    /^([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef0-9A-Za-z\s\u2014\u2013\-·、，。！？：；“”‘’（）【】《》]+?)\s+([A-Za-z][A-Za-z0-9&/.,'’\- ]{1,60})$/,
  );
  const zh = m ? m[1].trim() : text;
  const en = m ? m[2].trim() : "";
  const badge = 48;
  const gap = 10;
  const textW = WECHAT_BLOCK_W - badge - gap;
  const fontSize = 40;
  const lineH = 44;
  const measure = wechatBlockCanvas(1, 1).ctx;
  measure.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  const zhLines = wechatWrapLines(measure, zh, textW);
  const enLines = en ? wechatWrapLines(measure, en, textW) : [];
  const textH = Math.max(
    badge,
    zhLines.length * lineH + enLines.length * lineH,
  );
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, textH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, textH);
  ctx.fillStyle = WECHAT_BLUE;
  ctx.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  // 与序号底对齐
  let y = textH - zhLines.length * lineH - enLines.length * lineH;
  for (const line of zhLines) {
    ctx.fillText(line, 0, y);
    y += lineH;
  }
  for (const line of enLines) {
    ctx.fillText(line, 0, y);
    y += lineH;
  }
  const bx = WECHAT_BLOCK_W - badge;
  const by = textH - badge;
  ctx.fillStyle = WECHAT_BLUE_SOFT;
  ctx.fillRect(bx, by, badge, badge);
  ctx.fillStyle = WECHAT_BLUE;
  const numSize = 36;
  ctx.font = `800 ${numSize}px ${WECHAT_SERIF}`;
  const nw = ctx.measureText(num).width;
  ctx.fillText(num, bx + (badge - nw) / 2, by + (badge - numSize) / 2);
  return c.toDataURL("image/png");
}

/**
 * 画二级标题：整行定宽画布，蓝条按文字真实宽度左对齐，避免短标题被拉大。
 * @param {string} raw
 */
function renderWechatH2Png(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const padX = 10;
  const padY = 8;
  const fontSize = 20;
  const lineH = 25;
  const maxInner = WECHAT_BLOCK_W - padX * 2;
  const measure = wechatBlockCanvas(1, 1).ctx;
  measure.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  const lines = wechatWrapLines(measure, text, maxInner);
  const innerW = Math.min(
    maxInner,
    Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width), 1)),
  );
  const boxW = Math.min(WECHAT_BLOCK_W, innerW + padX * 2);
  const boxH = lines.length * lineH + padY * 2;
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, boxH);
  // 白底占满行宽；蓝条仅覆盖文字所需宽度
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = WECHAT_BLUE;
  ctx.fillRect(0, 0, boxW, boxH);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  let y = padY;
  for (const line of lines) {
    ctx.fillText(line, padX, y);
    y += lineH;
  }
  return c.toDataURL("image/png");
}

/**
 * 画引用块图。
 * @param {string} raw
 */
function renderWechatQuotePng(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const pad = 8;
  const markSize = 23;
  const fontSize = 15;
  const lineH = 26;
  const markW = 20;
  const gap = 8;
  const textW = WECHAT_BLOCK_W - pad * 2 - markW - gap;
  const measure = wechatBlockCanvas(1, 1).ctx;
  measure.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  const lines = wechatWrapLines(measure, text, textW);
  const boxH = Math.max(markSize + pad * 2, lines.length * lineH + pad * 2);
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = WECHAT_BLUE_SOFT;
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = WECHAT_BLUE;
  ctx.font = `800 ${markSize}px ${WECHAT_SERIF}`;
  ctx.fillText("“", pad, pad);
  ctx.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  let y = pad + 4;
  const tx = pad + markW + gap;
  for (const line of lines) {
    ctx.fillText(line, tx, y);
    y += lineH;
  }
  return c.toDataURL("image/png");
}

/**
 * 用图片节点替换块级元素：按栏宽 100% 铺满，字号与正文同尺度。
 * @param {Document} d
 * @param {Element} el
 * @param {string} dataUrl
 * @param {string} alt
 * @param {string} margin
 */
function replaceWithWechatBlockImage(d, el, dataUrl, alt, margin) {
  const wrap = d.createElement("section");
  wrap.setAttribute(
    "style",
    `margin:${margin};padding:0;max-width:100%;box-sizing:border-box;`,
  );
  const img = d.createElement("img");
  img.setAttribute("src", dataUrl);
  img.setAttribute("alt", alt);
  img.setAttribute("width", String(WECHAT_BLOCK_W));
  img.setAttribute(
    "style",
    "width:100% !important;max-width:100% !important;height:auto !important;display:block !important;margin:0 !important;border:0;vertical-align:top;",
  );
  wrap.appendChild(img);
  el.replaceWith(wrap);
}

/**
 * 增强公众号预览 DOM：中英标题拆分，并写入关键元素内联样式（避免 CSS 缓存/继承干扰）。
 */
function enhanceWechatPreview(root = $("#article-preview")) {
  if (!root) return;
  root.querySelectorAll("h1").forEach(splitWechatH1);
  const h2Style = `display:inline-block;max-width:100%;box-sizing:border-box;margin:16px 0 14px;padding:8px 10px;background:${WECHAT_BLUE};color:#ffffff;font-family:${WECHAT_SERIF};font-size:20px;font-weight:800;line-height:1.25;`;
  root.querySelectorAll("h2").forEach((h2) => {
    h2.setAttribute("style", h2Style);
    // 子节点（如 strong）不得继承正文黑字/无衬线，否则看起来像「二级标题没变」
    h2.querySelectorAll("*").forEach((el) => {
      el.setAttribute(
        "style",
        `color:#ffffff;font-family:${WECHAT_SERIF};font-size:20px;font-weight:800;`,
      );
    });
  });
  root.querySelectorAll("blockquote").forEach((bq) => {
    bq.setAttribute(
      "style",
      `display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:start;border:0;margin:20px 0;padding:8px;background:${WECHAT_BLUE_SOFT};color:${WECHAT_BLUE};font-family:${WECHAT_SERIF};font-size:15px;font-weight:800;line-height:1.7;`,
    );
    if (!bq.querySelector(".wechat-quote-mark")) {
      const mark = document.createElement("span");
      mark.className = "wechat-quote-mark";
      mark.textContent = "“";
      mark.setAttribute(
        "style",
        `grid-column:1;grid-row:1;font-family:${WECHAT_SERIF};font-size:23px;font-weight:800;line-height:1;color:${WECHAT_BLUE};`,
      );
      bq.prepend(mark);
    }
    bq.querySelectorAll("p, strong").forEach((el) => {
      el.style.fontFamily =
        "寒蝉锦书宋Compact, Songti SC, STSong, 华文宋体, 宋体, SimSun, serif";
      el.style.fontWeight = "800";
      el.style.color = WECHAT_BLUE;
      if (el.tagName === "P") el.style.gridColumn = "2";
    });
  });
}

/**
 * 将 Markdown 转为公众号排版 HTML。
 * 二级标题不用 h2 着色（微信会重置标题色），改为 section + span。
 * 宋体栈不含寒蝉，避免微信丢弃整段 font-family 后退化成黑体。
 * @param {string} md
 * @param {{ keepImages?: boolean, blockImages?: boolean }} [opts]
 *   keepImages：保留正文图；blockImages：H1/H2/引用渲染为图片（草稿推送）
 */
async function publishHTML(md, opts = {}) {
  const serif = WECHAT_SERIF_PUBLISH;
  const d = new DOMParser().parseFromString(safeHTML(md), "text/html");
  if (opts.keepImages) {
    // 草稿推送：把网页路径还原为 inkasset，供主进程解析本地文件
    if (!isWeb())
      d.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src");
        if (src?.startsWith("/api/asset/"))
          img.src = src
            .replace("/api/asset/vault/", "inkasset://vault/")
            .replace("/api/asset/local/", "inkasset://local/");
      });
  } else {
    d.querySelectorAll("img").forEach((img) => {
      const p = d.createElement("p");
      p.textContent = "【请上传图片：" + (img.alt || "正文配图") + "】";
      img.replaceWith(p);
    });
  }

  if (opts.blockImages) {
    await document.fonts.ready;
    let h1i = 0;
    for (const h1 of [...d.querySelectorAll("h1")]) {
      const num = String(++h1i).padStart(2, "0");
      replaceWithWechatBlockImage(
        d,
        h1,
        renderWechatH1Png(h1.textContent, num),
        "一级标题",
        "56px 0 20px",
      );
    }
    for (const h2 of [...d.querySelectorAll("h2")]) {
      replaceWithWechatBlockImage(
        d,
        h2,
        renderWechatH2Png(h2.textContent),
        "二级标题",
        "16px 0 14px",
      );
    }
    for (const bq of [...d.querySelectorAll("blockquote")]) {
      replaceWithWechatBlockImage(
        d,
        bq,
        renderWechatQuotePng(bq.textContent),
        "引用",
        "20px 0",
      );
    }
  } else {
    d.querySelectorAll("h1").forEach((h1, i) => {
      splitWechatH1(h1);
      const num = String(i + 1).padStart(2, "0");
      const text = h1.innerHTML;
      h1.innerHTML = `<span style="flex:1;min-width:0;color:${WECHAT_BLUE};font-family:${serif};font-size:40px;font-weight:800;">${text}</span><span style="flex-shrink:0;display:inline-block;width:80px;height:80px;line-height:80px;text-align:center;background:${WECHAT_BLUE_SOFT};color:${WECHAT_BLUE};font-family:${serif};font-size:64px;font-weight:800;">${num}</span>`;
    });
    // 二级标题：微信会重置 h1–h6 的 color，必须把白字写在 span 上
    d.querySelectorAll("h2").forEach((h2) => {
      const wrap = d.createElement("section");
      wrap.setAttribute("data-wechat-h2", "1");
      wrap.setAttribute(
        "style",
        "margin:16px 0 14px;padding:0;max-width:100%;",
      );
      const bar = d.createElement("section");
      bar.setAttribute(
        "style",
        `display:inline-block;max-width:100%;box-sizing:border-box;padding:8px 10px;background-color:${WECHAT_BLUE};`,
      );
      const label = d.createElement("span");
      label.setAttribute(
        "style",
        `color:#ffffff;font-size:20px;font-weight:bold;font-family:${serif};line-height:1.25;`,
      );
      while (h2.firstChild) label.appendChild(h2.firstChild);
      label.querySelectorAll("*").forEach((el) => {
        el.setAttribute(
          "style",
          `color:#ffffff;font-size:20px;font-weight:bold;font-family:${serif};`,
        );
      });
      bar.appendChild(label);
      wrap.appendChild(bar);
      h2.replaceWith(wrap);
    });
    d.querySelectorAll("blockquote").forEach((bq) => {
      if (bq.querySelector(".wechat-quote-mark")) return;
      const mark = d.createElement("span");
      mark.className = "wechat-quote-mark";
      mark.textContent = "“";
      mark.setAttribute(
        "style",
        `flex-shrink:0;font-family:${serif};font-size:23px;font-weight:800;line-height:1;color:${WECHAT_BLUE};`,
      );
      bq.prepend(mark);
    });
  }

  const styles = {
    p: `margin:0 0 16px;line-height:1.75;font-size:15px;color:#111;font-family:${WECHAT_SANS};font-weight:400;`,
    h1: `display:flex;align-items:flex-end;justify-content:space-between;gap:12px;font-size:40px;line-height:1.1;margin:56px 0 20px;color:${WECHAT_BLUE};font-family:${serif};font-weight:800;`,
    h3: `font-size:18px;margin:20px 0 12px;color:${WECHAT_BLUE};font-family:${serif};font-weight:800;`,
    blockquote: `display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:start;border:0;margin:20px 0;padding:8px;background:${WECHAT_BLUE_SOFT};color:${WECHAT_BLUE};font-family:${serif};font-size:15px;font-weight:800;line-height:1.7;`,
    li: `line-height:1.75;margin:6px 0;font-size:15px;font-family:${WECHAT_SANS};`,
  };
  Object.entries(styles).forEach(([tag, style]) =>
    d.querySelectorAll(tag).forEach((n) => {
      // 图片块外包的 p 已带 margin，勿覆盖
      if (
        tag === "p" &&
        n.querySelector(
          'img[alt="一级标题"], img[alt="二级标题"], img[alt="引用"]',
        )
      )
        return;
      const prev = n.getAttribute("style") || "";
      n.setAttribute("style", prev ? `${prev};${style}` : style);
    }),
  );
  // 正文加粗：跳过标题 / 引用 / 二级标题条，避免盖成黑字
  d.querySelectorAll("strong").forEach((n) => {
    if (n.closest("h1, blockquote, [data-wechat-h2]")) return;
    n.setAttribute(
      "style",
      `font-weight:600;color:#111;font-family:${WECHAT_SANS};`,
    );
  });
  if (!opts.blockImages) {
    d.querySelectorAll("blockquote > *").forEach((el) => {
      if (el.classList?.contains("wechat-quote-mark")) {
        el.setAttribute(
          "style",
          `grid-column:1;grid-row:1;font-family:${serif};font-size:23px;font-weight:800;line-height:1;color:${WECHAT_BLUE};`,
        );
        return;
      }
      const prev = el.getAttribute("style") || "";
      el.setAttribute("style", `${prev};grid-column:2;`.replace(/^;/, ""));
    });
    d.querySelectorAll("blockquote p").forEach((p) =>
      p.setAttribute(
        "style",
        `margin:0;grid-column:2;color:${WECHAT_BLUE};font-family:${serif};font-size:15px;font-weight:800;line-height:1.7;`,
      ),
    );
    d.querySelectorAll("blockquote strong").forEach((el) =>
      el.setAttribute(
        "style",
        `font-family:${serif};font-weight:800;color:${WECHAT_BLUE};`,
      ),
    );
    d.querySelectorAll("h1 .h1-zh, h1 .h1-en, h1 span").forEach((el) => {
      const prev = el.getAttribute("style") || "";
      if (!/font-family/.test(prev))
        el.setAttribute(
          "style",
          `${prev};font-family:${serif};color:${WECHAT_BLUE};`.replace(/^;/, ""),
        );
    });
    d.querySelectorAll("h1 .h1-zh, h1 .h1-en").forEach((el) =>
      el.setAttribute(
        "style",
        `display:block;font-size:40px;font-weight:800;line-height:1.1;color:${WECHAT_BLUE};font-family:${serif};`,
      ),
    );
  }
  return `<section style="font-family:${WECHAT_SANS};padding:8px;color:#111;max-width:768px;">${d.body.innerHTML}</section>`;
}

/**
 * 生成小红书分页用的正文 HTML；桌面端把网页资源路径转回 inkasset。
 */
function socialSourceHTML() {
  const html = editor ? editor.getHTML() : safeHTML(current.body);
  const d = new DOMParser().parseFromString(html, "text/html");
  if (!isWeb())
    d.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src?.startsWith("/api/asset/"))
        img.src = src
          .replace("/api/asset/vault/", "inkasset://vault/")
          .replace("/api/asset/local/", "inkasset://local/");
    });
  return d.body.innerHTML;
}

/**
 * 进入或退出预览模式，并重建写作页。
 */
function togglePreview() {
  sync();
  previewMode = !previewMode;
  previewDocId = previewMode ? current.id : null;
  if (editor) {
    editor.destroy();
    editor = null;
  }
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (socialPreviewCtl) {
    socialPreviewCtl.destroy();
    socialPreviewCtl = null;
  }
  renderWrite();
}

/**
 * 绑定写作页与预览页共用的页眉操作（预览切换、版本）。
 */
function bindArticleHeader() {
  $("#layout").onclick = togglePreview;
  $("#save-version").onclick = () => {
    sync();
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML =
      '<div class="dialog"><h2>保存一个版本</h2><input id="version-name" placeholder="如：自己的初稿 / 精修版"><div class="row"><button id="version-cancel">取消</button><button id="version-confirm" class="primary">保存版本</button></div></div>';
    document.body.append(modal);
    $("#version-cancel").onclick = () => modal.remove();
    $("#version-confirm").onclick = async () => {
      current.snapshots.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        name: $("#version-name").value.trim() || "手动保存",
        body: current.body,
      });
      dirty = true;
      if (await persist()) {
        modal.remove();
        toast("版本已保存");
      }
    };
  };
  $("#history").onclick = async () => {
    sync();
    if (!(await persist())) return;
    try {
      current.snapshots = await api("versions", current.id);
    } catch (e) {
      return toast(e.message);
    }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<div class="dialog"><div class="row"><h2>版本与修改记录</h2><button id="close-history">关闭</button></div><p class="muted">记录只保存在本机，不自动发送给 AI。</p><div class="history-items">${
      (current.snapshots || [])
        .map(
          (x, i) =>
            `<div class="result-card"><small>${esc(x.name || "修改前快照")} · ${new Date(x.at).toLocaleString("zh-CN")}</small><div>${esc(x.body.slice(0, 260))}</div><button data-restore="${i}">恢复此版本</button></div>`,
        )
        .reverse()
        .join("") || "<p>接受修改或定稿时，会在这里保存快照。</p>"
    }${(current.decisions || [])
      .slice(-10)
      .reverse()
      .map(
        (x) =>
          `<div class="result-card"><small>${x.action === "accepted" ? "已接受" : "已拒绝"} · ${new Date(x.at).toLocaleString("zh-CN")}</small><div>${esc(x.before)} → ${esc(x.after)}</div></div>`,
      )
      .join("")}</div></div>`;
    document.body.append(modal);
    $("#close-history").onclick = () => modal.remove();
    $$("[data-restore]").forEach(
      (b) =>
        (b.onclick = () => {
          const body = current.snapshots[+b.dataset.restore].body;
          sync();
          current.snapshots.push({
            at: new Date().toISOString(),
            body: current.body,
          });
          if (editor) {
            editor.commands.setContent(safeHTML(body));
            sync();
          } else current.body = body;
          changed();
          pending = null;
          modal.remove();
          toast("版本已恢复，恢复前的正文也已保存");
          if (previewMode) renderWrite();
        }),
    );
  };
}

/**
 * 绑定全局右侧栏「定稿」按钮。
 */
function bindFinalize() {
  const btn = $("#finalize");
  if (!btn) return;
  btn.onclick = async () => {
    if (!current) return toast("请先打开一篇草稿");
    if (busy) return toast("请等待 AI 完成后再定稿");
    sync();
    if (!(await persist())) return;
    try {
      let result = await api("finalize", current.id);
      if (isWeb() && result?.needsConfirmation) {
        const ok = confirm(result.message + "\n\n" + result.detail);
        if (!ok) return;
        result = await api("finalize", {
          id: current.id,
          confirmed: true,
          contentSnapshot: result.contentSnapshot,
        });
      }
      if (!result || result.needsConfirmation) return;
      Object.assign(state, result);
      current = state.documents.find((d) => d.account === account);
      pending = null;
      page = "dashboard";
      render();
      toast("已定稿并移入本账号 Archive，版本与对话已保留");
    } catch (e) {
      toast(e.message);
    }
  };
}

/**
 * 同步右侧栏与分隔条显隐：仅草稿写作可用；写作伙伴默认收起，预览时展开小红书栏。
 */
function syncRailVisibility() {
  const rail = $("#rail");
  const resizer = $("#workspace-resizer");
  const draftWriting = page === "write" && !!current;
  if (!rail) return;
  if (!draftWriting) {
    rail.classList.add("hidden");
    resizer?.classList.add("hidden");
    return;
  }
  if (previewMode) {
    rail.classList.remove("hidden");
    resizer?.classList.remove("hidden");
    return;
  }
  rail.classList.toggle("hidden", !assistantOpen);
  resizer?.classList.toggle("hidden", !assistantOpen);
  const toggle = $("#toggle-assistant");
  if (toggle) {
    toggle.classList.toggle("primary", assistantOpen);
    toggle.setAttribute("aria-pressed", assistantOpen ? "true" : "false");
  }
}

/**
 * 展开写作伙伴（若当前在草稿写作中）。
 */
function openAssistant() {
  if (page !== "write" || !current || previewMode) return;
  if (assistantOpen && $("#panel")?.dataset.ready) {
    syncRailVisibility();
    return;
  }
  assistantOpen = true;
  renderAssistantRail();
}

/**
 * 渲染右侧栏：草稿预览→小红书；草稿写作且已展开→写作伙伴；其余隐藏。
 */
function renderAssistantRail() {
  const rail = $("#rail");
  if (!rail) return;
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (socialPreviewCtl) {
    socialPreviewCtl.destroy();
    socialPreviewCtl = null;
  }

  const draftWriting = page === "write" && !!current;
  if (!draftWriting) {
    rail.innerHTML = "";
    rail.classList.remove("preview-mode");
    syncRailVisibility();
    return;
  }

  const showPreviewRail = previewMode;
  rail.classList.toggle("preview-mode", !!showPreviewRail);

  if (showPreviewRail) {
    rail.innerHTML = `<div class="assistant-head"><span>小红书分页</span><div class="assistant-head-actions"><label class="social-size-label">字号 <select id="social-size"><option value="36">标准</option><option value="42">大字</option><option value="30">紧凑</option></select></label></div></div><div class="preview-actions"><button id="social-export" class="primary wide" disabled>导出图片</button><button id="copy-publish" class="wide">复制排版（公众号）</button><button id="push-wechat" class="wide">推送到草稿箱</button><p id="social-status" class="notice">正在排版…</p></div><div id="panel" data-ready="1"><div id="social-pages"></div></div>`;
    $("#copy-publish").onclick = () => copyPublish(current);
    $("#push-wechat").onclick = () => pushWechatDraft(current);
    socialPreviewCtl = bindSocialPreview(rail, {
      html: socialSourceHTML(),
      title: current.title,
      api,
      web: isWeb(),
    });
    syncRailVisibility();
    return;
  }

  // 默认收起：未展开时不挂载对话，节省资源
  if (!assistantOpen) {
    rail.innerHTML = "";
    syncRailVisibility();
    return;
  }

  rail.innerHTML = `<div class="assistant-head"><span>${I.sparkles()} 写作伙伴</span><div class="assistant-head-actions"><select id="provider"><option value="cursor">Cursor</option><option value="codex">Codex</option></select><button type="button" id="close-assistant" title="收起">${I.panelClose()} 收起</button></div></div><div class="tabs">${[
    ["chat", "对话"],
    ["topics", "思路"],
    ["titles", "标题"],
    ["prompts", "配图"],
    ["checks", "核查"],
  ]
    .map(
      ([id, name]) =>
        `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${name}</button>`,
    )
    .join("")}</div><div id="panel" data-ready="1"></div>`;

  const provider = $("#provider");
  if (provider) {
    provider.value = state.provider;
    provider.onchange = (e) => {
      state.provider = e.target.value;
      persist();
    };
  }
  $("#close-assistant").onclick = () => {
    assistantOpen = false;
    syncRailVisibility();
  };
  $$("#rail [data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        $$("#rail [data-tab]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        renderPanel();
      }),
  );
  renderPanel();
  syncRailVisibility();
}

/**
 * 渲染预览模式：中间公众号排版，右侧栏切换为小红书分页。
 */
function renderPreview() {
  previewDocId = current.id;
  $("#main").innerHTML = `<header><div class="header-lead"><h1 class="dashboard-tagline">${esc(current.title || "未命名文章")}</h1></div><div class="header-actions"><span id="saved">已保存到本地</span><button id="layout" class="primary">退出预览</button><button id="history">版本</button><button id="save-version">保存版本</button><button id="finalize" class="primary">定稿</button></div></header><div class="workspace preview-mode"><section class="paper-wrap"><article class="paper wechat-preview"><h1 class="preview-title">${esc(current.title || "未命名文章")}</h1><div class="byline">金奇 · ${new Date().toLocaleDateString("zh-CN")} <span id="wordcount">${current.body.length} 字</span></div><div id="article-preview">${safeHTML(current.body)}</div></article></section></div>`;
  bindArticleHeader();
  bindFinalize();
  enhanceWechatPreview();
  renderAssistantRail();
}

function renderWrite() {
  if (!current) {
    $("#main").innerHTML =
      `<div class="empty"><span class="eyebrow">A SPACE FOR YOUR WORDS</span><h1>把想说的话，写下来。</h1><p>从草稿开始，或导入已有文章。AI 在你需要时帮忙。</p><button class="primary" id="start">${I.plus()} 新建文章</button></div>`;
    $("#start").onclick = newDoc;
    renderAssistantRail();
    return;
  }
  if (previewMode && previewDocId && previewDocId !== current.id)
    previewMode = false;
  if (tab === "publish") tab = "chat";
  if (previewMode) {
    renderPreview();
    return;
  }
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">${esc(current.title || "未命名文章")}</h1></div><div class="header-actions"><span id="saved">已保存到本地</span><button type="button" id="toggle-assistant">${I.sparkles()} 写作伙伴</button><button id="layout">预览</button><button id="history">版本</button><button id="save-version">保存版本</button><button id="finalize" class="primary">定稿</button></div></header><div class="workspace"><section class="paper-wrap"><div class="formatbar"><button data-fmt="bold" title="加粗">${I.bold()}</button><button data-fmt="italic" title="斜体">${I.italic()}</button><button data-fmt="heading1" title="一级标题">${I.h1()}</button><button data-fmt="heading" title="二级标题">${I.h2()}</button><button data-fmt="bulletList" title="列表">${I.list()}</button><button data-fmt="blockquote" title="引用">${I.quote()}</button><button id="image" title="插入图片">${I.image()}</button><span></span><button id="outline" title="大纲">${I.outline()} 大纲</button><button id="focus" title="专注">${I.focus()} 专注</button></div><div id="outline-list" hidden></div><article class="paper"><input id="title" placeholder="给这个想法起个名字" value="${esc(current.title)}"><div class="article-materials"><button id="article-materials">项目参考文件</button>${(current.materials || []).map((p) => `<button data-related="${esc(p)}">${esc(p.split("/").pop().replace(/\.md$/, ""))}</button>`).join("")}</div><div class="byline">金奇 · ${new Date().toLocaleDateString("zh-CN")} <span id="wordcount">${current.body.length} 字</span></div><div id="editor"></div></article><div class="selection-bar"><span id="selection-label">选中正文，让 AI 帮你推敲</span><button id="tag-selection">${I.tags()} 引用选段</button><button data-task="review">${I.eye()} 看稿</button><button data-task="rewrite">${I.wand()} 润色选段</button><button data-task="check">${I.check()} 核查</button></div></section></div>`;
  editor = new Editor({
    element: $("#editor"),
    extensions: [StarterKit, Image, TableKit],
    content: safeHTML(current.body),
    onUpdate() {
      sync();
      $("#wordcount").textContent = current.body.length + " 字";
      changed();
    },
    onSelectionUpdate({ editor: e }) {
      const { from, to } = e.state.selection;
      if (to > from)
        selectionContext = {
          from,
          to,
          text: e.state.doc.textBetween(from, to, "\n"),
          version: e.getHTML(),
          doc: current.id,
        };
      selectedText = selectionContext?.text || "";
      $("#selection-label").textContent = selectedText
        ? "已选中 " + selectedText.length + " 字"
        : "选中正文，让 AI 帮你推敲";
    },
    editorProps: {
      handlePaste(view, event) {
        const item = [...(event.clipboardData?.items || [])].find((i) =>
          i.type.startsWith("image/"),
        );
        if (!item) return false;
        const f = item.getAsFile();
        const imageDoc = current,
          imageEditor = editor;
        f.arrayBuffer().then(async (b) => {
          try {
            sync();
            if (!(await persist())) return;
            const src = assetUrl(
              await api("image", {
                articleId: imageDoc.id,
                bytes: Array.from(new Uint8Array(b)),
                type: f.type,
              }),
            );
            if (current === imageDoc && editor === imageEditor)
              editor.chain().focus().setImage({ src }).run();
            else {
              imageDoc.body += "\n\n![图片](" + src + ")";
              await persist();
            }
          } catch (e) {
            toast(e.message);
          }
        });
        return true;
      },
    },
  });
  editorHTML = editor.getHTML();
  selectedText = "";
  selectionContext = null;
  $("#article-materials").onclick = () => {
    sync();
    persist();
    materialsFilter = current.id;
    page = "materials";
    render();
  };
  $$("[data-related]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          showMaterial(
            b.dataset.related,
            await api("material-read", b.dataset.related),
          );
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $("#title").oninput = (e) => {
    current.title = e.target.value;
    changed();
  };
  $$("[data-fmt]").forEach(
    (b) =>
      (b.onclick = () => {
        const c = editor.chain().focus();
        const f = b.dataset.fmt;
        if (f === "heading1") c.toggleHeading({ level: 1 }).run();
        else if (f === "heading") c.toggleHeading({ level: 2 }).run();
        else c["toggle" + f[0].toUpperCase() + f.slice(1)]().run();
      }),
  );
  $("#image").onclick = async () => {
    try {
      const imageDoc = current,
        imageEditor = editor;
      sync();
      if (!(await persist())) return;
      let imagePayload = { articleId: imageDoc.id };
      if (isWeb()) {
        const picked = await pickImagePayload();
        if (!picked) return;
        imagePayload = { ...imagePayload, ...picked };
      }
      const src = assetUrl(await api("image", imagePayload));
      if (src) {
        if (current === imageDoc && editor === imageEditor)
          editor.chain().focus().setImage({ src }).run();
        else {
          imageDoc.body += "\n\n![图片](" + src + ")";
          await persist();
        }
      }
    } catch (e) {
      toast(e.message);
    }
  };
  $("#focus").onclick = () => {
    $(".sidebar").classList.toggle("hidden");
  };
  $("#toggle-assistant").onclick = () => {
    assistantOpen = !assistantOpen;
    if (assistantOpen) renderAssistantRail();
    else syncRailVisibility();
  };
  $("#outline").onclick = () => {
    const n = $("#outline-list");
    n.hidden = !n.hidden;
    n.innerHTML =
      $$("#editor h1,#editor h2,#editor h3")
        .map(
          (x, i) =>
            `<button data-heading="${i}">${esc(x.textContent)}</button>`,
        )
        .join("") || "<p>添加标题后，这里会显示文章结构。</p>";
    $$("[data-heading]").forEach(
      (b) =>
        (b.onclick = () =>
          $$("#editor h1,#editor h2,#editor h3")[
            +b.dataset.heading
          ].scrollIntoView({ behavior: "smooth" })),
    );
  };
  bindArticleHeader();
  bindFinalize();
  $$("[data-task]").forEach((b) => {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      openAssistant();
      runTask(b.dataset.task);
    };
  });
  $("#tag-selection").onmousedown = (e) => e.preventDefault();
  $("#tag-selection").onclick = () => {
    openAssistant();
    tagSelection();
  };
  renderAssistantRail();
}

/**
 * 绑定主内容区与全局右侧栏之间的拖拽调宽，并恢复上次宽度。
 */
function bindWorkspaceResize() {
  const resizer = $("#workspace-resizer");
  const aside = $("#rail") || $(".assistant");
  if (!resizer || !aside) return;

  /** 将宽度限制在可用范围内 */
  const clamp = (w) => {
    const cap = previewMode && page === "write" ? 640 : 560;
    const max = Math.max(280, window.innerWidth - 480);
    return Math.min(Math.max(Math.round(w), 280), Math.min(cap, max));
  };

  const stored = Number(localStorage.getItem("inkdesk-assistant-width"));
  if (Number.isFinite(stored) && stored > 0) aside.style.width = clamp(stored) + "px";

  let startX = 0;
  let startW = 0;

  /** 拖拽过程中更新面板宽度 */
  const onMove = (e) => {
    aside.style.width = clamp(startW + (startX - e.clientX)) + "px";
  };

  /** 结束拖拽并记住宽度 */
  const onUp = () => {
    resizer.classList.remove("dragging");
    document.body.classList.remove("resizing-workspace");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    localStorage.setItem(
      "inkdesk-assistant-width",
      String(Math.round(aside.getBoundingClientRect().width)),
    );
  };

  resizer.onpointerdown = (e) => {
    if (aside.classList.contains("hidden")) return;
    e.preventDefault();
    startX = e.clientX;
    startW = aside.getBoundingClientRect().width;
    resizer.classList.add("dragging");
    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}
function renderPanel() {
  if (previewMode) return;
  if (composer) {
    composer.destroy();
    composer = null;
  }
  $$("[data-task]").forEach((b) => (b.disabled = busy));
  const panel = $("#panel");
  if (!panel) return;
  if (tab === "publish") tab = "chat";
  const key = tab;
  let content = "";
  if (tab === "chat") {
    content =
      conversation()
        .messages.map(
          (m) =>
            `<div class="message ${m.role}"><div>${m.parts ? m.parts.map((p) => (p.kind === "tag" ? `<span class="inline-reference">${esc(p.label)}</span>` : esc(p.text))).join("") : esc(m.text)}</div></div>`,
        )
        .join("") ||
      '<div class="welcome"><span class="welcome-icon">' +
      I.sparkles({ size: 22 }) +
      "</span><h3>先保留你的声音。</h3><p>一起聊想法，或选中一段文字推敲。<br>修改先预览，由你决定是否采用。</p></div>";
  } else {
    const labels = {
      topics: ["本篇思路", "围绕表达意图，准备少量可用角度。"],
      titles: ["标题建议", "给同一篇文章，找到更贴切的开头。"],
      prompts: ["配图提示词", "复制到 Lovart，生成后导入正文。"],
      checks: ["内容核查", "来源不足的判断会保留为待核实。"],
    };
    content =
      `<div class="panel-intro"><h3>${labels[key][0]}</h3><p>${labels[key][1]}</p></div>` +
      (current[key] || [])
        .map(
          (x, i) =>
            `<div class="result-card"><small>${new Date(x.at).toLocaleDateString("zh-CN")}</small><div>${esc(x.text)}</div><button data-copy="${i}">复制</button>${key === "titles" ? `<button data-use="${i}">选择标题</button>` : ""}</div>`,
        )
        .join("") +
      `<button class="secondary wide" id="generate">${I.sparkles()} 生成${labels[key][0]}</button>`;
  }
  panel.innerHTML = `${tab === "chat" ? `<div class="conversation-bar"><select id="conversation">${current.conversations.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}</select><button id="new-conversation" title="为本篇创建新对话">${I.plus()} 新对话</button></div>` : ""}<div class="panel-scroll">${
    pending &&
    pending.doc === current.id &&
    pending.conversationId === conversation().id
      ? `<div class="review-card"><h3>修改建议</h3><div class="diff">${diffWords(
          pending.old,
          pending.next,
        )
          .map(
            (p) =>
              `<${p.added ? "ins" : p.removed ? "del" : "span"}>${esc(p.value)}</${p.added ? "ins" : p.removed ? "del" : "span"}>`,
          )
          .join(
            "",
          )}</div><div class="row"><button id="accept" class="primary">接受修改</button><button id="reject">保留原文</button></div></div>`
      : ""
  }${content}</div><div class="composer"><div id="composer-input"></div><div class="composer-tools"><button id="chat-upload">${I.upload()} 上传文件</button><button id="chat-reference">${I.at()} 项目文件</button><button id="rewrite-tags">${I.tags()} 改写标签选段</button><button id="send" class="primary">${busy ? "停止" : `${I.send()} 发送`}</button></div></div>`;
  if (tab === "chat") {
    $("#conversation").value = conversation().id;
    $("#conversation").onchange = (e) => {
      current.activeConversationId = e.target.value;
      persist();
      renderPanel();
    };
    $("#new-conversation").onclick = () => {
      const c = {
        id: crypto.randomUUID(),
        title: "新对话 " + (current.conversations.length + 1),
        messages: [],
      };
      current.conversations.push(c);
      current.activeConversationId = c.id;
      persist();
      renderPanel();
    };
  }
  $("#send").onclick = () =>
    busy ? api("cancel") : runTask(tab === "chat" ? "chat" : tab);
  composer = new Composer($("#composer-input"), conversation(), {
    changed: () => {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 500);
    },
    send: () => $("#send").click(),
    picker: () => chooseChatFile(),
  });
  $("#chat-reference").onclick = () => chooseChatFile();
  $("#chat-upload").onclick = uploadChatFiles;
  for (const id of ["#chat-upload", "#chat-reference"])
    $(id).onmousedown = (e) => e.preventDefault();
  $("#rewrite-tags").onclick = () => runTask("rewrite-tags");
  if ($("#generate")) $("#generate").onclick = () => runTask(tab);
  $$("[data-copy]").forEach(
    (b) =>
      (b.onclick = () =>
        api("copy", { text: current[key][+b.dataset.copy].text }).then(() =>
          toast("已复制"),
        )),
  );
  $$("[data-use]").forEach(
    (b) =>
      (b.onclick = () => {
        const value = current[key][+b.dataset.use].text
          .split("\n")[0]
          .replace(/^[-*#\d.、\s]+/, "")
          .trim();
        if (value) {
          current.title = value;
          $("#title").value = value;
          changed();
        }
      }),
  );
  if ($("#accept"))
    $("#accept").onclick = () => {
      sync();
      if (current.body !== pending.base) {
        toast("正文已变化，请重新生成建议。");
        pending = null;
        renderPanel();
        return;
      }
      current.decisions ??= [];
      current.decisions.push({
        action: "accepted",
        before: pending.old,
        after: pending.next,
        at: new Date().toISOString(),
      });
      current.snapshots.push({
        at: new Date().toISOString(),
        body: current.body,
      });
      if (pending.edits) {
        let chain = editor.chain().focus();
        for (const e of [...pending.edits].sort((a, b) => b.from - a.from))
          chain = chain.insertContentAt(
            { from: e.from, to: e.to },
            safeHTML(e.next),
          );
        chain.run();
      } else if (pending.from !== pending.to)
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: pending.from, to: pending.to },
            safeHTML(pending.next),
          )
          .run();
      else editor.commands.setContent(safeHTML(pending.next));
      sync();
      changed();
      pending = null;
      renderPanel();
      toast("已应用，可用 ⌘Z 撤回");
    };
  if ($("#reject"))
    $("#reject").onclick = () => {
      current.decisions ??= [];
      current.decisions.push({
        action: "rejected",
        before: pending.old,
        after: pending.next,
        at: new Date().toISOString(),
      });
      changed();
      pending = null;
      renderPanel();
    };
}
async function runTask(task) {
  if (busy) return toast("请等待当前任务，或停止后重试");
  sync();
  const doc = current;
  const body = doc.body;
  const context =
    selectionContext?.doc === current.id &&
    selectionContext.version === editor.getHTML()
      ? selectionContext
      : null;
  const { from, to } = context || editor.state.selection;
  const selection =
    context?.text || editor.state.doc.textBetween(from, to, "\n");
  let draft;
  try {
    draft = composer?.serialize() || {
      instruction: "",
      display: "",
      parts: [],
      references: [],
    };
  } catch (e) {
    return toast(e.message);
  }
  const instruction = draft.instruction;
  const anchors = draft.references.filter((r) => r.kind === "selection");
  if (anchors.some((r) => r.articleId !== doc.id || r.base !== body))
    return toast("引用选段已过期，请删除标签并重新选中添加");
  if (task === "rewrite-tags") {
    if (!anchors.length) return toast("请先添加正文选段标签");
    const sorted = [...anchors].sort((a, b) => a.from - b.from);
    if (sorted.some((a, i) => i > 0 && a.from < sorted[i - 1].to))
      return toast("选段有重叠，请保留不重叠的标签");
  }
  if (task === "rewrite" && !selection) return toast("请先选中需要润色的段落");
  if (task === "chat" && !instruction) return toast("先写一句想讨论的内容");
  const prompts = {
    "rewrite-tags":
      "仅改写标记的正文选段，文件标签是参考资料。只返回 JSON 数组 [{id,text}]，id 为每个正文选段的引用 ID，text 为该选段修改后的完整文本，保持未标记内容不变。每个选段恰好一个结果。",
    review: "指出最多三个值得修改的问题，解释取舍，不重写。",
    rewrite: "保留原意和个人语气，轻量润色。",
    check:
      "检查事实、案例和专业概念。区分已核实与待核实；没有真实检索证据不得宣称核实完成或编造链接。",
    titles:
      "给出三个标题。只返回 JSON 数组，每项含 title 和 reason 字段，不要代码围栏。",
    prompts:
      "给出两张正文配图的中文提示词，说明对应段落与图意，适合复制到 Lovart。",
    topics: "提炼表达意图，给出三个与本篇相关的可写角度和所需素材。",
    checks: "检查关键事实与推理边界，没有检索证据的条目列为待核实。",
    chat: "",
  };
  const session = conversation(doc);
  if (!session.messages.length)
    session.title = (draft.display || prompts[task]).slice(0, 22);
  session.messages.push({
    role: "user",
    text: draft.display || prompts[task],
    parts: draft.parts.length ? draft.parts : undefined,
  });
  const submittedDraft = session.composerDraft;
  const submittedRefs = session.composerRefs;
  session.composerDraft = null;
  session.composerRefs = {};
  session.composerPosition = 1;
  busy = true;
  await persist();
  if (["review", "rewrite", "check", "rewrite-tags"].includes(task))
    tab = "chat";
  renderPanel();
  const history = session.messages
    .slice(-8, -1)
    .map((x) => x.role + ": " + x.text)
    .join("\n");
  try {
    const result = await api("agent", {
      provider: state.provider,
      model: state.model,
      account: doc.account,
      task,
      articleId: doc.id,
      references: draft.references,
      instruction: (prompts[task] || "") + "\n" + instruction,
      body,
      selection,
      history,
    });
    if (!result) throw Error("Agent 未返回正文");
    session.messages.push({ role: "assistant", text: result });
    if (task === "rewrite-tags") {
      const results = JSON.parse(
        result.replace(/^```(?:json)?\s*|\s*```$/g, ""),
      );
      if (
        !Array.isArray(results) ||
        results.length !== anchors.length ||
        new Set(results.map((x) => x.id)).size !== anchors.length ||
        results.some(
          (x) =>
            !anchors.some((a) => a.refId === x.id) ||
            typeof x.text !== "string",
        )
      )
        throw Error("AI 未返回完整的选段建议，正文保持不变");
      const edits = anchors.map((a) => ({
        ...a,
        old: a.text,
        next: results.find((r) => r.id === a.refId).text,
      }));
      if (doc.id === current?.id)
        pending = {
          doc: doc.id,
          conversationId: session.id,
          base: body,
          edits,
          old: edits.map((x) => x.label + "\n" + x.old).join("\n\n"),
          next: edits.map((x) => x.label + "\n" + x.next).join("\n\n"),
        };
    } else if (task === "rewrite") {
      if (doc.id === current?.id)
        pending = {
          doc: doc.id,
          conversationId: session.id,
          base: body,
          old: selection || body,
          next: result,
          from,
          to,
        };
    } else if (
      ["titles", "prompts", "topics", "checks", "check"].includes(task)
    ) {
      const k = task === "check" ? "checks" : task;
      doc[k] ??= [];
      if (k === "titles") {
        try {
          const items = JSON.parse(
            result.replace(/^```(?:json)?\s*|\s*```$/g, ""),
          );
          if (!Array.isArray(items)) throw Error();
          doc[k].unshift(
            ...items
              .filter((x) => typeof x.title === "string")
              .map((x) => ({
                text: x.title + "\n" + (x.reason || ""),
                at: new Date().toISOString(),
              })),
          );
        } catch {
          doc[k].unshift({ text: result, at: new Date().toISOString() });
        }
      } else doc[k].unshift({ text: result, at: new Date().toISOString() });
    }
    await persist();
  } catch (e) {
    toast(e.message);
    if (!session.composerDraft) {
      session.composerDraft = submittedDraft;
      session.composerRefs = submittedRefs;
    }
    session.messages.push({
      role: "assistant",
      text: "本次未完成：" + e.message,
    });
  } finally {
    busy = false;
    await persist();
    if (page === "write") renderPanel();
  }
}
async function copyPublish(doc) {
  if (!doc) doc = current;
  if (doc === current) sync();
  if (!doc) return;
  const html = await publishHTML(doc.body);
  const d = new DOMParser().parseFromString(html, "text/html");
  await api("copy", { html, text: d.body.textContent });
  toast("排版已复制；本地图片请在公众号补入");
}

/**
 * 推送当前文章到微信公众号草稿箱（上传正文图与封面后 draft/add）。
 * H1/H2/引用会先画成图片再上传，保证公众号样式一致。
 * @param {object} [doc]
 */
async function pushWechatDraft(doc) {
  if (!doc) doc = current;
  if (doc === current) sync();
  if (!doc) return;
  if (isWeb()) return toast("草稿推送仅支持桌面端");
  const btn = $("#push-wechat");
  if (btn) btn.disabled = true;
  try {
    toast("正在生成标题图并推送…");
    const result = await api("wechat-draft-push", {
      title: doc.title || "未命名文章",
      html: await publishHTML(doc.body, {
        keepImages: true,
        blockImages: true,
      }),
    });
    toast(
      `已推送到草稿箱「${result.title}」` +
        (result.imageCount ? `（上传 ${result.imageCount} 张图）` : ""),
    );
  } catch (e) {
    toast(e.message || "推送失败");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 选择笔记列表明细 xlsx */
async function pickNoteTable() {
  if (!isWeb()) {
    const filePath = await api("pick-note-table");
    return filePath ? { filePath } : null;
  }
  const files = await pickFiles({
    accept:
      ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const f = files[0];
  if (!f) return null;
  return {
    bytes: [...new Uint8Array(await f.arrayBuffer())],
  };
}

/** 弹窗询问当前粉丝量 */
function askFollowers(defaultVal) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>更新账号数据</h2><p>请输入当前粉丝量（将显示在仪表盘）</p><input id="follower-input" type="number" min="0" step="1" value="${esc(defaultVal ?? "")}" placeholder="例如 12000"><div class="row"><button type="button" id="cancel-followers">取消</button><button type="button" id="confirm-followers" class="primary">继续</button></div></div>`;
    document.body.append(m);
    const input = $("#follower-input");
    input.focus();
    $("#cancel-followers").onclick = () => {
      m.remove();
      resolve(null);
    };
    $("#confirm-followers").onclick = () => {
      const n = Number(String(input.value).replace(/,/g, "").trim());
      m.remove();
      resolve(Number.isFinite(n) && n >= 0 ? n : null);
    };
  });
}

/** 为未自动匹配的表格行选择归档文章（优先建议，默认近半年，可搜索） */
function showUnmatchedMatcher(preview) {
  return new Promise((resolve) => {
    const archives = preview.archives || [];
    const halfYearAgo = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
    })();
    /** 近半年归档；搜索时扩大到全量 */
    const recent = () =>
      archives.filter((a) => !a.date || String(a.date).slice(0, 10) >= halfYearAgo);
    /** 按关键词筛选归档，无关键词时返回近半年列表 */
    const filterArchives = (q) => {
      const list = q ? archives : recent();
      const key = String(q || "")
        .trim()
        .toLowerCase();
      if (!key) return list;
      return list.filter(
        (a) =>
          a.title.toLowerCase().includes(key) ||
          String(a.date || "").includes(key),
      );
    };
    /** 渲染单条未匹配行的下拉选项 */
    const optionsHtml = (u, q = "") => {
      const suggested = (u.suggestions || []).map((s) => s.path);
      const list = filterArchives(q);
      const merged = [];
      const seen = new Set();
      for (const s of u.suggestions || []) {
        const a = archives.find((x) => x.path === s.path);
        if (a && !seen.has(a.path)) {
          seen.add(a.path);
          merged.push({ ...a, hint: `建议 ${s.score}%` });
        }
      }
      for (const a of list) {
        if (!seen.has(a.path)) {
          seen.add(a.path);
          merged.push(a);
        }
      }
      const preferred = u.suggestions?.[0]?.path || "";
      return (
        `<option value="">跳过</option>` +
        merged
          .map(
            (a) =>
              `<option value="${esc(a.path)}" ${a.path === preferred ? "selected" : ""}>${esc(a.title)}${a.date ? " · " + esc(String(a.date).slice(0, 10)) : ""}${a.hint ? " · " + a.hint : ""}</option>`,
          )
          .join("")
      );
    };
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog import-dialog"><div class="row"><h2>未能自动匹配的笔记</h2><button type="button" id="close-unmatched">关闭</button></div><p>已按相似度给出建议；列表默认近半年，也可搜索全部归档。</p>${preview.unmatched
      .map(
        (u) =>
          `<div class="match-row" data-index="${u.index}"><p><strong>${esc(u.row.title)}</strong>${u.row["首次发布时间"] ? `<small>${esc(u.row["首次发布时间"])}</small>` : ""}</p><input class="match-search" type="search" placeholder="搜索归档文章…"><select class="match-pick" aria-label="匹配归档">${optionsHtml(u)}</select></div>`,
      )
      .join(
        "",
      )}<div class="row"><button type="button" id="cancel-unmatched">取消导入</button><button type="button" id="confirm-unmatched" class="primary">确认匹配</button></div></div>`;
    document.body.append(m);
    m.querySelectorAll(".match-row").forEach((row) => {
      const u = preview.unmatched.find((x) => x.index === +row.dataset.index);
      const search = row.querySelector(".match-search");
      const pick = row.querySelector(".match-pick");
      search.oninput = () => {
        const current = pick.value;
        pick.innerHTML = optionsHtml(u, search.value);
        if ([...pick.options].some((o) => o.value === current))
          pick.value = current;
      };
    });
    $("#close-unmatched").onclick = $("#cancel-unmatched").onclick = () => {
      m.remove();
      resolve(null);
    };
    $("#confirm-unmatched").onclick = () => {
      const extra = [];
      m.querySelectorAll(".match-row").forEach((row) => {
        const path = row.querySelector(".match-pick").value;
        if (path) extra.push({ index: +row.dataset.index, path });
      });
      m.remove();
      resolve(extra);
    };
  });
}

/** 格式化增减：+12 / -3；无变化返回空串 */
function formatDelta(n) {
  if (n == null || n === 0 || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return (v > 0 ? "+" : "") + v.toLocaleString();
}

/** 从 xlsx 导入笔记数据并更新归档 YAML */
async function runNoteImport() {
  try {
    const filePayload = await pickNoteTable();
    if (!filePayload) return;
    const followers = await askFollowers(state.followers?.[account]);
    if (followers === null) return toast("粉丝量无效或已取消");
    const preview = await api("import-notes-preview", {
      account,
      ...filePayload,
    });
    let pairs = preview.matched.map((m) => ({
      index: m.index,
      path: m.path,
    }));
    if (preview.unmatched.length) {
      const manual = await showUnmatchedMatcher(preview);
      if (manual === null) return toast("已取消导入");
      pairs = pairs.concat(manual);
    }
    if (!pairs.length) return toast("没有可更新的匹配项");
    const result = await api("import-notes-apply", {
      account,
      followers,
      rows: preview.rows,
      pairs,
    });
    Object.assign(state, result);
    dirty = false;
    page = "dashboard";
    render();
    toast(`已更新 ${result.updated?.length ?? pairs.length} 篇归档与 YAML`);
  } catch (e) {
    toast(e.message);
  }
}

function renderDashboard() {
  const rows = state.metrics.filter(
    (r) => r["账号"] === account || r["账号"] === "金奇_" + account,
  );
  const deltas = state.metricDeltas?.[account] || null;
  const sum = (k) =>
    rows.some((r) => r[k] !== null)
      ? rows.reduce((s, r) => s + (r[k] || 0), 0).toLocaleString()
      : "—";
  /** 卡片数值旁的增减标记 */
  const deltaMark = (key) => {
    const text = formatDelta(deltas?.[key]);
    if (!text) return "";
    const cls = Number(deltas[key]) > 0 ? "up" : "down";
    return `<em class="delta ${cls}">${text}</em>`;
  };
  /** 表格单元格增减 */
  const cellDelta = (path, key) => {
    const text = formatDelta(deltas?.articles?.[path]?.[key]);
    if (!text) return "";
    const cls = Number(deltas.articles[path][key]) > 0 ? "up" : "down";
    return ` <em class="delta ${cls}">${text}</em>`;
  };
  const sortKeys = [
    ["阅读", "按阅读量"],
    ["收藏", "按收藏"],
    ["点赞", "按点赞"],
    ["涨粉", "按涨粉"],
    ["日期", "按日期"],
  ];
  /** 按当前排序字段排列归档文章 */
  const sorted = [...rows].sort((a, b) => {
    if (metricsSort === "日期")
      return String(b["日期"] || "").localeCompare(String(a["日期"] || ""));
    return (b[metricsSort] || 0) - (a[metricsSort] || 0);
  });
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">让每一次表达，都有回响。</h1><span class="eyebrow">YOUR WRITING, IN PERSPECTIVE</span></div><div class="header-actions"><button type="button" id="refresh-dashboard" class="ghost icon-btn" title="从磁盘同步本地数据" aria-label="刷新">${I.refresh({ size: 18 })}</button><button id="import-notes" class="primary">更新数据</button></div></header><section class="dashboard"><div class="stats">${[
      ["粉丝量", "粉丝量"],
      ["阅读", "总阅读"],
      ["点赞", "总点赞"],
      ["收藏", "总收藏"],
      ["评论", "总评论"],
      ["涨粉", "文章涨粉合计"],
      ["文章", "总文章数量"],
    ]
      .map(
        ([k, l]) =>
          `<div><small>${l}</small><strong title="${k === "涨粉" ? "汇总文章 YAML 的涨粉字段，不是账号净增粉丝，也不是工作台估算" : k === "粉丝量" ? "导入数据时填写的当前粉丝量" : ""}">${k === "文章" ? rows.length.toLocaleString() : k === "粉丝量" ? (state.followers?.[account] != null ? Number(state.followers[account]).toLocaleString() : "—") : sum(k)}${deltaMark(k)}</strong></div>`,
      )
      .join(
        "",
      )}</div><div id="publishing-calendar" class="dashboard-card"></div><div class="dashboard-card"><div class="row performance-head"><h3>已发布</h3><select id="metrics-sort" aria-label="文章排序方式">${sortKeys.map(([k, l]) => `<option value="${k}" ${metricsSort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>${
      rows.length
        ? `<table><thead><tr><th>文章</th><th>日期</th><th>阅读</th><th>点赞</th><th>收藏</th><th>涨粉</th></tr></thead><tbody>${sorted
            .map(
              (r) =>
                `<tr><td><button type="button" class="title-preview" data-published="${esc(r.path)}">${esc(r["标题"])}</button></td><td>${esc(r["日期"])}</td><td>${r["阅读"] ?? "—"}${cellDelta(r.path, "阅读")}</td><td>${r["点赞"] ?? "—"}${cellDelta(r.path, "点赞")}</td><td>${r["收藏"] ?? "—"}${cellDelta(r.path, "收藏")}</td><td>${r["涨粉"] ?? "—"}${cellDelta(r.path, "涨粉")}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : '<div class="empty-data">还没有数据。<p>文章归档后，在 YAML 中填写平台数据即可查看。</p></div>'
    }</div></section>`;
  renderCalendar(rows);
  $("#metrics-sort").onchange = (e) => {
    metricsSort = e.target.value;
    renderDashboard();
  };
  $("#refresh-dashboard").onclick = () => refreshDashboardData();
  $("#import-notes").onclick = () => runNoteImport();
  $$("[data-published]").forEach(
    (b) => (b.onclick = () => openPublishedPreview(b.dataset.published)),
  );
}

/**
 * 在右侧抽屉预览已发布文章，并支持在 Finder / 默认应用中打开源文件。
 * @param {string} rel vault 相对路径
 */
async function openPublishedPreview(rel) {
  const row = (state.archives || []).find((a) => a.path === rel);
  const title =
    row?.title || rel.split("/").pop().replace(/\.md$/, "") || "文章";
  $("#published-drawer")?.remove();
  const n = document.createElement("aside");
  n.id = "published-drawer";
  n.className = "reference-drawer published-drawer";
  n.innerHTML = `<div class="published-drawer-head"><span class="published-drawer-label">预览</span><div class="published-drawer-toolbar"><button type="button" id="published-reveal" class="icon-btn" data-tip="在 Finder 中显示" title="在 Finder 中显示" aria-label="在 Finder 中显示">${I.folder({ size: 18 })}</button><button type="button" id="published-open" class="icon-btn" data-tip="用默认应用打开" title="用默认应用打开" aria-label="用默认应用打开">${I.external({ size: 18 })}</button><button type="button" id="close-published" class="icon-btn" data-tip="关闭" title="关闭" aria-label="关闭">${I.close({ size: 18 })}</button></div></div><div class="material-preview" id="published-body"><h3 class="published-article-title">${esc(title)}</h3><p class="muted">加载中…</p></div>`;
  document.body.append(n);
  $("#close-published").onclick = () => n.remove();
  try {
    const body = row?.body ?? (await api("published-read", rel));
    $("#published-body").innerHTML =
      `<h3 class="published-article-title">${esc(title)}</h3>` + safeHTML(body);
  } catch (e) {
    $("#published-body").innerHTML =
      `<h3 class="published-article-title">${esc(title)}</h3><p class="notice">${esc(e.message)}</p>`;
  }
  $("#published-reveal").onclick = async () => {
    try {
      await api("vault-reveal", rel);
    } catch (e) {
      toast(e.message);
    }
  };
  $("#published-open").onclick = async () => {
    try {
      await api("vault-open", rel);
    } catch (e) {
      toast(e.message);
    }
  };
}

/** 仪表盘刷新：重新读取开发副本，同步外部改动的 YAML / 归档 */
async function refreshDashboardData() {
  if (busy) return toast("AI 正在回复，请结束后再刷新");
  sync();
  const apply = (result) => {
    const id = current?.id;
    Object.assign(state, result);
    current =
      state.documents.find((d) => d.id === id) ||
      state.documents.find((d) => d.account === account);
    dirty = false;
    pending = null;
    page = "dashboard";
    render();
    toast(
      state.warnings?.length
        ? "已同步，部分文件未读取，请在存储设置查看"
        : "已同步本地数据",
    );
  };
  if (!(await persist())) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML =
      '<div class="dialog"><h2>本次保存未完成</h2><p>可以保留当前未保存内容到本地恢复文件，再读取磁盘版本。</p><button id="cancel-reload">继续编辑</button><button id="recover-reload" class="primary">备份未保存内容并刷新</button></div>';
    document.body.append(m);
    $("#cancel-reload").onclick = () => m.remove();
    $("#recover-reload").onclick = async () => {
      try {
        apply(await api("recover-refresh", state));
        m.remove();
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  try {
    apply(await api("refresh"));
  } catch (e) {
    toast(e.message);
  }
}

function renderTopics() {
  const docs = state.documents.filter(
    (d) => d.account === account && d.topics?.length,
  );
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">值得继续聊的想法。</h1><span class="eyebrow">IDEAS TO COME BACK TO</span></div></header><section class="dashboard"><div class="topic-grid">${docs.map((d) => `<div class="result-card"><h3>${esc(d.title)}</h3><div>${esc(d.topics[0].text)}</div><button class="primary" data-open="${d.id}">继续这篇文章 →</button></div>`).join("") || '<div class="empty-data">打开一篇文章，在「思路」面板生成或讨论选题。</div>'}</div></section>`;
  $$("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        current = state.documents.find((d) => d.id === b.dataset.open);
        page = "write";
        tab = "topics";
        render();
      }),
  );
}
function renderSettings() {
  const wx = state.wechat || {};
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">设置</h1><span class="eyebrow">YOUR TOOLS, YOUR CHOICE</span></div></header><section class="dashboard settings"><div class="dashboard-card"><h3>Agent 连接</h3><label>默认 Agent<select id="setting-provider"><option value="cursor">Cursor ${state.agents.cursor ? "· 已找到 CLI" : "· 未安装"}</option><option value="codex">Codex ${state.agents.codex ? "· 已找到 CLI" : "· 未安装"}</option></select></label><label>模型（留空沿用 CLI 默认）<input id="model" value="${esc(state.model)}" placeholder="可选模型 ID"></label><p>复用 CLI 登录。若未登录，请先在终端执行 agent login 或 codex login。此版本不保存账号凭据。</p><button class="primary" id="save-settings">保存设置</button></div><div class="dashboard-card"><h3>微信公众号</h3><p>用于一键推送到草稿箱。AppSecret 仅保存在本机 workspace.json。</p><label>AppID<input id="wechat-appid" value="${esc(wx.appId || "")}" placeholder="wx…" autocomplete="off"></label><label>AppSecret<input id="wechat-secret" type="password" value="${esc(wx.appSecret || "")}" placeholder="密钥" autocomplete="off"></label><label>默认作者<input id="wechat-author" value="${esc(wx.author || "金奇")}" placeholder="金奇"></label><label>默认封面路径<input id="wechat-cover" value="${esc(wx.coverPath || "")}" placeholder="可选；也可依赖正文首图" readonly><button type="button" id="wechat-pick-cover">选择封面</button></label><div class="row"><button type="button" id="wechat-test">测试连接</button><button type="button" class="primary" id="save-wechat">保存公众号设置</button></div></div><div class="dashboard-card"><h3>本地数据</h3>${state.warnings?.length ? `<p class="notice">${state.warnings.map(esc).join("<br>")}</p>` : ""}<p>${esc(state.dataPath)}</p><h3>Content_OS 来源</h3><p>${esc(state.source || "尚未选择")}</p><p>开发阶段直接读写独立副本；正文在 02_Drafts，定稿后移动到 03_Archive，图片在 Attachment/文章名，素材在 00_wiki，版本和对话在 _system/inkdesk。上线后再配置正式目录。</p><button type="button" id="refresh-vault">${I.refresh()} 刷新开发副本</button></div></section>`;
  $("#setting-provider").value = state.provider;
  $("#save-settings").onclick = () => {
    state.provider = $("#setting-provider").value;
    state.model = $("#model").value.trim();
    persist();
    toast("设置已保存");
  };
  /** 把表单写回 state.wechat */
  const readWechatForm = () => {
    state.wechat = {
      appId: $("#wechat-appid").value.trim(),
      appSecret: $("#wechat-secret").value.trim(),
      author: $("#wechat-author").value.trim() || "金奇",
      coverPath: $("#wechat-cover").value.trim(),
    };
  };
  $("#wechat-pick-cover").onclick = async () => {
    if (isWeb()) return toast("封面选择仅支持桌面端");
    try {
      const p = await api("wechat-pick-cover");
      if (p) $("#wechat-cover").value = p;
    } catch (e) {
      toast(e.message);
    }
  };
  $("#wechat-test").onclick = async () => {
    readWechatForm();
    await persist();
    try {
      await api("wechat-test-token");
      toast("公众号凭证有效");
    } catch (e) {
      toast(e.message || "连接失败");
    }
  };
  $("#save-wechat").onclick = () => {
    readWechatForm();
    persist();
    toast("公众号设置已保存");
  };
  $("#refresh-vault").onclick = () => refreshVault();
}
async function refreshVault() {
  if (busy) return toast("AI 正在回复，请结束后刷新");
  sync();
  const apply = (result) => {
    const id = current?.id;
    Object.assign(state, result);
    current =
      state.documents.find((d) => d.id === id) ||
      state.documents.find((d) => d.account === account);
    dirty = false;
    pending = null;
    render();
    toast(
      state.warnings?.length
        ? "部分文件未读取，请在存储设置查看错误"
        : "已读取开发副本",
    );
  };
  if (!(await persist())) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML =
      '<div class="dialog"><h2>本次保存未完成</h2><p>可以保留当前未保存内容到本地恢复文件，再读取磁盘版本。恢复文件位于 _system/inkdesk/recovery。</p><button id="cancel-reload">继续编辑</button><button id="recover-reload" class="primary">备份未保存内容并刷新</button></div>';
    document.body.append(m);
    $("#cancel-reload").onclick = () => m.remove();
    $("#recover-reload").onclick = async () => {
      try {
        const result = await api("recover-refresh", state);
        m.remove();
        apply(result);
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  try {
    apply(await api("refresh"));
  } catch (e) {
    toast(e.message);
  }
}
function showMaterial(rel, body) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="dialog"><div class="row"><h2>${esc(rel.split("/").pop())}</h2><button id="close-material" class="icon-btn" title="关闭" aria-label="关闭">${I.close()}</button></div><div class="material-preview">${safeHTML(body)}</div>${current ? '<p class="notice">选中素材文字后，可将选段插入当前草稿。未选中文字时仅插入素材链接。</p><button id="insert-material" class="primary">插入到草稿末尾</button>' : ""}</div>`;
  document.body.append(m);
  $("#close-material").onclick = () => m.remove();
  if ($("#insert-material"))
    $("#insert-material").onclick = async () => {
      const selection = window.getSelection();
      const selected =
        selection && $(".material-preview").contains(selection.anchorNode)
          ? selection.toString()
          : "";
      current.body +=
        "\n\n" +
        (selected ? "> " + selected.split("\n").join("\n> ") + "\n\n" : "") +
        "[[" +
        rel.replace(/\.md$/, "") +
        "]]";
      current.materials ||= [];
      if (!current.materials.includes(rel)) current.materials.push(rel);
      dirty = true;
      await persist();
      m.remove();
      page = "write";
      render();
    };
}
function putTag(reference, doc = current, session = conversation(doc)) {
  if (current?.id !== doc.id || conversation(doc).id !== session.id) {
    session.composerRefs ||= {};
    const refId = crypto.randomUUID();
    session.composerRefs[refId] = { ...reference, refId };
    session.composerDraft ||= { type: "doc", content: [{ type: "paragraph" }] };
    const content = session.composerDraft.content;
    content[content.length - 1].content ||= [];
    content[content.length - 1].content.push(
      { type: "referenceTag", attrs: { refId, label: reference.label } },
      { type: "text", text: " " },
    );
    dirty = true;
    persist();
    return;
  }
  if (page !== "write") {
    page = "write";
    tab = "chat";
    render();
  } else if (!composer) {
    tab = "chat";
    renderPanel();
  }
  composer.insert(reference);
  dirty = true;
  persist();
}
function tagSelection() {
  sync();
  const c =
    selectionContext?.doc === current.id &&
    selectionContext.version === editor.getHTML()
      ? selectionContext
      : null;
  if (!c || c.from === c.to) return toast("请先选中正文中的一段文字");
  putTag({
    kind: "selection",
    articleId: current.id,
    base: current.body,
    from: c.from,
    to: c.to,
    text: c.text,
    label: "正文选段 · " + c.text.length + "字",
  });
}
async function uploadChatFiles() {
  const doc = current,
    c = conversation(doc),
    button = $("#chat-upload");
  let insertionPosition = c.composerPosition;
  button.disabled = true;
  try {
    sync();
    if (!(await persist())) return;
    const before = await api("project-refs", doc.id),
      known = new Set(before.map((r) => r.id));
    const list = await uploadProjectFiles(doc.id);
    if (!list) return;
    const added = list.filter((r) => !known.has(r.id));
    for (const r of added.filter((r) => r.status === "ready")) {
      c.composerPosition = insertionPosition;
      putTag({ kind: "file", fileId: r.id, label: r.name }, doc, c);
      insertionPosition = c.composerPosition;
    }
    if (added.some((r) => r.status !== "ready"))
      toast("部分文件未能提取文字，请在项目素材中查看原因");
  } catch (e) {
    toast(e.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
async function chooseChatFile() {
  const doc = current,
    c = conversation(doc);
  const insertionPosition = c.composerPosition;
  try {
    const refs = await api("project-refs", doc.id);
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><div class="row"><h2>在光标处引用文件</h2><button id="close-picker">关闭</button></div><p>有文件标签时，本次只使用标签中的文件资料。</p><input id="reference-search" placeholder="搜索本项目文件"><div id="reference-options" class="material-cards"></div></div>`;
    document.body.append(m);
    $("#close-picker").onclick = () => m.remove();
    const list = () => {
      $("#reference-options").innerHTML =
        refs
          .filter((r) =>
            r.name
              .toLowerCase()
              .includes($("#reference-search").value.toLowerCase()),
          )
          .map(
            (r) =>
              `<button class="material-card" data-pick-ref="${r.id}" ${r.status === "ready" ? "" : "disabled"}><strong>${esc(r.name)}</strong><small>${r.characters} 字 · ${r.status === "ready" ? "引用此文件" : esc(r.error)}</small></button>`,
          )
          .join("") || "<p>暂无文件，可先从对话框上传。</p>";
      $$("[data-pick-ref]").forEach(
        (b) =>
          (b.onclick = () => {
            const r = refs.find((r) => r.id === b.dataset.pickRef);
            m.remove();
            c.composerPosition = insertionPosition;
            putTag({ kind: "file", fileId: r.id, label: r.name }, doc, c);
          }),
      );
    };
    $("#reference-search").oninput = list;
    list();
    $("#reference-search").focus();
  } catch (e) {
    toast(e.message);
  }
}
function openPreview({ title, text, path: rel, reference, doc = current }) {
  $("#reference-drawer")?.remove();
  $("#published-drawer")?.remove();
  const n = document.createElement("aside");
  n.id = "reference-drawer";
  n.className = "reference-drawer";
  n.innerHTML = `<div class="row"><h3>${esc(title)}</h3><button id="close-drawer" class="icon-btn" title="关闭" aria-label="关闭">${I.close()}</button></div>${rel && /\.(png|jpe?g|gif|webp)$/i.test(rel) ? `<img class="preview-image" src="${esc(assetUrl("inkasset://vault/" + encodeURIComponent(rel)))}">` : ""}<pre id="reference-text">${esc(text)}</pre>${reference ? '<div class="drawer-actions"><button id="cite-file">引用文件</button><button id="cite-file-range" class="primary">引用所选文字</button><small>先选中预览文字，可引用对应行。</small></div>' : ""}`;
  document.body.append(n);
  $("#close-drawer").onclick = () => n.remove();
  if (reference) {
    $("#cite-file").onclick = () => {
      putTag(
        { kind: "file", fileId: reference.id, label: reference.name },
        doc,
      );
      n.remove();
    };
    $("#cite-file-range").onmousedown = (e) => e.preventDefault();
    $("#cite-file-range").onclick = () => {
      const selection = window.getSelection(),
        pre = $("#reference-text");
      if (!selection?.rangeCount || selection.isCollapsed)
        return toast("先在预览中选择文字");
      const range = selection.getRangeAt(0);
      if (
        !pre.contains(range.startContainer) ||
        !pre.contains(range.endContainer)
      )
        return toast("请选择这份素材中的文字");
      const before = range.cloneRange();
      before.selectNodeContents(pre);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().split("\n").length;
      const end =
        start + range.toString().replace(/\n$/, "").split("\n").length - 1;
      putTag(
        {
          kind: "file",
          fileId: reference.id,
          startLine: start,
          endLine: end,
          label: reference.name + " L" + start + "–" + end,
        },
        doc,
      );
      n.remove();
    };
  }
}
async function renderMaterials() {
  const drafts = state.documents.filter((d) => d.account === account);
  if (
    materialsFilter !== "all" &&
    !drafts.some((d) => d.id === materialsFilter)
  )
    materialsFilter = "all";
  const uploadTarget =
    materialsFilter !== "all"
      ? drafts.find((d) => d.id === materialsFilter)
      : current?.account === account
        ? current
        : drafts[0];
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">素材库</h1><span class="eyebrow">WRITING MATERIALS</span></div><div class="header-actions"><select id="material-filter" aria-label="按文章筛选素材"><option value="all">全部素材</option>${drafts.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join("")}</select><button id="upload-reference" class="primary" ${uploadTarget ? "" : "disabled"}>${I.upload()} 上传文件</button></div></header><section class="dashboard"><div id="project-files" class="material-cards"></div></section>`;
  $("#material-filter").value = materialsFilter;
  $("#material-filter").onchange = (e) => {
    materialsFilter = e.target.value;
    $("#reference-drawer")?.remove();
    $("#published-drawer")?.remove();
    if (materialsFilter !== "all")
      current = state.documents.find((d) => d.id === materialsFilter) || current;
    renderMaterials();
  };

  /** 渲染素材卡片列表 */
  const draw = (list) => {
    if (page !== "materials") return;
    const rows =
      materialsFilter === "all"
        ? list
        : list.filter((m) =>
            (m.usedBy || []).some((u) => u.id === materialsFilter),
          );
    $("#project-files").innerHTML =
      rows
        .map(
          (r) =>
            `<article class="material-card" data-material="${r.id}"><button type="button" class="card-open" data-ref-preview="${r.id}"><span class="file-icon">${esc((r.name.split(".").pop() || "").toUpperCase())}</span><strong>${esc(r.name)}</strong><small class="ref-count">被 ${r.refCount || 0} 篇文章引用</small></button></article>`,
        )
        .join("") ||
      "<p class=\"empty-data\">还没有素材。上传后可在多篇文章间共用。</p>";
    $$("[data-ref-preview]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const r = await api("materials-read", b.dataset.refPreview);
            openPreview({
              title: r.name,
              text: r.text || r.error,
              path: r.path,
              reference: r.status === "ready" ? r : null,
              doc: uploadTarget || current,
            });
          } catch (e) {
            toast(e.message);
          }
        }),
    );
    $$("[data-material]").forEach((card) => {
      card.oncontextmenu = (e) => {
        e.preventDefault();
        const id = card.dataset.material;
        const items = [
          {
            label: "删除素材",
            danger: true,
            run: async () => {
              if (!confirm("确定删除此素材？将从所有文章解除引用。")) return;
              try {
                draw(await api("materials-delete", id));
                toast("素材已删除");
              } catch (err) {
                toast(err.message);
              }
            },
          },
        ];
        if (materialsFilter !== "all" && uploadTarget) {
          items.unshift({
            label: "关联到当前筛选文章",
            run: async () => {
              try {
                await api("materials-link", {
                  articleId: uploadTarget.id,
                  id,
                });
                draw(await api("materials-list", { account }));
                toast("已关联");
              } catch (err) {
                toast(err.message);
              }
            },
          });
        }
        showContextMenu(e.clientX, e.clientY, items);
      };
    });
  };

  $("#upload-reference").onclick = async () => {
    if (!uploadTarget) return toast("请先创建一篇草稿再上传");
    const b = $("#upload-reference");
    b.disabled = true;
    b.textContent = "正在提取文字…";
    try {
      if (!(await persist())) return;
      const list = await uploadProjectFiles(uploadTarget.id);
      if (list) draw(await api("materials-list", { account }));
    } catch (e) {
      toast(e.message);
    } finally {
      if (b.isConnected) {
        b.disabled = false;
        b.innerHTML = `${I.upload()} 上传文件`;
      }
    }
  };
  try {
    draw(await api("materials-list", { account }));
  } catch (e) {
    toast(e.message);
  }
}
async function renderProfile() {
  const a = account;
  $("#main").innerHTML = '<section class="dashboard">读取账号模型…</section>';
  try {
    let model = await api("model-load", a);
    if (page !== "profile" || account !== a) return;
    const draw = () => {
      const definition = model.definitions.find((d) => d.id === profileTab);
      $("#main").innerHTML =
        `<header><div class="header-lead"><h1 class="dashboard-tagline">保持自己的声音，逐步验证有效的表达。</h1><span class="eyebrow">金奇 ${a} · 账号模型</span></div></header><section class="dashboard profile-manager"><nav class="model-tabs">${[...model.definitions, { id: "history", title: "迭代记录" }].map((d) => `<button data-model-tab="${d.id}" class="${profileTab === d.id ? "active" : ""}">${d.title}</button>`).join("")}</nav><div id="model-content">${
          definition
            ? `<h2>${definition.title}</h2><p>${{ identity: "只维护我是谁、写给谁、希望提供什么价值。", voice: "维护自然的表达偏好与必要边界，避免把每篇文章写成规则检查表。", examples: "保留我认可的真实经历和范文片段，并写清出处与为什么像我。", learning: "用有来源的数据观察指导下一次小实验；最多保留三个，过时就替换。" }[profileTab]}</p><textarea id="model-text" rows="15" maxlength="${definition.limit}">${esc(model.modules[profileTab])}</textarea><div class="row"><button id="save-model" class="primary">保存当前模块</button><small>${definition.limit} 字以内</small></div>${profileTab === "learning" ? `<p class="notice">当前账号有 ${state.metrics.filter((r) => r["账号"] === a).length} 篇归档数据。单篇波动不代表表达方式的因果效果。</p>` : ""}${
                profileTab === "examples"
                  ? `<details><summary>查看旧 Profile 资料（只读）</summary><div class="material-cards">${model.legacy
                      .filter((f) => f.editable)
                      .map(
                        (f) =>
                          `<button class="material-card" data-model-legacy="${esc(f.path)}"><strong>${esc(f.path)}</strong></button>`,
                      )
                      .join("")}</div></details>`
                  : ""
              }`
            : `<button id="iterate-model" class="primary">${I.sparkles()} 根据新文章和数据提出调整</button><p>向当前 ${esc(state.provider)} 提供本账号模型、最近 12 篇文章及 YAML；长文每篇前 3000 字。只建议替换现有模块内容。</p><div>${model.proposals.map((p) => `<div class="result-card"><small>${esc(p.at)} · ${p.status === "pending" ? "待审阅" : p.status === "applied" ? "已采纳" : "已保留原设定"}</small><p>${p.changes.map((c) => esc(model.definitions.find((d) => d.id === c.module)?.title)).join("、")}</p><button data-model-proposal="${p.id}">查看建议</button></div>`).join("") || "<p>还没有 AI 调整建议。</p>"}</div><h3>历史版本</h3>${model.history.map((h) => `<div class="result-card"><small>${esc(h.at)} · ${esc(h.reason)}</small><details><summary>查看当时的设定</summary><pre>${esc(model.definitions.map((d) => d.title + "\n" + h.modules[d.id]).join("\n\n"))}</pre></details><button data-model-restore="${h.id}">恢复此版本</button></div>`).join("")}`
        }</div></section>`;
      const save = async () => {
        if (!definition || $("#model-text").value === model.modules[profileTab])
          return true;
        try {
          model = await api("model-save", {
            account: a,
            hash: model.hash,
            modules: { ...model.modules, [profileTab]: $("#model-text").value },
          });
          toast("当前设定已保存，上一版已留存");
          return true;
        } catch (e) {
          toast(e.message);
          return false;
        }
      };
      saveProfileEditor = save;
      $$("[data-model-tab]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (!(await save())) return;
            profileTab = b.dataset.modelTab;
            draw();
          }),
      );
      if ($("#save-model")) $("#save-model").onclick = save;
      $$("[data-model-legacy]").forEach(
        (b) =>
          (b.onclick = async () => {
            const f = await api("profile-read", {
              account: a,
              path: b.dataset.modelLegacy,
            });
            openPreview({ title: f.path, text: f.text });
          }),
      );
      $$("[data-model-proposal]").forEach(
        (b) =>
          (b.onclick = () =>
            showModelProposal(
              model.proposals.find((p) => p.id === b.dataset.modelProposal),
              model,
            )),
      );
      $$("[data-model-restore]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              model = await api("model-restore", {
                account: a,
                hash: model.hash,
                id: b.dataset.modelRestore,
              });
              draw();
              toast("已恢复；恢复前的设定也已保留");
            } catch (e) {
              toast(e.message);
            }
          }),
      );
      if ($("#iterate-model"))
        $("#iterate-model").onclick = async () => {
          if (busy) return toast("请等待当前 AI 任务");
          const b = $("#iterate-model");
          busy = true;
          b.disabled = true;
          b.textContent = "正在生成调整建议…";
          try {
            if (!(await persist())) return;
            const proposal = await api("agent", {
              provider: state.provider,
              model: state.model,
              account: a,
              task: "model-iterate",
              body: "",
              instruction:
                "让表达更符合我实际写出的文章，并根据原始数据提出少量可检验的调整。",
            });
            model = await api("model-load", a);
            showModelProposal(proposal, model);
          } catch (e) {
            toast(e.message);
          } finally {
            busy = false;
            if (b.isConnected) {
              b.disabled = false;
              b.innerHTML = `${I.sparkles()} 根据新文章和数据提出调整`;
            }
          }
        };
    };
    draw();
  } catch (e) {
    toast(e.message);
  }
}
function showModelProposal(p, model) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="dialog proposal-dialog"><div class="row"><h2>调整现有账号模块</h2><button id="close-model-proposal">关闭</button></div>${p.changes
    .map(
      (c) =>
        `<h3>${esc(model.definitions.find((d) => d.id === c.module).title)}</h3><p>${esc(c.reason)}</p><small>来源：${c.sources.map(esc).join("；")}</small><details><summary>查看差异</summary><div class="diff">${diffWords(
          c.before,
          c.content,
        )
          .map(
            (x) =>
              `<${x.added ? "ins" : x.removed ? "del" : "span"}>${esc(x.value)}</${x.added ? "ins" : x.removed ? "del" : "span"}>`,
          )
          .join(
            "",
          )}</div></details><textarea data-model-edit="${c.module}" rows="8" ${p.status !== "pending" ? "readonly" : ""}>${esc(c.content)}</textarea>`,
    )
    .join(
      "",
    )}${p.status === "pending" ? '<div class="row"><button id="reject-model">保留原设定</button><button id="apply-model" class="primary">采纳修改</button></div>' : ""}</div>`;
  document.body.append(m);
  $("#close-model-proposal").onclick = () => m.remove();
  const decide = async (apply) => {
    try {
      await api("model-decide", {
        account: p.account,
        id: p.id,
        apply,
        edits: Object.fromEntries(
          $$("[data-model-edit]").map((x) => [x.dataset.modelEdit, x.value]),
        ),
      });
      m.remove();
      if (page === "profile") renderProfile();
    } catch (e) {
      toast(e.message);
    }
  };
  if ($("#apply-model")) {
    $("#apply-model").onclick = () => decide(true);
    $("#reject-model").onclick = () => decide(false);
  }
}

function renderCalendar(rows) {
  const local = new Date(),
    today = [
      local.getFullYear(),
      String(local.getMonth() + 1).padStart(2, "0"),
      String(local.getDate()).padStart(2, "0"),
    ].join("-");
  const years = [
    ...new Set([
      local.getFullYear(),
      ...rows
        .map((r) => validDate(r["日期"]))
        .filter(Boolean)
        .map((d) => +d.slice(0, 4)),
    ]),
  ].sort((a, b) => b - a);
  const c = calendar(rows, heatmapYear, today);
  const node = $("#publishing-calendar");
  if (!node) return;
  /** 生成热力格悬停提示：日期、篇数与当日文章标题 */
  const heatTip = (d) => {
    const head = `${d.date}${d.date === today ? " · 今天" : ""} · ${d.count} 篇${d.future ? "（未来日期）" : ""}`;
    return d.titles.length ? head + "\n" + d.titles.join("\n") : head;
  };
  const summary = publishSummary(rows, today);
  const summaryText = summary
    ? `您已写作 ${summary.writingDays} 天，共发布 ${summary.published} 篇，平均 ${summary.avgDays} 天发布一篇，上一次更新是在 ${summary.daysSinceLast} 天前`
    : "暂无有效发布记录";
  node.innerHTML = `<div class="row"><h3>发布热力图</h3><select id="heatmap-year" aria-label="热力图年份">${years.map((y) => `<option ${y === heatmapYear ? "selected" : ""}>${y}</option>`).join("")}</select></div><p>${summaryText}</p><div class="heatmap-scroll"><div class="heatmap-grid" role="group" aria-label="每日发布数量">${"<span></span>".repeat(c.offset)}${c.days.map((d) => `<button class="heatmap-day level-${Math.min(d.count, 4)} ${d.future ? "future" : ""} ${d.date === today ? "is-today" : ""}" ${d.date === today ? 'aria-current="date"' : ""} data-heat-date="${d.date}" title="${esc(heatTip(d))}" aria-label="${esc(heatTip(d).replace(/\n/g, "，"))}"></button>`).join("")}</div></div>`;
  $("#heatmap-year").onchange = (e) => {
    heatmapYear = +e.target.value;
    renderCalendar(rows);
  };
}
window.addEventListener("beforeunload", () => {
  sync();
  if (dirty) window.desk.flush(state);
});
state = await api("load");
current = state.documents.find((d) => d.account === account);
render();
