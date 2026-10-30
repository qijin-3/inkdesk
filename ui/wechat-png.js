export const WECHAT_BLUE = "#0f3ff7";
export const WECHAT_BLUE_SOFT = "#f2f5ff";
export const WECHAT_SANS =
  "'OPPO Sans 4.0','PingFang SC','Helvetica Neue',Arial,sans-serif";
/**
 * 公众号 HTML 专用无衬线栈：不含本地定制字体（微信会丢弃整段 font-family），
 * 且尽量短，避免每段重复写爆 2 万字符上限。
 */
export const WECHAT_SANS_PUBLISH =
  "PingFang SC,Helvetica Neue,Arial,sans-serif";

/**
 * 公众号 H1/H2/引用的唯一视觉配置。
 * 预览内联样式与推送块图都从这里取值，避免改了一处、另一处继续沿用旧样式。
 */
export const WECHAT_BLOCK_THEME = Object.freeze({
  h1: Object.freeze({
    fontFamily: WECHAT_SANS,
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.25,
    letterSpacing: "0.05em",
    color: WECHAT_BLUE,
    marginTop: 24,
    firstMarginTop: 12,
    marginBottom: 14,
    indexPrefix: "—— ",
    indexFontSize: 20,
    indexFontWeight: 700,
    indexLineHeight: 0.85,
    indexLetterSpacing: "normal",
    indexMarginBottom: 1,
  }),
  h2: Object.freeze({
    fontFamily: WECHAT_SANS,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.25,
    letterSpacing: "0.05em",
    color: "#ffffff",
    background: WECHAT_BLUE,
    prefix: "## ",
    marginTop: 16,
    marginBottom: 14,
    padding: 8,
  }),
  quote: Object.freeze({
    fontFamily: WECHAT_SANS,
    fontSize: 15,
    fontWeight: 300,
    lineHeight: 1.5,
    letterSpacing: "normal",
    color: WECHAT_BLUE,
    background: WECHAT_BLUE_SOFT,
    margin: 10,
    paddingX: 8,
    paddingY: 12,
    columnGap: 8,
    mark: "“",
    markFontSize: 18.75,
    markFontWeight: 700,
    markLineHeight: 1.25,
  }),
});

const cssLength = (value) =>
  typeof value === "number" ? `${value}px` : String(value);

function textDeclarations(style) {
  return `font-family:${style.fontFamily};font-size:${cssLength(style.fontSize)};font-weight:${style.fontWeight};line-height:${style.lineHeight};letter-spacing:${style.letterSpacing};color:${style.color};`;
}

/** H1/H2/引用文字的内联样式。 */
export function wechatBlockTextCSS(tag, overrides = {}) {
  return textDeclarations({ ...WECHAT_BLOCK_THEME[tag], ...overrides });
}

/** H1/H2/引用的块级内联样式。 */
export function wechatBlockCSS(tag, overrides = {}) {
  const style = { ...WECHAT_BLOCK_THEME[tag], ...overrides };
  const text = textDeclarations(style);
  if (tag === "h1")
    return `display:flex;flex-direction:column-reverse;align-items:flex-start;${text}margin:${cssLength(style.marginTop)} 0 ${cssLength(style.marginBottom)};`;
  if (tag === "h2")
    return `display:inline-block;max-width:100%;box-sizing:border-box;${text}margin:${cssLength(style.marginTop)} 0 ${cssLength(style.marginBottom)};padding:${cssLength(style.padding)};background:${style.background};`;
  if (tag === "quote")
    return `display:grid;grid-template-columns:auto 1fr;column-gap:${cssLength(style.columnGap)};align-items:start;border:0;margin:${cssLength(style.marginTop ?? style.margin)} 0 ${cssLength(style.marginBottom ?? style.margin)};padding:${cssLength(style.paddingY)} ${cssLength(style.paddingX)};background:${style.background};${text}`;
  throw Error(`未知公众号块样式：${tag}`);
}

/** H1 序号行内样式。 */
export function wechatH1IndexCSS(overrides = {}) {
  const style = { ...WECHAT_BLOCK_THEME.h1, ...overrides };
  return `flex-shrink:0;display:inline;font-family:${style.fontFamily};font-size:${cssLength(style.indexFontSize)};font-weight:${style.indexFontWeight};line-height:${style.indexLineHeight};letter-spacing:${style.indexLetterSpacing};color:${style.color};margin-bottom:${cssLength(style.indexMarginBottom)};`;
}

/** 引用引号的行内样式。 */
export function wechatQuoteMarkCSS(overrides = {}) {
  const style = { ...WECHAT_BLOCK_THEME.quote, ...overrides };
  return `grid-column:1;grid-row:1;font-family:${style.fontFamily};font-size:${cssLength(style.markFontSize)};font-weight:${style.markFontWeight};line-height:${style.markLineHeight};letter-spacing:normal;color:${style.color};`;
}

function setCanvasFont(ctx, style) {
  ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

function setCanvasLetterSpacing(ctx, value) {
  ctx.letterSpacing = value === "normal" ? "0px" : value;
}

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
  const style = WECHAT_BLOCK_THEME.h1;
  const soft = normalizeHeadingText(raw).split("\n").filter(Boolean);
  const measure = wechatBlockCanvas(1, 1).ctx;
  setCanvasFont(measure, style);
  setCanvasLetterSpacing(measure, style.letterSpacing);

  /** @type {string[]} */
  let lines = [];
  if (soft.length > 1) {
    lines = soft.flatMap((para) =>
      wechatWrapLines(measure, para, WECHAT_BLOCK_W),
    );
  } else {
    const { zh, en } = splitH1ZhEn(soft[0] || "");
    lines = [
      ...wechatWrapLines(measure, zh, WECHAT_BLOCK_W),
      ...(en ? wechatWrapLines(measure, en, WECHAT_BLOCK_W) : []),
    ];
  }

  const lineH = style.fontSize * style.lineHeight;
  const indexH =
    style.indexFontSize * style.indexLineHeight + style.indexMarginBottom;
  const textH = Math.max(1, indexH + lines.length * lineH);
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, textH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, textH);
  ctx.fillStyle = style.color;

  ctx.font = `${style.indexFontWeight} ${style.indexFontSize}px ${style.fontFamily}`;
  setCanvasLetterSpacing(ctx, style.indexLetterSpacing);
  ctx.fillText(`${style.indexPrefix}${num}`, 0, 0);

  setCanvasFont(ctx, style);
  setCanvasLetterSpacing(ctx, style.letterSpacing);
  let y = indexH;
  for (const line of lines) {
    ctx.fillText(line, 0, y);
    y += lineH;
  }
  return c.toDataURL("image/png");
}

/**
 * 画二级标题：整行定宽画布，蓝条按文字真实宽度左对齐；保留软换行。
 * @param {string} raw
 */
export function renderWechatH2Png(raw) {
  const style = WECHAT_BLOCK_THEME.h2;
  const soft = normalizeHeadingText(raw).split("\n").filter(Boolean);
  const pad = style.padding;
  const lineH = style.fontSize * style.lineHeight;
  const maxInner = WECHAT_BLOCK_W - pad * 2;
  const measure = wechatBlockCanvas(1, 1).ctx;
  setCanvasFont(measure, style);
  setCanvasLetterSpacing(measure, style.letterSpacing);
  const paragraphs = soft.length ? soft : [""];
  paragraphs[0] = style.prefix + paragraphs[0];
  const lines = paragraphs.flatMap((para) =>
    wechatWrapLines(measure, para, maxInner),
  );
  const innerW = Math.min(
    maxInner,
    Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width), 1)),
  );
  const boxW = Math.min(WECHAT_BLOCK_W, innerW + pad * 2);
  const boxH = Math.max(lineH + pad * 2, lines.length * lineH + pad * 2);
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, boxW, boxH);
  ctx.fillStyle = style.color;
  setCanvasFont(ctx, style);
  setCanvasLetterSpacing(ctx, style.letterSpacing);
  let y = pad;
  for (const line of lines) {
    ctx.fillText(line, pad, y);
    y += lineH;
  }
  return c.toDataURL("image/png");
}

/**
 * 画引用块图。
 * @param {string} raw
 */
export function renderWechatQuotePng(raw) {
  const style = WECHAT_BLOCK_THEME.quote;
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const padX = style.paddingX;
  const padY = style.paddingY;
  const lineH = style.fontSize * style.lineHeight;
  const markLineH = style.markFontSize * style.markLineHeight;
  const measure = wechatBlockCanvas(1, 1).ctx;
  const markStyle = {
    fontWeight: style.markFontWeight,
    fontSize: style.markFontSize,
    fontFamily: style.fontFamily,
  };
  setCanvasFont(measure, markStyle);
  setCanvasLetterSpacing(measure, "normal");
  const markW = Math.max(8, measure.measureText(style.mark).width);
  const textW = WECHAT_BLOCK_W - padX * 2 - markW - style.columnGap;
  setCanvasFont(measure, style);
  setCanvasLetterSpacing(measure, style.letterSpacing);
  const lines = wechatWrapLines(measure, text, textW);
  const boxH = Math.max(markLineH + padY * 2, lines.length * lineH + padY * 2);
  const { c, ctx } = wechatBlockCanvas(WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, WECHAT_BLOCK_W, boxH);
  ctx.fillStyle = style.color;

  setCanvasFont(ctx, markStyle);
  setCanvasLetterSpacing(ctx, "normal");
  ctx.fillText(style.mark, padX, padY);

  setCanvasFont(ctx, style);
  setCanvasLetterSpacing(ctx, style.letterSpacing);
  let y = padY;
  const tx = padX + markW + style.columnGap;
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
