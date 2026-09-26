const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Skills } = require("./skills.cjs");
test("scoped skills compose in order, isolate accounts, reject cycles and stale writes, persist defaults", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aside-skills-"));
  try {
    const k = new Skills({
      p: (r) => path.join(root, r),
      resolveAccountId: (a) => a,
    });
    let s = k.save({
      account: "A",
      revision: 0,
      skill: { scope: "global", name: "事实", prompt: "核实来源" },
    });
    const g = s.items[0].id;
    s = k.save({
      account: "A",
      revision: s.revision,
      skill: {
        scope: "account",
        name: "我的风格",
        prompt: "保留语气",
        includes: [g],
      },
    });
    const a = s.items.find((x) => x.scope === "account").id;
    assert.equal(k.list("B").items.length, 1);
    assert.throws(() => k.context("B", [a]));
    assert.match(
      k.context("A", [a]),
      /事实\n核实来源[\s\S]*我的风格\n保留语气/,
    );
    assert.throws(
      () => k.save({ account: "A", revision: 0, skill: s.items[0] }),
      /其他窗口/,
    );
    assert.throws(
      () =>
        k.save({
          account: "A",
          revision: s.revision,
          skill: { ...s.items[0], includes: [g] },
        }),
      /循环/,
    );
    assert.throws(
      () =>
        k.save({
          account: "A",
          revision: s.revision,
          skill: { ...s.items[0], includes: [a] },
        }),
      /通用技能/,
    );
    assert.throws(
      () => k.remove({ account: "A", revision: s.revision, id: g }),
      /组合/,
    );
    s = k.configure({ account: "A", revision: s.revision, ids: [a] });
    assert.match(k.context("A"), /保留语气/);
    assert.equal(k.context("B"), "");
    assert(fs.existsSync(k.file + ".history"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
