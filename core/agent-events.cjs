const EVENT_TYPES = ["text_delta","tool_start","tool_update","tool_end","step","error","usage","done","activity"];
function makeEvent(type, data = {}) { return { type, at: Date.now(), ...data }; }
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
module.exports = { EVENT_TYPES, makeEvent, summarizeArgs, toolDisplayName };
