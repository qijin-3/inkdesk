const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let m;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "ui", "agent-store.js")],
    outfile: "/tmp/agent-store.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  m = require("/tmp/agent-store.test.cjs");
});

const st = () => ({
  agents: { cursor: {}, claude: {} },
  agentsEnabled: { claude: false },
  provider: "cursor",
  model: "",
  agentModels: { cursor: ["m1", "", "m1 "] },
});

test("installed/selectable/rail 决策", () => {
  const s = st();
  assert.equal(m.agentInstalled(s, "cursor"), true);
  assert.equal(m.agentInstalled(s, "codex"), false);
  assert.deepEqual(
    m.installedAgentProviders(s).map((p) => p.id),
    ["cursor", "claude"],
  );
  assert.deepEqual(
    m.selectableAgentProviders(s).map((p) => p.id),
    ["cursor"],
  );
  assert.equal(m.railProviderId(s), "cursor");
});

test("railProviderId 回退已选或首个", () => {
  const s = st();
  s.provider = "codex";
  assert.equal(m.railProviderId(s), "cursor");
  s.agentsEnabled = {};
  s.provider = "claude";
  assert.equal(m.railProviderId(s), "claude");
});

test("railModelLabel 三态", () => {
  const s = st();
  assert.equal(m.railModelLabel(s, "cursor"), "默认");
  s.model = "m1";
  assert.equal(m.railModelLabel(s, "cursor"), "m1");
  assert.equal(m.railModelLabel(s, "codex"), "ChatGPT");
  assert.equal(m.railModelLabel(s, "nope"), "选择模型");
  assert.equal(m.railModelLabel(s), "m1");
});

test("model list 去重清洗与建议合并", () => {
  const s = st();
  assert.deepEqual(m.getAgentModelList(s, "cursor"), ["m1", "m1 "]);
  assert.deepEqual(m.getAgentModelList(s, "codex"), []);
  m.setAgentModelList(s, "codex", [" a ", "", "a", "b"]);
  assert.deepEqual(s.agentModels.codex, ["a", "b"]);
  assert.deepEqual(m.agentSuggestionIds(s, "cursor", ["m2", "m1"]), [
    "m2",
    "m1",
    "m1 ",
  ]);
});

test("agentEnabled 缺省启用", () => {
  const s = st();
  assert.equal(m.agentEnabled(s, "cursor"), true);
  assert.equal(m.agentEnabled(s, "claude"), false);
  delete s.agentsEnabled;
  assert.equal(m.agentEnabled(s, "cursor"), true);
  assert.deepEqual(s.agentsEnabled, {});
});

test("settings 片段与 logo", () => {
  assert.match(
    m.settingsSection({ title: "T", control: "<b>c</b>" }),
    /settings-section-title/,
  );
  assert.match(m.settingsPanel("x"), /settings-panel/);
  assert.match(m.settingsField("L", "<i></i>"), /settings-field-label/);
  assert.match(m.agentLogoSvg("cursor"), /assets\/agents\/cursor\.png/);
  assert.equal(m.agentLogoSvg("unknown"), "");
});

test("agentListItemHtml 状态徽章", () => {
  const html = m.agentListItemHtml(st(), {
    id: "cursor",
    label: "Cursor",
    blurb: "b",
  });
  assert.match(html, /is-default/);
  assert.match(html, /已安装/);
  const off = m.agentListItemHtml(st(), {
    id: "claude",
    label: "C",
    blurb: "b",
  });
  assert.match(off, /已关闭/);
});

test("agentModelsPanelHtml 三态与回填", async () => {
  const st = () => ({ agents: { cursor: {}, zcode: {} }, agentsEnabled: {}, provider: "cursor", model: "", agentModels: {} });
  let html = m.agentModelsPanelHtml(st(), { id: "codex", label: "ChatGPT", blurb: "" }, null);
  assert.match(html, /安装并登录对应 CLI/);
  html = m.agentModelsPanelHtml(st(), { id: "zcode", label: "ZCode", blurb: "" }, { current: "m9" });
  assert.match(html, /m9/);
  const s = st();
  html = m.agentModelsPanelHtml(s, { id: "cursor", label: "Cursor", blurb: "" }, { models: ["m1"], source: "CLI" });
  assert.match(html, /尚未添加模型/);
  s.model = "m1";
  html = m.agentModelsPanelHtml(s, { id: "cursor", label: "Cursor", blurb: "" }, { models: ["m1"], source: "CLI" });
  assert.match(html, /使用中/);
  assert.deepEqual(s.agentModels.cursor, ["m1"]);
});
