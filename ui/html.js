import { marked } from "marked";
import { esc, isWeb } from "./dom.js";
import { normalizeHeadingText } from "./wechat-png.js";

/**
 * 从块级节点提取纯文本，将 &lt;br&gt; 转为换行（同一标题内的软换行）。
 * @param {Node} node
 * @returns {string}
 */
export function blockPlainText(node) {
  let out = "";
  /**
   * @param {Node} n
   */
  function walk(n) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeName === "BR") {
      const cls = n.getAttribute?.("class") || "";
      if (!cls.includes("ProseMirror-trailingBreak")) out += "\n";
    } else if (n.childNodes?.length) for (const c of n.childNodes) walk(c);
  }
  walk(node);
  return out
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 清洗富文本 HTML，并按环境改写图片资源地址（避免整页正则误伤）。
 * @param {string} html
 * @returns {string}
 */
export function sanitizeRichHTML(html) {
  const d = new DOMParser().parseFromString(html || "", "text/html");
  d.querySelectorAll(
    "script,iframe,object,embed,style,link,form,input,button",
  ).forEach((n) => n.remove());
  d.body.querySelectorAll("*").forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (
        a.name.startsWith("on") ||
        a.name === "style" ||
        (["href", "src"].includes(a.name) &&
          !/^(https?:|inkasset:|\/api\/asset\/|data:image\/|blob:|[^:]*$)/i.test(
            a.value,
          ))
      )
        n.removeAttribute(a.name);
    });
  });
  d.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (isWeb()) {
      if (src.startsWith("inkasset://vault/"))
        img.setAttribute(
          "src",
          "/api/asset/vault/" + src.slice("inkasset://vault/".length),
        );
      else if (src.startsWith("inkasset://local/"))
        img.setAttribute(
          "src",
          "/api/asset/local/" + src.slice("inkasset://local/".length),
        );
    } else if (src.startsWith("/api/asset/vault/"))
      img.setAttribute(
        "src",
        "inkasset://vault/" + src.slice("/api/asset/vault/".length),
      );
    else if (src.startsWith("/api/asset/local/"))
      img.setAttribute(
        "src",
        "inkasset://local/" + src.slice("/api/asset/local/".length),
      );
  });
  return d.body.innerHTML;
}

/**
 * 将一级标题包装为按容器实际宽度换行的文本块；保留 Shift+Enter 软换行。
 * @param {HTMLElement} h1
 */
export function splitWechatH1(h1) {
  if (h1.querySelector(".h1-line")) return;
  const soft = normalizeHeadingText(blockPlainText(h1))
    .split("\n")
    .filter(Boolean);
  if (!soft.length) return;
  const doc = h1.ownerDocument;
  const wrap = doc.createElement("span");
  wrap.className = "h1-text";

  /**
   * 追加一个标题段落；仅显式软换行会单独成段。
   * @param {string} line
   */
  function addLine(line) {
    const span = doc.createElement("span");
    span.className = "h1-line";
    span.textContent = line;
    wrap.append(span);
  }

  for (const line of soft) addLine(line);
  h1.replaceChildren(wrap);
}

/**
 * 将 Markdown 转为可安全插入的 HTML。
 * @param {string} md
 */
export function safeHTML(md) {
  return sanitizeRichHTML(
    new DOMParser().parseFromString(marked.parse(md || ""), "text/html").body
      .innerHTML,
  );
}

/**
 * 清洗 HTML 片段用于素材预览（去掉脚本与危险属性）。
 * @param {string} html
 */
export function sanitizeHtmlPreview(html) {
  const d = new DOMParser().parseFromString(html || "", "text/html");
  d.querySelectorAll(
    "script,iframe,object,embed,link,form,input,button,meta",
  ).forEach((n) => n.remove());
  d.body.querySelectorAll("*").forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (
        a.name.startsWith("on") ||
        (["href", "src"].includes(a.name) &&
          !/^(https?:|data:image\/|#|[^:]*$)/i.test(a.value))
      )
        n.removeAttribute(a.name);
    });
  });
  return d.body.innerHTML;
}
