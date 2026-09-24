// Canvas is both the preview and export surface: no screenshot/layout mismatch.
// 小红书设计稿基准 768×1024（3:4），画布放大到 1200×1600 导出。

const BLUE = "#0f3ff7";
const BLUE_SOFT = "rgba(15, 63, 247, 0.2)";
const BLACK = "#111111";
const WHITE = "#ffffff";
const SERIF = '"寒蝉锦书宋Compact", "Songti SC", "Noto Serif SC", serif';
const SANS = '"OPPO Sans 4.0", "PingFang SC", "Helvetica Neue", sans-serif';

/** 设计稿宽度 → 画布缩放比（导出 1200 宽） */
const DESIGN_W = 768;
const CANVAS_W = 1200;
const SCALE = CANVAS_W / DESIGN_W;

/**
 * 小红书在 768 版心下的字号 / 行距 / 字距。
 * 绘制时一律 × SCALE。
 */
const T = {
  padX: 40,
  padY: 40,
  /** 正文 24 / 行高 1.7 / 段后 20 / 字距 0.5 */
  body: 24,
  bodyLine: 24 * 1.7,
  bodyAfter: 20,
  bodyTracking: 0.5,
  /** 一级标题 64 / 行高 72 / 序号 96 / 色块 112 */
  h1: 64,
  h1Line: 72,
  h1Num: 96,
  h1Badge: 112,
  h1Gap: 16,
  h1Tracking: 1.5,
  h1MarginTop: 48,
  h1MarginTopAtPageStart: 8,
  h1MarginBottom: 24,
  /** 二级标题 36 / 行高 1.25 / 字距 1 */
  h2: 36,
  h2Line: 36 * 1.25,
  h2PadX: 12,
  h2PadY: 10,
  h2Tracking: 1,
  h2MarginTop: 20,
  h2MarginBottom: 16,
  h3: 28,
  h3Line: 28 * 1.35,
  h3MarginTop: 24,
  h3MarginBottom: 14,
  h3Tracking: 0.8,
  quote: 24,
  quoteLine: 24 * 1.7,
  quoteMark: 36,
  quotePad: 12,
  quoteGap: 10,
  quoteMarkW: 28,
  quoteMargin: 24,
  continueY: 56,
};

/**
 * 设计稿尺寸 → 画布像素。
 * @param {number} n
 */
function S(n) {
  return n * SCALE;
}

/**
 * 拆分「中文 + 英文」一级标题。
 * @param {string} raw
 * @returns {{ zh: string, en: string }}
 */
function splitTitle(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const m = text.match(
    /^([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef0-9A-Za-z\s\u2014\u2013\-·、，。！？：；“”‘’（）【】《》]+?)\s+([A-Za-z][A-Za-z0-9&/.,'’\- ]{1,60})$/,
  );
  if (!m) return { zh: text, en: "" };
  return { zh: m[1].trim(), en: m[2].trim() };
}

/**
 * 按中文字符换行（可计入字距）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 * @param {number} [tracking=0] 字距（画布像素）
 * @returns {string[]}
 */
function wrapLines(ctx, text, maxW, tracking = 0) {
  const lines = [];
  for (const para of String(text || "").split(/\n/)) {
    let line = "";
    let lineW = 0;
    for (const ch of Array.from(para)) {
      const w = ctx.measureText(ch).width + (line ? tracking : 0);
      if (line && lineW + w > maxW) {
        lines.push(line);
        line = ch;
        lineW = ctx.measureText(ch).width;
      } else {
        line += ch;
        lineW += w;
      }
    }
    if (line || !para) lines.push(line);
  }
  return lines.length ? lines : [""];
}

/**
 * 按字距逐字绘制一行文字。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} [tracking=0]
 * @returns {number} 绘制后的右边界 x
 */
function fillTracked(ctx, text, x, y, tracking = 0) {
  let cx = x;
  for (const ch of Array.from(text)) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  return cx;
}

/**
 * 测量带字距的文本宽度。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} [tracking=0]
 */
function measureTracked(ctx, text, tracking = 0) {
  const chars = Array.from(text);
  if (!chars.length) return 0;
  let w = 0;
  for (const ch of chars) w += ctx.measureText(ch).width;
  return w + Math.max(0, chars.length - 1) * tracking;
}

/**
 * 从块级节点提取纯文本，将 BR 转为换行（同一标题内的软换行）。
 * @param {Node} node
 * @returns {string}
 */
function blockPlainText(node) {
  let out = "";
  /**
   * @param {Node} n
   */
  function walk(n) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeName === "BR") out += "\n";
    else if (n.childNodes?.length)
      for (const c of n.childNodes) walk(c);
  }
  walk(node);
  return out
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 规范化标题文本：保留软换行，仅折叠同行空白。
 * @param {string} raw
 * @returns {string[]}
 */
function headingSoftLines(raw) {
  return String(raw || "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * 收集节点内文本 runs（含加粗）。
 * @param {Node} node
 * @param {boolean} [bold]
 * @returns {{ text: string, bold: boolean }[]}
 */
function collectRuns(node, bold = false) {
  const runs = [];
  function walk(n, b) {
    if (n.nodeType === 3) runs.push({ text: n.textContent, bold: b });
    else if (n.nodeName === "BR") runs.push({ text: "\n", bold: b });
    else
      for (const c of n.childNodes)
        walk(c, b || ["STRONG", "B"].includes(n.nodeName));
  }
  walk(node, bold);
  return runs;
}

/**
 * 按小红书 768 规格生成竖版分页。
 * 字号：H1 文字 64 / 序号 96，H2 36，正文 24；一级标题左文右号。
 * @param {string} html 正文 HTML
 * @param {string} [_title] 保留参数（导出文件名用），首屏不绘制标题
 */
export async function socialPages(html, _title) {
  await document.fonts.ready;
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const pages = [];
  let ctx;
  let y;
  let h1Index = 0;
  const W = CANVAS_W;
  const H = Math.round(1024 * SCALE);
  const pad = S(T.padX);
  const contentW = W - pad * 2;
  const bottom = H - S(T.padY);
  const bodySize = S(T.body);
  const bodyLine = S(T.bodyLine);
  const bodyTracking = S(T.bodyTracking);
  const h1Size = S(T.h1);
  const h1Line = S(T.h1Line);
  const h1Tracking = S(T.h1Tracking);
  const numSize = S(T.h1Num);
  const badge = S(T.h1Badge);
  const h1Gap = S(T.h1Gap);
  const h2Size = S(T.h2);
  const h2Line = S(T.h2Line);
  const h2Tracking = S(T.h2Tracking);
  const quoteMarkSize = S(T.quoteMark);
  const continueY = S(T.continueY);

  /**
   * 设置画笔字体。
   * @param {string} family
   * @param {number} weight
   * @param {number} px
   */
  function font(family, weight, px) {
    ctx.font = `${weight} ${px}px ${family}`;
  }

  /** 新建一页（不画页码；序号只出现在一级标题右侧） */
  function page() {
    if (pages.length >= 17)
      throw Error(
        "内容超过 17 张，请精简正文后重试。未导出截断内容。",
      );
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext("2d");
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "top";
    pages.push(canvas);
    y = pad;
  }

  /**
   * 确保剩余高度足够，否则翻页。
   * @param {number} need
   */
  function ensure(need) {
    if (y + need > bottom) {
      page();
      y = continueY;
    }
  }

  /**
   * 绘制一级标题：左文字、右序号方块，底对齐。
   * 识别同一标题内 Shift+Enter 软换行；页首缩小顶距。
   * @param {string|Node} rawOrNode
   */
  function drawH1(rawOrNode) {
    const raw =
      typeof rawOrNode === "string"
        ? rawOrNode
        : blockPlainText(/** @type {Node} */ (rawOrNode));
    const soft = headingSoftLines(raw);
    /** @type {string[]} */
    let seed;
    if (soft.length > 1) seed = soft;
    else {
      const { zh, en } = splitTitle(soft[0] || "");
      seed = en ? [zh, en] : [zh];
    }
    const num = String(++h1Index).padStart(2, "0");
    const textW = contentW - badge - h1Gap;
    font(SERIF, 800, h1Size);
    const lines = seed.flatMap((para) =>
      wrapLines(ctx, para, textW, h1Tracking),
    );
    const textH = Math.max(badge, lines.length * h1Line);
    const startTop = S(T.h1MarginTopAtPageStart);
    const midTop = S(T.h1MarginTop);
    const after = S(T.h1MarginBottom);
    if (y > continueY + 1 && y + midTop + textH + after > bottom) {
      page();
      y = continueY;
    }
    const top = y <= continueY + 1 ? startTop : midTop;
    ensure(top + textH + after);
    y += y <= continueY + 1 ? startTop : top;

    let ty = y + textH - lines.length * h1Line;
    ctx.fillStyle = BLUE;
    font(SERIF, 800, h1Size);
    for (const line of lines) {
      fillTracked(ctx, line, pad, ty, h1Tracking);
      ty += h1Line;
    }

    const bx = pad + contentW - badge;
    const by = y + textH - badge;
    ctx.fillStyle = BLUE_SOFT;
    ctx.fillRect(bx, by, badge, badge);
    font(SERIF, 800, numSize);
    ctx.fillStyle = BLUE;
    const nw = ctx.measureText(num).width;
    ctx.fillText(num, bx + (badge - nw) / 2, by + (badge - numSize) / 2);

    y += textH + after;
  }

  /**
   * 绘制二级标题（蓝底白字条）；识别同一标题内软换行。
   * @param {string|Node} rawOrNode
   */
  function drawH2(rawOrNode) {
    const raw =
      typeof rawOrNode === "string"
        ? rawOrNode
        : blockPlainText(/** @type {Node} */ (rawOrNode));
    const soft = headingSoftLines(raw);
    if (!soft.length) return;
    const padX = S(T.h2PadX);
    const padY = S(T.h2PadY);
    font(SERIF, 800, h2Size);
    const maxInner = contentW - padX * 2;
    const lines = soft.flatMap((para) =>
      wrapLines(ctx, para, maxInner, h2Tracking),
    );
    const innerW = Math.min(
      maxInner,
      Math.ceil(
        Math.max(...lines.map((l) => measureTracked(ctx, l, h2Tracking)), 1),
      ),
    );
    const barW = Math.min(contentW, innerW + padX * 2);
    const barH = lines.length * h2Line + padY * 2;
    ensure(S(T.h2MarginTop) + barH + S(T.h2MarginBottom));
    y += S(T.h2MarginTop);
    ctx.fillStyle = BLUE;
    ctx.fillRect(pad, y, barW, barH);
    ctx.fillStyle = WHITE;
    font(SERIF, 800, h2Size);
    let ty = y + padY;
    for (const l of lines) {
      fillTracked(ctx, l, pad + padX, ty, h2Tracking);
      ty += h2Line;
    }
    y += barH + S(T.h2MarginBottom);
  }

  /**
   * 绘制正文 runs（OPPO Sans；加粗 semibold 黑色）。
   * @param {{ text: string, bold: boolean }[]} runs
   * @param {{ color?: string, family?: string, weight?: number, size?: number, line?: number, after?: number, tracking?: number }} [opt]
   */
  function drawText(runs, opt = {}) {
    const n = opt.size ?? bodySize;
    const line = opt.line ?? bodyLine;
    const family = opt.family ?? SANS;
    const color = opt.color ?? BLACK;
    const baseWeight = opt.weight ?? 400;
    const tracking = opt.tracking ?? bodyTracking;
    let x = pad;
    ensure(line);
    for (const run of runs) {
      for (const ch of Array.from(run.text)) {
        const weight = run.bold ? 600 : baseWeight;
        font(family, weight, n);
        const width = ctx.measureText(ch).width + tracking;
        if (ch === "\n" || x + width > pad + contentW) {
          x = pad;
          y += line;
          ensure(line);
          font(family, weight, n);
        }
        if (ch === "\n") continue;
        ctx.fillStyle = color;
        ctx.fillText(ch, x, y);
        x += width;
      }
    }
    y += line + (opt.after ?? S(T.bodyAfter));
  }

  /**
   * 绘制引用块（浅蓝底 + 引号 + 蓝宋体正文）。
   * @param {Element} node
   */
  function drawQuote(node) {
    const runs = collectRuns(node).filter((r) => r.text.trim() || r.text === "\n");
    if (!runs.some((r) => r.text.trim())) return;
    const plain = runs
      .map((r) => r.text)
      .join("")
      .replace(/\n+/g, " ")
      .trim();
    const qPad = S(T.quotePad);
    const markW = S(T.quoteMarkW);
    const gap = S(T.quoteGap);
    const qSize = S(T.quote);
    const qLine = S(T.quoteLine);
    const textMax = contentW - qPad * 2 - markW - gap;
    font(SERIF, 800, qSize);
    const lines = wrapLines(ctx, plain, textMax, bodyTracking);
    const boxH = Math.max(
      quoteMarkSize + qPad * 2,
      lines.length * qLine + qPad * 2,
    );
    ensure(S(T.quoteMargin) + boxH + S(T.quoteMargin));
    y += S(T.quoteMargin);
    ctx.fillStyle = BLUE_SOFT;
    ctx.fillRect(pad, y, contentW, boxH);
    ctx.fillStyle = BLUE;
    font(SERIF, 800, quoteMarkSize);
    ctx.fillText("“", pad + qPad, y + qPad);
    font(SERIF, 800, qSize);
    let ty = y + qPad + S(4);
    const tx0 = pad + qPad + markW + gap;
    for (const line of lines) {
      fillTracked(ctx, line, tx0, ty, bodyTracking);
      ty += qLine;
    }
    y += boxH + S(T.quoteMargin);
  }

  /**
   * 绘制图片，超高则翻页。
   * @param {string} src
   */
  async function picture(src) {
    if (!src) return;
    let objectUrl;
    try {
      let blob;
      if (/^(inkasset:|\/api\/asset\/|https?:|data:|blob:)/i.test(src)) {
        const res = await fetch(src, { mode: "cors" });
        if (!res.ok) throw Error("图片加载失败 HTTP " + res.status);
        blob = await res.blob();
      } else {
        const res = await fetch(src);
        if (!res.ok) throw Error("图片加载失败");
        blob = await res.blob();
      }
      objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.src = objectUrl;
      await Promise.race([
        img.decode(),
        new Promise((_, r) => setTimeout(() => r(Error("图片加载超时")), 12000)),
      ]);
      const scale = Math.min(
        contentW / img.naturalWidth,
        S(620) / img.naturalHeight,
      );
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const border = S(2);
      const after = S(24);
      ensure(h + after);
      const x = pad + (contentW - w) / 2;
      ctx.drawImage(img, x, y, w, h);
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = border;
      ctx.strokeRect(
        x + border / 2,
        y + border / 2,
        w - border,
        h - border,
      );
      y += h + after;
    } catch (e) {
      const msg = "［图片未加载］";
      font(SANS, 400, S(14));
      ensure(S(40));
      ctx.fillStyle = "#999";
      ctx.fillText(msg, pad, y + S(20));
      y += S(40);
      console.warn("social picture:", src, e);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  /**
   * 递归绘制块级节点。
   * @param {Node} node
   */
  async function block(node) {
    if (node.nodeName === "IMG") {
      await picture(node.getAttribute("src"));
      return;
    }
    if (node.nodeName === "HR") {
      if (y > continueY) page();
      return;
    }
    if (node.nodeName === "BLOCKQUOTE") {
      drawQuote(node);
      return;
    }
    if (node.querySelector?.("img")) {
      for (const child of node.childNodes) await block(child);
      return;
    }
    if (["UL", "OL", "TABLE", "TBODY", "THEAD"].includes(node.nodeName)) {
      for (const child of node.children) await block(child);
      return;
    }
    if (node.nodeName === "H1") {
      drawH1(node);
      return;
    }
    if (node.nodeName === "H2") {
      drawH2(node);
      return;
    }
    if (/^H[3-6]$/.test(node.nodeName)) {
      drawText(collectRuns(node), {
        family: SERIF,
        weight: 800,
        size: S(T.h3),
        line: S(T.h3Line),
        tracking: S(T.h3Tracking),
        color: BLUE,
        after: S(T.h3MarginBottom),
      });
      return;
    }
    const runs = collectRuns(node);
    if (!runs.some((r) => r.text.trim())) return;
    if (node.nodeName === "LI") runs.unshift({ text: "• ", bold: false });
    drawText(runs, { line: bodyLine, after: S(T.bodyAfter) });
  }

  page();
  for (const node of root.childNodes) await block(node);
  for (const c of pages) c.toDataURL("image/png");
  return pages;
}

/**
 * 打开小红书分页灯箱：默认适应屏幕，可切换完整尺寸；支持左右翻页。
 * @param {HTMLCanvasElement[]} canvases 全部页画布
 * @param {number} startIndex 从 0 起
 */
function openSocialLightbox(canvases, startIndex) {
  if (!canvases?.length) return;
  document.getElementById("social-lightbox")?.remove();

  let index = Math.max(0, Math.min(startIndex, canvases.length - 1));
  /** @type {"fit"|"full"} */
  let mode = "fit";
  const total = canvases.length;

  const modal = document.createElement("div");
  modal.id = "social-lightbox";
  modal.className = "modal social-lightbox is-fit";
  modal.innerHTML = `<div class="social-lightbox-stage"><button type="button" class="social-lightbox-nav" data-prev aria-label="上一页">‹</button><div class="social-lightbox-body"><img alt="" draggable="false"></div><button type="button" class="social-lightbox-nav" data-next aria-label="下一页">›</button></div><div class="social-lightbox-bar" role="toolbar" aria-label="预览工具"><button type="button" data-prev>上一页</button><span class="social-lightbox-count"></span><button type="button" data-next>下一页</button><button type="button" data-zoom>完整大小</button><button type="button" data-close>关闭</button></div>`;

  const img = modal.querySelector("img");
  const countEl = modal.querySelector(".social-lightbox-count");
  const zoomBtn = modal.querySelector("[data-zoom]");
  const prevBtns = modal.querySelectorAll("[data-prev]");
  const nextBtns = modal.querySelectorAll("[data-next]");

  /** 根据当前页与模式刷新图片与工具栏 */
  function render() {
    const canvas = canvases[index];
    img.alt = `第 ${index + 1} 页`;
    img.src = canvas.toDataURL("image/png");
    img.width = canvas.width;
    img.height = canvas.height;
    countEl.textContent = `${index + 1} / ${total}`;
    modal.classList.toggle("is-fit", mode === "fit");
    modal.classList.toggle("is-full", mode === "full");
    zoomBtn.textContent = mode === "fit" ? "完整大小" : "适应屏幕";
    img.title = mode === "fit" ? "点击查看完整大小" : "点击适应屏幕";
    if (mode === "full") {
      img.style.width = `${canvas.width}px`;
      img.style.height = `${canvas.height}px`;
    } else {
      img.style.width = "";
      img.style.height = "";
    }
    const atStart = index <= 0;
    const atEnd = index >= total - 1;
    prevBtns.forEach((b) => {
      b.disabled = atStart;
    });
    nextBtns.forEach((b) => {
      b.disabled = atEnd;
    });
    if (mode === "full")
      requestAnimationFrame(() => {
        modal.scrollTop = Math.max(0, (modal.scrollHeight - modal.clientHeight) / 2);
        modal.scrollLeft = Math.max(0, (modal.scrollWidth - modal.clientWidth) / 2);
      });
  }

  /** 关闭灯箱并移除键盘监听 */
  function close() {
    window.removeEventListener("keydown", onKey);
    modal.remove();
  }

  /**
   * 切换到指定页。
   * @param {number} i
   */
  function go(i) {
    if (i < 0 || i >= total) return;
    index = i;
    render();
  }

  /** 切换适应屏幕 / 完整大小 */
  function toggleZoom() {
    mode = mode === "fit" ? "full" : "fit";
    render();
  }

  /**
   * 键盘：Esc 关闭，左右翻页，空格切换缩放。
   * @param {KeyboardEvent} e
   */
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === " " || e.key === "Enter") {
      if (e.target === img || e.target === modal) {
        e.preventDefault();
        toggleZoom();
      }
    }
  }

  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t === modal || t.closest("[data-close]")) {
      close();
      return;
    }
    if (t.closest("[data-prev]")) {
      go(index - 1);
      return;
    }
    if (t.closest("[data-next]")) {
      go(index + 1);
      return;
    }
    if (t.closest("[data-zoom]")) {
      toggleZoom();
      return;
    }
    if (t === img) toggleZoom();
  });

  window.addEventListener("keydown", onKey);
  document.body.append(modal);
  render();
}

/**
 * 渲染小红书分页预览，并绑定导出与点击大图预览。
 * @param {ParentNode} root 含 #social-pages / #social-export / #social-status 的祖先
 * @param {{html:string,title:string,api:Function,web:boolean}} opts 排版内容与导出通道
 * @returns {{destroy:Function}} 离开预览时取消进行中的排版
 */
export function bindSocialPreview(root, { html, title, api, web }) {
  const q = (s) => root.querySelector(s);
  let pages = [];
  let generation = 0;

  /** 按小红书 768 规格重绘全部竖版页 */
  async function draw() {
    const g = ++generation;
    const exportBtn = q("#social-export");
    const status = q("#social-status");
    const list = q("#social-pages");
    if (!exportBtn || !status || !list) return;
    exportBtn.disabled = true;
    status.textContent = "正在排版…";
    list.replaceChildren();
    try {
      const next = await socialPages(html, title);
      if (g !== generation) return;
      pages = next;
      for (const [i, c] of pages.entries()) {
        const figure = document.createElement("figure");
        figure.className = "social-page";
        figure.title = "点击预览";
        figure.tabIndex = 0;
        figure.setAttribute("role", "button");
        figure.setAttribute("aria-label", `第 ${i + 1} 页，点击预览`);
        const label = document.createElement("figcaption");
        label.textContent = `${i + 1} / ${pages.length}`;
        /**
         * 打开分页灯箱。
         * @param {Event} e
         */
        function open(e) {
          e.preventDefault();
          openSocialLightbox(pages, i);
        }
        figure.addEventListener("click", open);
        figure.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") open(e);
        });
        figure.append(c, label);
        list.append(figure);
      }
      status.textContent = `共 ${pages.length} 张`;
      exportBtn.disabled = false;
    } catch (e) {
      if (g === generation) status.textContent = "排版失败：" + e.message;
    }
  }

  const exportBtn = q("#social-export");
  if (exportBtn)
    exportBtn.onclick = async () => {
      const b = q("#social-export");
      const status = q("#social-status");
      if (!b || !status) return;
      b.disabled = true;
      try {
        const images = pages.map((c) => c.toDataURL("image/png"));
        if (web) {
          for (const [i, url] of images.entries()) {
            const a = document.createElement("a");
            a.href = url;
            a.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}-${String(i + 1).padStart(2, "0")}.png`;
            a.click();
          }
          status.textContent = "已提交浏览器下载，请允许下载多个文件";
        } else {
          const result = await api("export-social", { title, images });
          status.textContent = result
            ? `已导出 ${images.length} 张到 ${result}`
            : "已取消导出";
        }
      } catch (e) {
        status.textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
  draw();
  return {
    destroy() {
      generation++;
      document.getElementById("social-lightbox")?.remove();
    },
  };
}
