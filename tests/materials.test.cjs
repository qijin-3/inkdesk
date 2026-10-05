const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Vault } = require("../vault.cjs");
const Materials = require("../core/materials.cjs");
const Groups = require("../core/groups.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-materials-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = new Vault(root);
  vault.createAccount("Demo_AI");
  vault.load();
  const core = {
    active: null,
    data: root,
    vault,
    store: vault.load(),
    save() {},
    reload() {
      Object.assign(this.store, vault.load());
      return this.store;
    },
  };
  return core;
}

test("finalize confirmation reads draft without ReferenceError: fs", (t) => {
  const core = fixture(t);
  core.vault.saveDoc({
    id: "a1",
    title: "定稿稿",
    account: "AI",
    body: "正文",
    conversations: [],
    snapshots: [],
  });
  core.reload();
  const step = Materials.finalize(core, "a1");
  assert.equal(step.needsConfirmation, true);
  assert.match(step.message, /已发布/);
  assert.match(step.contentSnapshot, /正文/);
  const done = Materials.finalize(core, {
    id: "a1",
    confirmed: true,
    contentSnapshot: step.contentSnapshot,
  });
  assert.equal(done.documents.length, 0);
  assert.equal(done.archives.length, 1);
});

test("readPublished reads archive without ReferenceError: fs", (t) => {
  const core = fixture(t);
  const rel = "Demo_AI/03_Archive/已发.md";
  fs.writeFileSync(core.vault.p(rel), "---\n标题: 已发\n---\n归档正文");
  const body = Groups.readPublished(core, rel);
  assert.match(body, /归档正文/);
});

test("image saves under Attachment/<draft basename> for draft and project draft", (t) => {
  const core = fixture(t);
  core.vault.saveDoc({
    id: "img1",
    title: "科普草稿",
    account: "AI",
    body: "正文",
    conversations: [],
    snapshots: [],
  });
  core.reload();
  const url = Materials.image(core, {
    articleId: "img1",
    bytes: Array.from(Buffer.from("png-bytes")),
    type: "image/png",
  });
  assert.match(
    decodeURIComponent(url),
    /Attachment\/科普草稿\/file-\d{17}\.png$/,
  );
  assert(fs.existsSync(core.vault.p("Attachment/科普草稿")));

  core.vault.createDraftProject("Demo_AI", "虾皮猫");
  core.vault.moveDraft("img1", "虾皮猫");
  core.reload();
  const url2 = Materials.image(core, {
    articleId: "img1",
    bytes: Array.from(Buffer.from("png-bytes-2")),
    type: "image/png",
  });
  assert.match(
    decodeURIComponent(url2),
    /Attachment\/科普草稿\/file-\d{17}\.png$/,
  );
  assert.equal(core.vault.index.img1.path, "Demo_AI/02_Drafts/虾皮猫/科普草稿.md");
});

test("DeskCore.image forwards articleId (does not swallow payload)", (t) => {
  const { DeskCore } = require("../desk-core.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-desk-image-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desk = new DeskCore();
  desk.data = root;
  desk.vault = new Vault(root);
  desk.vault.createAccount("Demo_AI");
  desk.store = desk.vault.load();
  desk.vault.saveDoc({
    id: "d1",
    title: "可插图",
    account: "AI",
    body: "x",
    conversations: [],
    snapshots: [],
  });
  desk.store = desk.vault.load();
  const url = desk.image({
    articleId: "d1",
    bytes: Array.from(Buffer.from("x")),
    type: "image/png",
  });
  assert.match(decodeURIComponent(url), /Attachment\/可插图\/file-\d{17}\.png$/);
});
