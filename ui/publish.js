import { esc, isWeb } from "./dom.js";
import { blockPlainText, safeHTML, splitWechatH1 } from "./html.js";
import { renderWechatH1Png, renderWechatH2Png, renderWechatQuotePng, replaceWithWechatBlockImage, WECHAT_BLUE, WECHAT_BLUE_SOFT, WECHAT_SERIF_PUBLISH, WECHAT_SANS } from "./wechat-png.js";

export async function publishHTMLInner(md, opts = {}) {
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
        renderWechatH1Png(blockPlainText(h1), num),
        "一级标题",
        "56px 0 20px",
      );
    }
    for (const h2 of [...d.querySelectorAll("h2")]) {
      replaceWithWechatBlockImage(
        d,
        h2,
        renderWechatH2Png(blockPlainText(h2)),
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
      // 仅含正文配图的段落：下边距交给图片
      if (
        tag === "p" &&
        n.children.length === 1 &&
        n.children[0].tagName === "IMG" &&
        !["一级标题", "二级标题", "引用"].includes(
          n.children[0].getAttribute("alt") || "",
        )
      ) {
        const prev = n.getAttribute("style") || "";
        const s = `margin:0;line-height:1.75;font-size:15px;color:#111;font-family:${WECHAT_SANS};font-weight:400;`;
        n.setAttribute("style", prev ? `${prev};${s}` : s);
        return;
      }
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
          `${prev};font-family:${serif};color:${WECHAT_BLUE};`.replace(
            /^;/,
            "",
          ),
        );
    });
    d.querySelectorAll("h1 .h1-zh, h1 .h1-en").forEach((el) =>
      el.setAttribute(
        "style",
        `display:block;font-size:40px;font-weight:800;line-height:1.1;color:${WECHAT_BLUE};font-family:${serif};`,
      ),
    );
  }
  // 正文配图：主题蓝 2px 边框（跳过标题/引用块图）
  d.querySelectorAll("img").forEach((img) => {
    if (
      ["一级标题", "二级标题", "引用"].includes(img.getAttribute("alt") || "")
    )
      return;
    const prev = img.getAttribute("style") || "";
    const style = `max-width:100% !important;height:auto !important;box-sizing:border-box;border:2px solid ${WECHAT_BLUE};display:block;margin:0 0 24px;`;
    img.setAttribute("style", prev ? `${prev};${style}` : style);
  });
  return `<section style="font-family:${WECHAT_SANS};padding:8px;color:#111;max-width:768px;">${d.body.innerHTML}</section>`;
}
