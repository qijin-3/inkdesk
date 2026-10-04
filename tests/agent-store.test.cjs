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
  agents: { codex: {}, claude: {} },
  agentsEnabled: { claude: false },
  provider: "codex",
  model: "",
  agentModels: { codex: ["m1", "", "m1 "] },
  agentHttp: {},
});

test("installed/selectable/rail 决策", () => {
  const s = st();
  assert.equal(m.agentInstalled(s, "codex"), true);
  assert.equal(m.agentInstalled(s, "opencode"), false);
  assert.deepEqual(
    m.installedAgentProviders(s).map((p) => p.id),
    ["codex", "claude"],
  );
  assert.deepEqual(
    m.selectableAgentProviders(s).map((p) => p.id),
    ["codex"],
  );
  assert.equal(m.railProviderId(s), "codex");
});

test("railProviderId 回退已选或首个", () => {
  const s = st();
  s.provider = "missing";
  assert.equal(m.railProviderId(s), "codex");
  s.agentsEnabled = {};
  assert.equal(m.agentEnabled(s, "claude"), true);
  assert.equal(m.railProviderId(s), "codex");
});

test("railModelLabel 三态", () => {
  const s = st();
  assert.equal(m.railModelLabel(s, "codex"), "默认");
  s.model = "m1";
  assert.equal(m.railModelLabel(s, "codex"), "m1");
  assert.equal(m.railModelLabel(s, "claude"), "Claude Code");
});

test("model list 去重清洗与建议合并", () => {
  const s = st();
  assert.deepEqual(m.getAgentModelList(s, "codex"), ["m1", "m1 "]);
  m.setAgentModelList(s, "codex", [" m1 ", "m2", "m1", ""]);
  assert.deepEqual(m.getAgentModelList(s, "codex"), ["m1", "m2"]);
  assert.deepEqual(m.agentSuggestionIds(s, "codex", ["m2", "m1"]), [
    "m2",
    "m1",
  ]);
});

test("agentEnabled 缺省启用", () => {
  const s = st();
  assert.equal(m.agentEnabled(s, "codex"), true);
  assert.equal(m.agentEnabled(s, "claude"), false);
  delete s.agentsEnabled;
  assert.equal(m.agentEnabled(s, "codex"), true);
  assert.deepEqual(s.agentsEnabled, {});
});

test("settings 片段与 logo", () => {
  assert.match(m.settingsSection({ title: "T", control: "C" }), /settings-section-title/);
  assert.match(m.settingsPanel("x"), /settings-panel/);
  assert.match(m.agentLogoSvg("codex"), /assets\/agents\/codex\.png/);
  assert.equal(m.agentLogoSvg("unknown"), "");
});

test("agentListItemHtml 状态徽章", () => {
  const html = m.agentListItemHtml(st(), {
    id: "codex",
    label: "ChatGPT",
    blurb: "b",
  });
  assert.match(html, /is-default/);
  assert.match(html, /已安装/);
  assert.match(html, /<strong>ChatGPT<\/strong>/);
  assert.match(html, /data-open-agent="codex"/);
  const off = m.agentListItemHtml(st(), {
    id: "claude",
    label: "C",
    blurb: "b",
  });
  assert.match(off, /已关闭/);
});

// 回归：map 回调签名是 (st, p)，不可写成 .map(agentListItemHtml)
test("agentListItemHtml 列表需显式传 state", () => {
  const html = m.AGENT_PROVIDERS.map((p) => m.agentListItemHtml(st(), p)).join("");
  for (const p of m.AGENT_PROVIDERS) {
    assert.match(html, new RegExp(`data-open-agent="${p.id}"`));
    assert.match(html, new RegExp(`<strong>${p.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</strong>`));
  }
  const broken = m.AGENT_PROVIDERS.map(m.agentListItemHtml).join("");
  assert.doesNotMatch(broken, /data-open-agent="codex"/);
  assert.doesNotMatch(broken, /<strong>ChatGPT<\/strong>/);
});

test("connectedAgentProviders 含 HTTP 已添加项，不含 cursor/zcode", () => {
  const s = st();
  s.agentHttp = { openai: { baseURL: "https://api.openai.com/v1", apiKey: "" } };
  const ids = m.connectedAgentProviders(s).map((p) => p.id);
  assert.ok(ids.includes("codex"));
  assert.ok(ids.includes("openai"));
  assert.ok(!ids.includes("cursor"));
  assert.ok(!ids.includes("zcode"));
  assert.equal(m.providerMeta(s, "openai")?.http, true);
  assert.equal(m.providerMeta(s, "openai")?.label, "OpenAI");
});

test("agentModelsPanelHtml 三态与回填", async () => {
  const st = () => ({ agents: { codex: {}, opencode: {} }, agentsEnabled: {}, provider: "codex", model: "", agentModels: {}, agentHttp: {} });
  let html = m.agentModelsPanelHtml(st(), { id: "claude", label: "Claude Code", blurb: "" }, null);
  assert.match(html, /安装并登录对应 CLI/);
  html = m.agentModelsPanelHtml(st(), { id: "opencode", label: "OpenCode", blurb: "" }, { current: "m9", selectable: false });
  assert.match(html, /m9/);
  const s = st();
  html = m.agentModelsPanelHtml(s, { id: "codex", label: "ChatGPT", blurb: "" }, { models: ["m1"], source: "CLI" });
  assert.match(html, /尚未添加模型/);
  s.model = "m1";
  html = m.agentModelsPanelHtml(s, { id: "codex", label: "ChatGPT", blurb: "" }, { models: ["m1"], source: "CLI" });
  assert.match(html, /m1/);
});
