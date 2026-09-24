const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Vault } = require("./vault.cjs"),
  { Knowledge } = require("./knowledge.cjs"),
  { AccountModel, resolveRefs } = require("./account-model.cjs");
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-model-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v = new Vault(root);
  v.createAccount("金奇_AI");
  v.createAccount("金奇_Dev");
  v.load();
  const k = new Knowledge(v, "");
  const m = new AccountModel(v, k);
  return { v, k, m };
}
test("fixed account modules migrate to one Markdown and exclude conflicting old rule files", (t) => {
  const { v, m } = setup(t);
  fs.writeFileSync(
    v.p("金奇_AI/00_Profile/Persona_Doc.md"),
    "所有文章必须写三段",
  );
  const p = m.load("AI");
  assert.deepEqual(
    p.definitions.map((x) => x.id),
    ["identity", "voice", "examples", "learning"],
  );
  assert(fs.existsSync(v.p("金奇_AI/00_Profile/Account_Model.md")));
  assert.doesNotMatch(m.context("AI"), /必须写三段/);
  assert.equal(
    fs.readFileSync(v.p("金奇_AI/00_Profile/Persona_Doc.md"), "utf8"),
    "所有文章必须写三段",
  );
  const next = m.save("AI", { ...p.modules, voice: "我的新表达" }, p.hash);
  assert.equal(next.history.length, 1);
  assert.throws(() => m.save("AI", p.modules, p.hash), /已变化/);
});
test("AI may update fixed module contents, never introduce a fifth module, and stale proposals are rejected", (t) => {
  const { v, m } = setup(t);
  const state = v.load(),
    e = m.evidence("AI", state);
  assert.throws(() =>
    m.propose(
      "AI",
      [{ module: "another", content: "x", sources: e.sources }],
      e,
    ),
  );
  const p = m.propose(
    "AI",
    [{ module: "learning", content: "暂时观察，样本不足", sources: e.sources }],
    e,
  );
  m.decide("AI", p.id, true);
  assert.equal(m.load("AI").modules.learning, "暂时观察，样本不足");
  const e2 = m.evidence("AI", state),
    p2 = m.propose(
      "AI",
      [{ module: "voice", content: "自然", sources: e2.sources }],
      e2,
    );
  m.save("AI", { ...e2.model.modules, voice: "用户先改了" }, e2.model.hash);
  assert.throws(() => m.decide("AI", p2.id, true), /已变化/);
});
test("tag references resolve only within project and exact requested lines; changed selections fail", async (t) => {
  const { v, k } = setup(t);
  const doc = {
    id: "one",
    title: "one",
    body: "正文",
    account: "AI",
    snapshots: [],
    conversations: [],
  };
  v.saveDoc(doc);
  v.saveDoc({ ...doc, id: "two", title: "two" });
  const src = v.p("reference.txt");
  fs.writeFileSync(src, "第一行\n准确的第二行\n第三行");
  const [f] = await k.upload("one", [src]);
  const r = {
    refId: "ref-1",
    kind: "file",
    fileId: f.id,
    startLine: 2,
    endLine: 2,
  };
  const text = resolveRefs(k, doc, [r], doc.body);
  assert.match(text, /准确的第二行/);
  assert.doesNotMatch(text, /第一行|第三行/);
  assert.throws(() => resolveRefs(k, { ...doc, id: "two" }, [r], doc.body));
  assert.throws(
    () =>
      resolveRefs(
        k,
        doc,
        [
          {
            refId: "s",
            kind: "selection",
            articleId: "one",
            base: "旧正文",
            text: "旧",
            from: 1,
            to: 2,
          },
        ],
        doc.body,
      ),
    /过期/,
  );
});
