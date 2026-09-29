const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { within, parseCSV, proposedApply } = require("./core.cjs");
test("reject stale article proposal", () => {
  assert.throws(() => proposedApply("human edit", "old", "AI edit"));
  assert.equal(proposedApply("old", "old", "new"), "new");
});
test("parse quoted CSV titles and missing metrics", () => {
  assert.deepEqual(parseCSV('标题,阅读\r\n"hello, world",12\r\n"a""b",'), [
    ["标题", "阅读"],
    ["hello, world", "12"],
    ['a"b', ""],
  ]);
  assert.throws(() => parseCSV('"bad'));
});
test("prevent symlink escaping source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-test-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ink-out-"));
  fs.writeFileSync(path.join(outside, "secret.md"), "x");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "link.md"));
  assert.throws(() => within(root, path.join(root, "link.md")));
  fs.rmSync(root, { recursive: true });
  fs.rmSync(outside, { recursive: true });
});
