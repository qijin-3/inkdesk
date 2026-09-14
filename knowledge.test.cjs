const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { Vault } = require("./vault.cjs"),
  { Knowledge } = require("./knowledge.cjs"),
  { calendar, validDate } = require("./calendar.cjs");
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-knowledge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v = new Vault(root);
  v.load();
  for (const id of ["a", "b"])
    v.saveDoc({
      id,
      title: id,
      account: "AI",
      body: "文章" + id,
      conversations: [],
      snapshots: [],
    });
  const k = new Knowledge(v, path.join(__dirname, "assets/reference-reader"));
  return { root, v, k };
}
test("publishing heatmap validates dates, leap year, same-day frequency and missing/future values", () => {
  assert.equal(validDate("2026-02-30"), null);
  assert.equal(validDate("2024-02-29T23:30:00+08:00"), "2024-02-29");
  const c = calendar(
    [
      { 日期: "2024-02-29", 标题: "a" },
      { 日期: "2024-02-29", 标题: "b" },
      { 日期: null },
      { 日期: "2024-12-31" },
      { 日期: "2024-02-30" },
    ],
    2024,
    "2024-03-01",
  );
  assert.equal(c.days.length, 366);
  assert.equal(c.days.find((d) => d.date === "2024-02-29").count, 2);
  assert.equal(c.published, 2);
  assert.equal(c.activeDays, 1);
  assert.equal(c.missing, 2);
  assert.equal(c.future, 1);
});
test("project files are copied, fully extracted, isolated and persisted with AI toggles", async (t) => {
  const { root, k } = setup(t);
  const src = path.join(root, "reference.txt");
  fs.writeFileSync(src, "唯一来源内容，给项目 a");
  let refs = await k.upload("a", [src]);
  assert.equal(k.refs("b").length, 0);
  assert.match(k.projectContext("a"), /唯一来源内容/);
  assert.doesNotMatch(k.projectContext("b"), /唯一来源/);
  fs.writeFileSync(src, "源文件后来改变");
  assert.match(k.refText("a", refs[0].id).text, /唯一来源/);
  k.toggle("a", refs[0].id, false);
  assert.equal(k.projectContext("a"), "");
  const again = new Knowledge(k.v, k.reader);
  assert.equal(again.refs("a")[0].enabled, false);
  assert.throws(() => k.refText("b", refs[0].id));
});
test("unreadable files retained but never silently sent to AI", async (t) => {
  const { root, k } = setup(t);
  const src = path.join(root, "data.unknown");
  fs.writeFileSync(src, "binary");
  const [r] = await k.upload("a", [src]);
  assert.equal(r.status, "unreadable");
  assert.equal(r.enabled, false);
  assert.throws(() => k.toggle("a", r.id, true));
  assert.equal(k.projectContext("a"), "");
});
test("whole Profile is managed; proposals keep evidence, backups, rejection and stale protection", (t) => {
  const { v, k } = setup(t);
  fs.writeFileSync(v.p("金奇_AI/00_Profile/Persona_Doc.md"), "原始定位");
  fs.mkdirSync(v.p("金奇_AI/00_Profile/Author_DNA"), { recursive: true });
  fs.writeFileSync(
    v.p("金奇_AI/00_Profile/Author_DNA/语言风格.md"),
    "原始语言",
  );
  assert.equal(k.profile("AI").files.length, 2);
  const state = v.load(),
    p = k.simple("AI", state);
  assert.equal(p.changes.length, 4);
  assert.equal(k.readProfile("AI", "Persona_Doc.md").text, "原始定位");
  k.decide("AI", p.id, "reject");
  assert.equal(k.readProfile("AI", "Persona_Doc.md").text, "原始定位");
  const accepted = k.simple("AI", state);
  k.decide("AI", accepted.id, "apply");
  assert.match(k.activeContext("AI"), /设计师/);
  assert(
    fs.existsSync(
      v.p("_system/inkdesk/profile-history/AI/" + accepted.id + ".json"),
    ),
  );
  const e = k.evidence("AI", state),
    newer = k.proposal(
      "AI",
      [
        {
          path: "Persona_Doc.md",
          content: "新定位",
          sources: ["金奇_AI/00_Profile/Persona_Doc.md"],
        },
      ],
      e,
    );
  const old = k.readProfile("AI", "Persona_Doc.md");
  k.saveProfile("AI", old.path, "用户自己改了", old.hash);
  assert.throws(() => k.decide("AI", newer.id, "apply"), /已修改/);
  assert.equal(k.readProfile("AI", "Persona_Doc.md").text, "用户自己改了");
  assert.throws(() =>
    k.proposal(
      "AI",
      [{ path: "../escape.md", content: "x", sources: e.sources }],
      e,
    ),
  );
  assert.throws(
    () =>
      k.proposal(
        "AI",
        [{ path: "Persona_Doc.md", content: "x", sources: ["捏造的来源"] }],
        e,
      ),
    /来源/,
  );
});
test("iteration evidence includes current account articles and YAML only", (t) => {
  const { v, k } = setup(t);
  fs.writeFileSync(v.p("金奇_AI/00_Profile/Persona_Doc.md"), "AI 人设");
  const e = k.evidence("AI", {
    documents: [
      {
        account: "AI",
        id: "a",
        title: "a",
        body: "属于AI",
        updated: "2026-09-14",
      },
      {
        account: "Dev",
        id: "b",
        title: "b",
        body: "不可混入",
        updated: "2026-09-14",
      },
    ],
    archives: [
      {
        account: "AI",
        path: "金奇_AI/03_Archive/x.md",
        body: "案例正文",
        title: "x",
        fields: { 发布时间: "2026-09-12", 观看量: 123, 收藏: null },
      },
    ],
  });
  assert.match(e.context, /123/);
  assert.match(e.context, /属于AI/);
  assert.doesNotMatch(e.context, /不可混入/);
  assert.match(e.context, /null/);
});
