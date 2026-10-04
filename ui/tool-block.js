import { esc } from "./dom.js";

// ponytail: 浏览器直载 ESM，不能 import .cjs；6 行小抄本地一份，权威实现在 core/agent-events.cjs
function summarizeArgs(args, max = 120) {
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args || {});
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch { return ""; }
}
function toolDisplayName(name) {
  const map = { read: "读取文件", write: "写入文件", edit: "编辑文件", bash: "执行命令", search: "搜索", webfetch: "联网检索" };
  return map[String(name || "").toLowerCase()] || String(name || "工具");
}
export function toolBlockHtml(tool, state = "running") {
  const name = toolDisplayName(tool?.name);
  const icon = state === "done" ? "✓" : state === "error" ? "✕" : "◌";
  return `<div class="tool-block is-${state}" data-tool-id="${esc(tool?.id || "")}">`
    + `<button type="button" class="tool-head" data-tool-toggle><span class="tool-icon">${icon}</span>`
    + `<strong>${esc(name)}</strong><code>${esc(tool?.name || "")}</code>`
    + `<span class="tool-args">${esc(summarizeArgs(tool?.args))}</span>`
    + `<span class="tool-state">${esc(state)}</span></button>`
    + `<pre class="tool-output" hidden>${esc(tool?.output || "")}</pre></div>`;
}
export function activityLine(events) {
  const last = [...events].reverse().find((e) => e.type?.startsWith("tool"));
  if (last) return toolDisplayName(last.tool?.name) + " " + summarizeArgs(last.tool?.args, 60);
  const t = events.filter((e) => e.type === "text_delta").length;
  return t ? "正在撰写…" : "准备中…";
}
