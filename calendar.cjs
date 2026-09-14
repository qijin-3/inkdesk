function validDate(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!m) return null;
  const key = m.slice(1).join("-"),
    d = new Date(key + "T00:00:00Z");
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === key
    ? key
    : null;
}
function calendar(rows, year, today) {
  const counts = {},
    articles = {};
  let missing = 0,
    future = 0;
  for (const r of rows) {
    const key = validDate(r["日期"]);
    if (!key) {
      missing++;
      continue;
    }
    if (key > today) {
      future++;
      continue;
    }
    if (+key.slice(0, 4) !== year) continue;
    counts[key] = (counts[key] || 0) + 1;
    (articles[key] ||= []).push(r["标题"]);
  }
  const start = new Date(Date.UTC(year, 0, 1)),
    end = new Date(Date.UTC(year + 1, 0, 1)),
    days = [];
  for (let d = start; d < end; d = new Date(+d + 86400000)) {
    const date = d.toISOString().slice(0, 10);
    days.push({
      date,
      count: counts[date] || 0,
      titles: articles[date] || [],
      future: date > today,
    });
  }
  const published = Object.values(counts).reduce((a, b) => a + b, 0),
    elapsed = days.filter((d) => !d.future).length;
  return {
    days,
    offset: start.getUTCDay(),
    published,
    activeDays: Object.keys(counts).length,
    weekly: elapsed ? (published / (elapsed / 7)).toFixed(1) : "0.0",
    missing,
    future,
  };
}
module.exports = { calendar, validDate };
