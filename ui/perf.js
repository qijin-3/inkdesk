/**
 * 渲染耗时度量（M4  instrumentation，先度量再优化）。
 * 零行为影响：只写 performance timeline + window.__inkdeskPerf（devtools/测试可读）。
 * 生产环境可通过 localStorage inkdesk:perf=0 关闭。
 */
const marks = new Map();
function enabled() {
  try {
    return (
      typeof performance !== "undefined" &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem("inkdesk:perf") !== "0"
    );
  } catch {
    return typeof performance !== "undefined";
  }
}
export function perfStart(name) {
  if (!enabled()) return 0;
  const t = performance.now();
  marks.set(name, t);
  try {
    performance.mark(`inkdesk:${name}:start`);
  } catch {
    /* ignore */
  }
  return t;
}
export function perfEnd(name) {
  if (!enabled()) return 0;
  const t0 = marks.get(name) ?? 0;
  const dt = performance.now() - t0;
  marks.delete(name);
  try {
    performance.mark(`inkdesk:${name}:end`);
    performance.measure(`inkdesk:${name}`, `inkdesk:${name}:start`, `inkdesk:${name}:end`);
  } catch {
    /* ignore */
  }
  try {
    const g = (window.__inkdeskPerf = window.__inkdeskPerf || {});
    const arr = (g[name] = g[name] || []);
    arr.push(Math.round(dt * 10) / 10);
    if (arr.length > 50) arr.shift();
  } catch {
    /* ignore */
  }
  return dt;
}
/** 同步函数计时包装：time("renderPreview", fn, ...args)，返回值（含 Promise）原样透传 */
export function time(name, fn, ...args) {
  perfStart(name);
  try {
    return fn(...args);
  } finally {
    perfEnd(name);
  }
}
