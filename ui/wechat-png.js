export const WECHAT_BLUE = "#0f3ff7";
export const WECHAT_BLUE_SOFT = "rgba(15, 63, 247, 0.2)";
/** 本地预览：寒蝉优先，回退到系统宋体（勿用无衬线，避免退化成黑体） */
export const WECHAT_SERIF =
  "'寒蝉锦书宋Compact','Songti SC','STSong','华文宋体','宋体',SimSun,serif";
/**
 * 公众号粘贴专用：不含自定义字体。
 * 微信遇到未知字体名常会丢弃整段 font-family，从而退化成黑体。
 */
export const WECHAT_SERIF_PUBLISH = "Songti SC,STSong,华文宋体,宋体,SimSun,serif";
export const WECHAT_SANS =
  "'OPPO Sans 4.0','PingFang SC','Helvetica Neue',Arial,sans-serif";
/**
 * 公众号 HTML 专用无衬线栈：不含本地定制字体（微信会丢弃整段 font-family），
 * 且尽量短，避免每段重复写爆 2 万字符上限。
 */
export const WECHAT_SANS_PUBLISH = "PingFang SC,Helvetica Neue,Arial,sans-serif";

/**
 * 推送用标题/引用图。
 * 逻辑宽取手机微信正文区约 360px（非整页 677）：图会按栏宽 100% 显示，
 * 若按 677 画 15px 字，缩到 ~360 后只剩约 8px，会远小于正文。
 * 4x → 约 1440px，Retina 仍清晰。
 */
export const WECHAT_BLOCK_W = 360;
export const WECHAT_BLOCK_SCALE = 4;

export function normalizeHeadingText(raw) {
  return String(raw || "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * 按中文字符换行。
 * @param {CanvasRenderingContext2D} ctx
 */
export function wechatWrapLines(ctx, text, maxW) {
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
export function wechatBlockCanvas(cssW, cssH) {
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
 * 单行一级标题按“中文 + 空格 + 英文”拆成主副标题（原 renderWechatH1Png 内联逻辑，原样抽出）。
 * @returns {{ zh: string, en: string }}
 */
export function splitH1ZhEn(one) {
  const m = String(one || "").match(
    /^([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef0-9A-Za-z\s\u2014\u2013\-·、，。！？：；“”‘’（）【】《》]+?)\s+([A-Za-z][A-Za-z0-9&/.,'’\- ]{1,60})$/,
  );
  return m ? { zh: m[1].trim(), en: m[2].trim() } : { zh: one, en: "" };
}

/**
 * 画一级标题图（蓝字 + 序号方块）；保留标题内软换行。
 * @param {string} raw
 * @param {string} num
 */
export function renderWechatH1Png(raw, num) {
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
    const { zh, en } = splitH1ZhEn(soft[0] || "");
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
export function renderWechatH2Png(raw) {
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
export function renderWechatQuotePng(raw) {
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
export function replaceWithWechatBlockImage(d, el, dataUrl, alt, margin) {
  const wrap = d.createElement("section");
  wrap.setAttribute("style", `margin:${margin};max-width:100%;`);
  const img = d.createElement("img");
  img.setAttribute("src", dataUrl);
  img.setAttribute("alt", alt);
  img.setAttribute("width", String(WECHAT_BLOCK_W));
  // 栏宽 100% 铺满；样式尽量短，多标题文推送时省字符
  img.setAttribute(
    "style",
    "width:100%;max-width:100%;height:auto;display:block;border:0;",
  );
  wrap.appendChild(img);
  el.replaceWith(wrap);
}
