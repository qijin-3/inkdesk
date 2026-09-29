const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let perf;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "ui", "perf.js")],
    outfile: "/tmp/perf.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  perf = require("/tmp/perf.test.cjs");
});

test("time 透传参数与返回值（含 Promise）", async () => {
  assert.equal(
    perf.time("add", (a, b) => a + b, 2, 3),
    5,
  );
  assert.equal(await perf.time("async", async (x) => x * 2, 21), 42);
});

test("time 异常时仍记录耗时并抛出", () => {
  assert.throws(() => perf.time("boom", () => {
    throw new Error("x");
  }), /x/);
});
