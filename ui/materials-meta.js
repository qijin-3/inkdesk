/** JSON 预览美化；非 JSON 原样返回 */
export function formatJsonPreview(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text || "";
  }
}

/**
 * 根据文件名推断素材类型（后端未返回 kind 时的回退）。
 * @param {string} name
 */
export function inferMaterialKind(name) {
  const ext = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  if (ext === "json") return "json";
  if (["txt", "csv", "yaml", "yml", "log", "tsv", "xml"].includes(ext))
    return "text";
  return "binary";
}

/**
 * Uint8Array 转 Base64（分块，避免大图撑爆调用栈）。
 * @param {Uint8Array} buf
 */
export function uint8ToBase64(buf) {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) {
    s += String.fromCharCode(...buf.subarray(i, i + step));
  }
  return btoa(s);
}
