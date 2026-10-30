import { isWeb } from "./dom.js";
import { blockPlainText, safeHTML, splitWechatH1 } from "./html.js";
import {
  renderWechatH1Png,
  renderWechatH2Png,
  renderWechatQuotePng,
  replaceWithWechatBlockImage,
  WECHAT_BLUE,
  WECHAT_BLOCK_THEME,
  WECHAT_SANS_PUBLISH,
  wechatBlockCSS,
  wechatBlockTextCSS,
  wechatH1IndexCSS,
  wechatQuoteMarkCSS,
} from "./wechat-png.js";

/**
 * 将 Markdown 转为公众号排版 HTML。
 * 正文字体写在外层 section，子元素尽量继承，避免每段重复 font-family 撑破 2 万字符上限。
 * @param {string} md
 * @param {{ keepImages?: boolean, blockImages?: boolean }} [opts]
 */
export async function publishHTMLInner(md, opts = {}) {
  const sans = WECHAT_SANS_PUBLISH;
  const theme = WECHAT_BLOCK_THEME;
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
    const blocks = [...d.querySelectorAll("h1, h2, blockquote")];
    let h1i = 0;
    for (const block of blocks) {
      const prev = block.previousElementSibling;
      const next = block.nextElementSibling;
      if (block.tagName === "H1") {
        const num = String(++h1i).padStart(2, "0");
        const top =
          block === d.body.firstElementChild
            ? theme.h1.firstMarginTop
            : theme.h1.marginTop;
        replaceWithWechatBlockImage(
          d,
          block,
          renderWechatH1Png(blockPlainText(block), num),
          "一级标题",
          `${top}px 0 ${theme.h1.marginBottom}px`,
        );
      } else if (block.tagName === "H2") {
        replaceWithWechatBlockImage(
          d,
          block,
          renderWechatH2Png(blockPlainText(block)),
          "二级标题",
          `${theme.h2.marginTop}px 0 ${theme.h2.marginBottom}px`,
        );
      } else {
        const top = prev?.tagName === "H2" ? 0 : theme.quote.margin;
        const bottom = /^H[12]$/.test(next?.tagName || "")
          ? 0
          : theme.quote.margin;
        replaceWithWechatBlockImage(
          d,
          block,
          renderWechatQuotePng(blockPlainText(block)),
          "引用",
          `${top}px 0 ${bottom}px`,
        );
      }
    }
  } else {
    d.querySelectorAll("h1").forEach((h1, i) => {
      splitWechatH1(h1);
      const num = String(i + 1).padStart(2, "0");
      const top =
        h1 === d.body.firstElementChild
          ? theme.h1.firstMarginTop
          : theme.h1.marginTop;
      h1.setAttribute("style", wechatBlockCSS("h1", { marginTop: top }));
      const text = h1.innerHTML;
      h1.innerHTML = `<span class="h1-text" style="flex:1 1 auto;min-width:0;">${text}</span><span class="wechat-h1-index" style="${wechatH1IndexCSS()}">${theme.h1.indexPrefix}${num}</span>`;
      h1.querySelectorAll(".h1-zh, .h1-en").forEach((el) =>
        el.setAttribute("style", `display:block;${wechatBlockTextCSS("h1")}`),
      );
    });

    // 二级标题：微信会重置 h1–h6 的 color，必须把白字写在 section/span 上
    d.querySelectorAll("h2").forEach((h2) => {
      const wrap = d.createElement("section");
      wrap.setAttribute("data-wechat-h2", "1");
      wrap.setAttribute(
        "style",
        `margin:${theme.h2.marginTop}px 0 ${theme.h2.marginBottom}px;max-width:100%;`,
      );
      const bar = d.createElement("section");
      bar.setAttribute(
        "style",
        `display:inline-block;max-width:100%;box-sizing:border-box;padding:${theme.h2.padding}px;background:${theme.h2.background};`,
      );
      const label = d.createElement("span");
      label.setAttribute("style", wechatBlockTextCSS("h2"));
      const prefix = d.createElement("span");
      prefix.textContent = theme.h2.prefix;
      prefix.setAttribute("style", wechatBlockTextCSS("h2"));
      label.appendChild(prefix);
      while (h2.firstChild) label.appendChild(h2.firstChild);
      label.querySelectorAll("*").forEach((el) => {
        el.setAttribute("style", wechatBlockTextCSS("h2"));
      });
      bar.appendChild(label);
      wrap.appendChild(bar);
      h2.replaceWith(wrap);
    });

    d.querySelectorAll("blockquote").forEach((bq) => {
      const top = bq.previousElementSibling?.hasAttribute("data-wechat-h2")
        ? 0
        : theme.quote.margin;
      const next = bq.nextElementSibling;
      const bottom =
        next?.tagName === "H1" || next?.hasAttribute("data-wechat-h2")
          ? 0
          : theme.quote.margin;
      bq.setAttribute(
        "style",
        wechatBlockCSS("quote", { marginTop: top, marginBottom: bottom }),
      );
      let mark = bq.querySelector(".wechat-quote-mark");
      if (!mark) {
        mark = d.createElement("span");
        mark.className = "wechat-quote-mark";
        mark.textContent = theme.quote.mark;
        bq.prepend(mark);
      }
      mark.setAttribute("style", wechatQuoteMarkCSS());
    });
  }

  // 段落/列表继承外层 sans；H1/H2/引用由上面的共享主题单独写全。
  const styles = {
    p: "margin:0 0 16px;",
    h3: `font-size:18px;margin:20px 0 12px;color:${WECHAT_BLUE};font-family:${sans};font-weight:800;`,
    li: "margin:4px 0;",
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
      // 仅含正文配图的段落：下边距交给图片
      if (
        tag === "p" &&
        n.children.length === 1 &&
        n.children[0].tagName === "IMG" &&
        !["一级标题", "二级标题", "引用"].includes(
          n.children[0].getAttribute("alt") || "",
        )
      ) {
        n.setAttribute("style", "margin:0;");
        return;
      }
      const prev = n.getAttribute("style") || "";
      n.setAttribute("style", prev ? `${prev};${style}` : style);
    }),
  );
  // 正文加粗：跳过标题 / 引用 / 二级标题条，避免盖成黑字
  d.querySelectorAll("strong").forEach((n) => {
    if (n.closest("h1, blockquote, [data-wechat-h2]")) return;
    n.setAttribute("style", "font-weight:600;color:#111;");
  });

  if (!opts.blockImages) {
    d.querySelectorAll("blockquote").forEach((bq) => {
      const textStyle = wechatBlockTextCSS("quote");
      bq.querySelectorAll(":scope > :not(.wechat-quote-mark)").forEach((el) => {
        const prev = el.getAttribute("style") || "";
        el.setAttribute(
          "style",
          `${prev};grid-column:2;${textStyle}`.replace(/^;/, ""),
        );
      });
      bq.querySelectorAll("p").forEach((p, i) =>
        p.setAttribute(
          "style",
          `margin:${i ? 10 : 0}px 0 0;grid-column:2;${textStyle}`,
        ),
      );
      bq.querySelectorAll("strong").forEach((el) =>
        el.setAttribute(
          "style",
          `${wechatBlockTextCSS("quote")}font-weight:700;`,
        ),
      );
    });
  }

  // 正文配图：主题蓝 2px 边框（跳过标题/引用块图）
  d.querySelectorAll("img").forEach((img) => {
    if (
      ["一级标题", "二级标题", "引用"].includes(img.getAttribute("alt") || "")
    )
      return;
    img.setAttribute(
      "style",
      `max-width:100%;height:auto;display:block;border:2px solid ${WECHAT_BLUE};margin:0 0 24px;`,
    );
  });
  return `<section style="font-family:${sans};font-size:15px;line-height:1.75;color:#111;padding:8px;max-width:768px;">${d.body.innerHTML}</section>`;
}
