const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let mod;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "social-layout.js")],
    outfile: "/tmp/social-layout.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  mod = require("/tmp/social-layout.test.cjs");
});

/** 每个字符固定 10px，便于验证宽度换行 */
const fakeCtx = () => ({
  measureText: (value) => ({ width: Array.from(String(value)).length * 10 }),
});

test("小红书一级标题按实际可用宽度换行", () => {
  const ctx = fakeCtx();
  const title = "从 Pinterest 到前端 UI";
  assert.deepEqual(
    mod.socialHeadingLines(ctx, title, 360, 0),
    [title],
  );
  const narrow = mod.socialHeadingLines(ctx, title, 80, 0);
  assert.ok(narrow.length > 1);
  assert.equal(narrow.join(""), title);
});

test("小红书一级标题保留显式软换行", () => {
  assert.deepEqual(
    mod.socialHeadingLines(fakeCtx(), "第一行\n第二行", 360, 0),
    ["第一行", "第二行"],
  );
});
