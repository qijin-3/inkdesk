// @extracted from renderer.js 1152-1341 — 后续改为 export 函数后由 renderer import
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
 * 画一级标题图（蓝字 + 序号方块）；保留标题内软换行。
 * @param {string} raw
 * @param {string} num
 */
function renderWechatH1Png(raw, num) {
  const soft = normalizeHeadingText(raw).split("\n").filter(Boolean);
  const badge = 48;
  const gap = 10;
  const textW = WECHAT_BLOCK_W - badge - gap;
  const fontSize = 40;
  const lineH = 44;
  const measure = wechatBlockCanvas(1, 1).ctx;
  measure.font = `800 ${fontSize}px ${WECHAT_SERIF}`;

  /** @type {string[]} */
  let lines = [];
  if (soft.length > 1) {
    lines = soft.flatMap((para) => wechatWrapLines(measure, para, textW));
  } else {
    const one = soft[0] || "";
    const m = one.match(
      /^([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef0-9A-Za-z\s\u2014\u2013\-·、，。！？：；“”‘’（）【】《》]+?)\s+([A-Za-z][A-Za-z0-9&/.,'’\- ]{1,60})$/,
    );
    const zh = m ? m[1].trim() : one;
    const en = m ? m[2].trim() : "";
    lines = [
      ...wechatWrapLines(measure, zh, textW),
      ...(en ? wechatWrapLines(measure, en, textW) : []),
    ];
  }

  const textH = Math.max(badge, lines.length * lineH);
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, textH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, textH);
  ctx.fillStyle = WECHAT_BLUE;
  ctx.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  let y = textH - lines.length * lineH;
  for (const line of lines) {
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
 * 画二级标题：整行定宽画布，蓝条按文字真实宽度左对齐；保留软换行。
 * @param {string} raw
 */
function renderWechatH2Png(raw) {
  const soft = normalizeHeadingText(raw).split("\n").filter(Boolean);
  const padX = 10;
  const padY = 8;
  const fontSize = 20;
  const lineH = 25;
  const maxInner = WECHAT_BLOCK_W - padX * 2;
  const measure = wechatBlockCanvas(1, 1).ctx;
  measure.font = `800 ${fontSize}px ${WECHAT_SERIF}`;
  const lines = soft.flatMap((para) =>
    wechatWrapLines(measure, para, maxInner),
  );
  const innerW = Math.min(
    maxInner,
    Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width), 1)),
  );
  const boxW = Math.min(WECHAT_BLOCK_W, innerW + padX * 2);
  const boxH = Math.max(lineH + padY * 2, lines.length * lineH + padY * 2);
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, boxH);
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