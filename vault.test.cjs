const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Vault, split } = require("./vault.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-vault-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v = new Vault(root);
  v.createAccount("金奇_AI");
  v.createAccount("金奇_Dev");
  return v;
}
function draft() {
  return {
    id: "article-123",
    title: "文章一",
    account: "AI",
    body: "正文",
    updated: new Date().toISOString(),
    titles: [],
    snapshots: [],
    conversations: [
      {
        id: "chat-1",
        title: "第一聊",
        messages: [{ role: "user", text: "观点一" }],
      },
    ],
    materials: [],
  };
}
test("archive YAML metrics, missing values and unknown metadata survive", (t) => {
  const v = fixture(t);
  fs.writeFileSync(
    v.p("金奇_AI/03_Archive/旧文.md"),
    "---\n发布时间: 2026-09-01\n观看量: 42\n收藏:\n涨粉: 0\n---\n旧文",
  );
  let s = v.load();
  assert.equal(s.metrics[0]["阅读"], 42);
  assert.equal(s.metrics[0]["收藏"], null);
  assert.equal(s.metrics[0]["涨粉"], 0);
  assert.equal(s.documents.length, 0);
  fs.writeFileSync(
    v.p("金奇_AI/02_Drafts/草稿.md"),
    "---\n# 保留注释\n观看量:\n自定义:\n  嵌套: 是\n---\n原文",
  );
  s = v.load();
  s.documents[0].body = "修改";
  v.saveDoc(s.documents[0]);
  const raw = fs.readFileSync(v.p("金奇_AI/02_Drafts/草稿.md"), "utf8");
  assert.match(raw, /# 保留注释/);
  assert.deepEqual(split(raw).yaml.toJS()["自定义"], { 嵌套: "是" });
});
test("canonical attachments, independent conversations, versions and final move survive restart", (t) => {
  let v = fixture(t);
  v.load();
  let d = draft();
  v.saveDoc(d);
  const image = v.image(d.title, Buffer.from("image"), ".png");
  assert.match(
    decodeURIComponent(image),
    /Attachment\/文章一\/file-\d{17}\.png/,
  );
  d.body += "\n![图片](" + image + ")";
  d.conversations.push({
    id: "chat-2",
    title: "第二聊",
    messages: [{ role: "user", text: "观点二" }],
  });
  d.snapshots.push({
    id: "v1",
    at: new Date().toISOString(),
    name: "初稿",
    body: "初稿内容",
  });
  v.saveDoc(d);
  let raw = fs.readFileSync(v.p("金奇_AI/02_Drafts/文章一.md"), "utf8");
  assert.match(raw, /!\[\[Attachment\//);
  assert.doesNotMatch(raw, /inkasset:/);
  v = new Vault(v.root);
  let s = v.load();
  assert.equal(s.documents[0].conversations.length, 2);
  assert(s.documents[0].snapshots.some((x) => x.name === "初稿"));
  assert.match(s.documents[0].body, /inkasset:\/\/vault/);
  const dest = v.finalize(d.id);
  assert(!fs.existsSync(v.p("金奇_AI/02_Drafts/文章一.md")));
  assert(fs.existsSync(v.p(dest)));
  s = v.load();
  assert.equal(s.documents.length, 0);
  assert.equal(s.archives.length, 1);
  assert.equal(s.metrics[0]["日期"], null);
  assert.equal(s.metrics[0]["阅读"], null);
  assert(
    fs.existsSync(v.p("_system/inkdesk/conversations/article-123/chat-2.json")),
  );
});
test("external edits and archive collisions are never overwritten", (t) => {
  const v = fixture(t);
  v.load();
  const d = draft();
  v.saveDoc(d);
  const file = v.p("金奇_AI/02_Drafts/文章一.md");
  fs.appendFileSync(file, "外部修改");
  d.body = "编辑器修改";
  assert.throws(() => v.saveDoc(d), /外部修改/);
  assert.match(fs.readFileSync(file, "utf8"), /外部修改/);
  v.load();
  fs.writeFileSync(v.p("金奇_AI/03_Archive/文章一.md"), "已有归档");
  assert.throws(() => v.finalize(d.id), /同名/);
  assert(fs.existsSync(file));
  assert.equal(
    fs.readFileSync(v.p("金奇_AI/03_Archive/文章一.md"), "utf8"),
    "已有归档",
  );
});
test("materials and compact profile are local, original persona remains intact", (t) => {
  const v = fixture(t);
  fs.writeFileSync(v.p("金奇_AI/00_Profile/Persona_Doc.md"), "原始规则");
  const list = v.addMaterial({ title: "一个案例", body: "资料与来源" });
  assert.match(list[0].path, /00_wiki\/_data\/raw\/inbox/);
  assert.equal(v.readMaterial(list[0].path), "资料与来源");
  v.saveProfile("AI", "简单约定");
  v.saveProfile("AI", "更新约定");
  assert.equal(v.profile("AI").original, "原始规则");
  assert.equal(v.profile("AI").contract, "更新约定");
  assert.equal(
    fs.readdirSync(v.p("_system/inkdesk/profile-history")).length,
    1,
  );
  assert.throws(() => v.p("../elsewhere"));
});
test("renaming draft preserves image resolution and history", (t) => {
  const v = fixture(t);
  v.load();
  const d = draft();
  d.body = "![图片](" + v.image(d.title, Buffer.from("x"), ".png") + ")";
  v.saveDoc(d);
  d.title = "文章新标题";
  v.saveDoc(d);
  assert(!fs.existsSync(v.p("金奇_AI/02_Drafts/文章一.md")));
  assert(fs.existsSync(v.p("金奇_AI/02_Drafts/文章新标题.md")));
  assert.match(
    fs.readFileSync(v.p("金奇_AI/02_Drafts/文章新标题.md"), "utf8"),
    /Attachment\/文章新标题\//,
  );
  assert.match(v.load().documents[0].body, /inkasset/);
});

test("finalizing a legacy multi-version article does not leave a new rogue draft", (t) => {
  const v = fixture(t);
  fs.writeFileSync(v.p("金奇_AI/02_Drafts/主稿.md"), "主稿正文");
  fs.writeFileSync(v.p("金奇_AI/02_Drafts/主稿.ai-v1.md"), "旧 AI 正文");
  const d = v.load().documents[0];
  assert.equal(v.load().documents.length, 1);
  v.finalize(d.id);
  assert.equal(v.load().documents.length, 0);
  assert(!fs.existsSync(v.p("金奇_AI/02_Drafts/主稿.ai-v1.md")));
  assert.equal(
    fs.readFileSync(
      v.p("_system/inkdesk/legacy/" + d.id + "/主稿.ai-v1.md"),
      "utf8",
    ),
    "旧 AI 正文",
  );
});
