/**
 * 指标增减标记文本：null/0/非数字返回空，正数带 +。
 * @param {number|null|undefined} n
 */
export function formatDelta(n) {
  if (n == null || n === 0 || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return (v > 0 ? "+" : "") + v.toLocaleString();
}
