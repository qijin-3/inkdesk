// Canvas is both the preview and export surface: no screenshot/layout mismatch.
// 设计稿基准 768×1024（3:4），画布 1200×1600，比例一致。

const BLUE = "#0f3ff7";
const BLUE_SOFT = "rgba(15, 63, 247, 0.2)";
const BLACK = "#111111";
const WHITE = "#ffffff";
const SERIF = '"寒蝉锦书宋Compact", "Songti SC", "Noto Serif SC", serif';
const SANS = '"OPPO Sans 4.0", "PingFang SC", "Helvetica Neue", sans-serif';

/** 设计稿宽度 → 画布缩放比 */
const DESIGN_W = 768;
const CANVAS_W = 1200;
const SCALE = CANVAS_W / DESIGN_W;

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
 * 按设计稿比例生成小红书竖版分页。
 * @param {string} html 正文 HTML
 * @param {string} title 文章标题
 * @param {number} [size=36] 正文字号（设计稿 24px × 1.5625 ≈ 36）
 */
export async function socialPages(html, title, size = 36) {
  await document.fonts.ready;
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const pages = [];
  let ctx;
  let y;
  const W = CANVAS_W;
  const H = Math.round(1024 * SCALE);
  const pad = Math.round(40 * SCALE);
  const contentW = W - pad * 2;
  const bottom = H - pad;
  const bodySize = size;
  const h1Size = Math.round(bodySize * (60 / 24));
  const h1Line = Math.round(bodySize * (72 / 24));
  const numSize = Math.round(96 * SCALE);
  const badge = Math.round(112 * SCALE);
  const h2Size = Math.round(bodySize * (36 / 24));
  const h2BarH = Math.round(bodySize * (56 / 24));
  const quoteMarkSize = Math.round(bodySize * (36 / 24));
  const bodyLine = bodySize * 1.7;
  const continueY = Math.round(180 * SCALE);

  /**
   * 设置画笔字体。
   * @param {string} family
   * @param {number} weight
   * @param {number} px
   */
  function font(family, weight, px) {
    ctx.font = `${weight} ${px}px ${family}`;
  }

  /** 绘制当前页右上角页码（设计稿 03 + 20% 蓝底方块） */
  function drawPageNumber() {
    const i = pages.length;
    const num = String(i).padStart(2, "0");
    const bgX = Math.round(607 * SCALE);
    const bgY = Math.round(67 * SCALE);
    const numX = Math.round(619 * SCALE);
    const numY = Math.round(52 * SCALE);
    ctx.fillStyle = BLUE_SOFT;
    ctx.fillRect(bgX, bgY, badge, badge);
    font(SERIF, 800, numSize);
    ctx.fillStyle = BLUE;
    ctx.textBaseline = "top";
    ctx.fillText(num, numX, numY);
  }

  /** 新建一页并画页码 */
  function page() {
    if (pages.length >= 17)
      throw Error(
        "内容超过 17 张，请缩小字号或精简正文后重试。未导出截断内容。",
      );
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext("2d");
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "top";
    pages.push(canvas);
    drawPageNumber();
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
   * 绘制一级标题（蓝宋体，可中英双行）。
   * @param {string} raw
   */
  function drawH1(raw) {
    const { zh, en } = splitTitle(raw);
    const lines = en ? [zh, en] : [zh];
    const blockH = lines.length * h1Line + Math.round(24 * SCALE);
    ensure(blockH);
    font(SERIF, 800, h1Size);
    ctx.fillStyle = BLUE;
    for (const line of lines) {
      let x = pad;
      for (const ch of Array.from(line)) {
        const w = ctx.measureText(ch).width;
        if (x + w > pad + contentW - badge) {
          x = pad;
          y += h1Line;
          ensure(h1Line);
          font(SERIF, 800, h1Size);
          ctx.fillStyle = BLUE;
        }
        ctx.fillText(ch, x, y);
        x += w;
      }
      y += h1Line;
    }
    y += Math.round(24 * SCALE);
  }

  /**
   * 绘制二级标题（蓝底白字条，宽度随内容，过长则换行加高）。
   * @param {string} raw
   */
  function drawH2(raw) {
    const text = String(raw || "").trim();
    if (!text) return;
    font(SERIF, 800, h2Size);
    const padX = Math.round(8 * SCALE);
    const padY = Math.round(10 * SCALE);
    const maxTextW = contentW - padX * 2;
    const lines = [];
    let line = "";
    let lineW = 0;
    for (const ch of Array.from(text)) {
      const w = ctx.measureText(ch).width;
      if (lineW + w > maxTextW && line) {
        lines.push(line);
        line = ch;
        lineW = w;
      } else {
        line += ch;
        lineW += w;
      }
    }
    if (line) lines.push(line);
    const textBlockH = lines.length * h2Size * 1.2;
    const barH = Math.max(h2BarH, textBlockH + padY * 2);
    const longest = Math.max(
      ...lines.map((l) =>
        Array.from(l).reduce((s, ch) => s + ctx.measureText(ch).width, 0),
      ),
    );
    const barW = Math.min(contentW, longest + padX * 2);
    ensure(barH + Math.round(28 * SCALE));
    y += Math.round(12 * SCALE);
    ctx.fillStyle = BLUE;
    ctx.fillRect(pad, y, barW, barH);
    ctx.fillStyle = WHITE;
    font(SERIF, 800, h2Size);
    let ty = y + (barH - textBlockH) / 2;
    for (const l of lines) {
      let x = pad + padX;
      for (const ch of Array.from(l)) {
        ctx.fillText(ch, x, ty);
        x += ctx.measureText(ch).width;
      }
      ty += h2Size * 1.2;
    }
    y += barH + Math.round(18 * SCALE);
  }

  /**
   * 绘制正文 runs（OPPO Sans；加粗为 semibold 黑色）。
   * @param {{ text: string, bold: boolean }[]} runs
   * @param {{ color?: string, family?: string, weight?: number, size?: number, line?: number, after?: number }} [opt]
   */
  function drawText(runs, opt = {}) {
    const n = opt.size ?? bodySize;
    const line = opt.line ?? n * 1.7;
    const family = opt.family ?? SANS;
    const color = opt.color ?? BLACK;
    const baseWeight = opt.weight ?? 400;
    let x = pad;
    ensure(line);
    for (const run of runs) {
      for (const ch of Array.from(run.text)) {
        const weight = run.bold ? 600 : baseWeight;
        font(family, weight, n);
        const width = ctx.measureText(ch).width;
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
    y += line + (opt.after ?? Math.round(16 * SCALE));
  }

  /**
   * 绘制引用块（20% 蓝底 + OPPO 引号 + 蓝宋体正文）。
   * @param {Element} node
   */
  function drawQuote(node) {
    const runs = collectRuns(node).filter((r) => r.text.trim() || r.text === "\n");
    if (!runs.some((r) => r.text.trim())) return;
    const plain = runs.map((r) => r.text).join("");
    font(SERIF, 800, bodySize);
    const line = bodySize * 1.7;
    const markW = Math.round(28 * SCALE);
    const innerPad = Math.round(16 * SCALE);
    const textMax = contentW - markW - innerPad * 2;
    let lines = 1;
    let x = 0;
    for (const ch of Array.from(plain.replace(/\n+/g, " ").trim())) {
      const w = ctx.measureText(ch).width;
      if (x + w > textMax) {
        lines++;
        x = w;
      } else x += w;
    }
    const boxH = Math.max(
      Math.round(96 * SCALE),
      innerPad * 2 + quoteMarkSize * 0.3 + lines * line,
    );
    ensure(boxH + Math.round(24 * SCALE));
    y += Math.round(8 * SCALE);
    ctx.fillStyle = BLUE_SOFT;
    ctx.fillRect(pad, y, contentW, boxH);
    font(SANS, 700, quoteMarkSize);
    ctx.fillStyle = BLUE;
    ctx.fillText("“", pad + Math.round(16 * SCALE), y + innerPad);
    let tx = pad + markW + Math.round(8 * SCALE);
    let ty = y + innerPad + Math.round(4 * SCALE);
    font(SERIF, 800, bodySize);
    for (const ch of Array.from(plain.replace(/\n+/g, " ").trim())) {
      const w = ctx.measureText(ch).width;
      if (tx + w > pad + contentW - innerPad) {
        tx = pad + markW + Math.round(8 * SCALE);
        ty += line;
      }
      ctx.fillStyle = BLUE;
      ctx.fillText(ch, tx, ty);
      tx += w;
    }
    y += boxH + Math.round(20 * SCALE);
  }

  /** 绘制图片，超高则翻页 */
  async function picture(src) {
    const img = new Image();
    if (/^https?:/.test(src)) img.crossOrigin = "anonymous";
    img.src = src;
    await Promise.race([
      img.decode(),
      new Promise((_, r) => setTimeout(() => r(Error("图片加载超时")), 12000)),
    ]);
    const scale = Math.min(
      contentW / img.naturalWidth,
      Math.round(620 * SCALE) / img.naturalHeight,
    );
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ensure(h + 26);
    ctx.drawImage(img, pad + (contentW - w) / 2, y, w, h);
    y += h + 26;
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
      drawH1(node.textContent);
      return;
    }
    if (node.nodeName === "H2") {
      drawH2(node.textContent);
      return;
    }
    if (/^H[3-6]$/.test(node.nodeName)) {
      drawText(collectRuns(node), {
        family: SERIF,
        weight: 800,
        size: Math.round(bodySize * 1.15),
        color: BLUE,
        after: Math.round(14 * SCALE),
      });
      return;
    }
    const runs = collectRuns(node);
    if (!runs.some((r) => r.text.trim())) return;
    if (node.nodeName === "LI") runs.unshift({ text: "• ", bold: false });
    drawText(runs, { line: bodyLine, after: Math.round(14 * SCALE) });
  }

  page();
  if (title) {
    y = Math.round(43 * SCALE);
    drawH1(title);
    y = Math.max(y, Math.round(200 * SCALE));
  } else {
    y = Math.round(200 * SCALE);
  }
  for (const node of root.childNodes) await block(node);
  for (const c of pages) c.toDataURL("image/png");
  return pages;
}

/**
 * 在右侧栏容器内渲染小红书分页预览，并绑定字号切换与导出图片。
 * @param {ParentNode} root 含 #social-pages / #social-size / #social-export / #social-status 的根节点
 * @param {{html:string,title:string,api:Function,web:boolean}} opts 排版内容与导出通道
 * @returns {{destroy:Function}} 离开预览时取消进行中的排版
 */
export function bindSocialPreview(root, { html, title, api, web }) {
  const q = (s) => root.querySelector(s);
  let pages = [];
  let generation = 0;

  /** 按当前字号重绘全部竖版页 */
  async function draw() {
    const g = ++generation;
    const exportBtn = q("#social-export");
    const status = q("#social-status");
    const list = q("#social-pages");
    exportBtn.disabled = true;
    status.textContent = "正在排版…";
    list.replaceChildren();
    try {
      const next = await socialPages(html, title, +q("#social-size").value);
      if (g !== generation) return;
      pages = next;
      for (const [i, c] of pages.entries()) {
        const figure = document.createElement("figure");
        const label = document.createElement("figcaption");
        label.textContent = `${i + 1} / ${pages.length}`;
        figure.append(c, label);
        list.append(figure);
      }
      status.textContent = `共 ${pages.length} 张`;
      exportBtn.disabled = false;
    } catch (e) {
      if (g === generation) status.textContent = "排版失败：" + e.message;
    }
  }

  q("#social-size").onchange = draw;
  q("#social-export").onclick = async () => {
    const b = q("#social-export");
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
        q("#social-status").textContent =
          "已提交浏览器下载，请允许下载多个文件";
      } else {
        const result = await api("export-social", { title, images });
        q("#social-status").textContent = result
          ? `已导出 ${images.length} 张到 ${result}`
          : "已取消导出";
      }
    } catch (e) {
      q("#social-status").textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  draw();
  return {
    destroy() {
      generation++;
    },
  };
}
