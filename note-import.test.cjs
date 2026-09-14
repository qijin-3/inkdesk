const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  parseNoteTable,
  rowToYaml,
  matchNoteRows,
  parsePublishDate,
} = require("./note-import.cjs");

test("parse xlsx note table and match archives", () => {
  assert.equal(parsePublishDate("2026年08月15日13时12分39秒"), "2026-08-15");
  const file = path.join(
    process.env.HOME || "/Users/jin",
    "Downloads",
    "笔记列表明细表.xlsx",
  );
  if (!fs.existsSync(file)) return;
  const rows = parseNoteTable(file);
  assert.ok(rows.length > 5);
  const yaml = rowToYaml(rows[0]);
  assert.equal(typeof yaml["观看量"], "number");
  const { matched, unmatched } = matchNoteRows(rows.slice(0, 3), [
    { title: rows[0].title, path: "金奇_AI/03_Archive/a.md" },
    { title: "其他", path: "金奇_AI/03_Archive/b.md" },
  ]);
  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 2);
  assert.ok(Array.isArray(unmatched[0].suggestions));
});
