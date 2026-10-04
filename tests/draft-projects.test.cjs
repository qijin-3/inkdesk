const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let mod;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "ui", "draft-projects.js")],
    outfile: "/tmp/draft-projects.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  mod = require("/tmp/draft-projects.test.cjs");
});

test("draftProjectOf 取 02_Drafts 下一级子文件夹", () => {
  assert.equal(mod.draftProjectOf("Demo_AI/02_Drafts/虾皮猫/出图.md"), "虾皮猫");
  assert.equal(
    mod.draftProjectOf("Demo_AI/02_Drafts/clay_game/方案.md"),
    "clay_game",
  );
  assert.equal(
    mod.draftProjectOf("Demo_AI/02_Drafts/Content_OS/nested/x.md"),
    "Content_OS",
  );
  assert.equal(mod.draftProjectOf("Demo_AI/02_Drafts/根目录稿.md"), null);
  assert.equal(mod.draftProjectOf("Demo_AI/03_Archive/已发.md"), null);
  assert.equal(mod.draftProjectOf({ path: "A/02_Drafts/P/a.md" }), "P");
  assert.equal(mod.draftProjectOf(null), null);
});

test("groupDraftsByProject 未分组在前，项目中文排序", () => {
  const docs = [
    { id: "1", path: "A/02_Drafts/根.md", updated: "2026-01-02" },
    { id: "2", path: "A/02_Drafts/虾皮猫/a.md", updated: "2026-01-03" },
    { id: "3", path: "A/02_Drafts/clay_game/b.md", updated: "2026-01-01" },
    { id: "4", path: "A/02_Drafts/虾皮猫/c.md", updated: "2026-01-04" },
  ];
  const g = mod.groupDraftsByProject(docs);
  assert.deepEqual(
    g.ungrouped.map((d) => d.id),
    ["1"],
  );
  assert.deepEqual(
    g.projects.map((p) => p.name),
    ["clay_game", "虾皮猫"].sort((a, b) => a.localeCompare(b, "zh")),
  );
  assert.deepEqual(
    g.projects.find((p) => p.name === "虾皮猫").docs.map((d) => d.id),
    ["2", "4"],
  );
});

test("draftsSidebarHtml 空态与项目头转义", () => {
  assert.equal(
    mod.draftsSidebarHtml([], null, "<i/>"),
    '<p class="muted">从一个想法开始。</p>',
  );
  const html = mod.draftsSidebarHtml(
    [
      {
        id: "x",
        path: 'A/02_Drafts/<b>/t.md',
        title: "<script>",
        updated: "2026-09-29T00:00:00.000Z",
        body: "abcd",
      },
    ],
    "x",
    '<svg class="ico"></svg>',
  );
  assert.match(html, /docs-project-head/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /class="doc selected"/);
  assert.match(html, /4 字/);
});
