const assert = require("node:assert");
const { test } = require("node:test");
const { makeEvent, summarizeArgs, toolDisplayName } = require("../core/agent-events.cjs");
const { getProvider, isHttp } = require("../core/providers.cjs");
const { AgentOutput } = require("../agent-output.cjs");
test("events helpers", () => {
  assert.equal(makeEvent("text_delta", { text: "hi" }).type, "text_delta");
  assert.equal(toolDisplayName("read"), "读取文件");
  assert.ok(summarizeArgs({ a: 1 }).includes("a"));
});
test("providers registry cli+http", () => {
  const core = { vault: { load: () => ({}) } };
  assert.equal(getProvider(core, "codex").kind, "cli");
  assert.ok(isHttp(core, "openai"));
});
test("AgentOutput emits text_delta + tool_start", () => {
  const evts = [];
  const d = new AgentOutput("cursor", null, (e) => evts.push(e));
  d.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }, { type: "tool_use", id: "t1", name: "read", input: { p: 1 } }] } }) + "\n");
  assert.ok(evts.some((e) => e.type === "text_delta" && e.text === "hello"));
  assert.ok(evts.some((e) => e.type === "tool_start"));
});
test("templates valid", () => {
  const t = require("../assets/agents/templates.json");
  assert.ok(t.templates.length >= 3);
});
test("http registry reads store.agentHttp extras", () => {
  const { registry, migrateAgentHttp } = require("../core/providers.cjs");
  const m = registry({ store: { agentHttp: { "my-llm": { baseURL: "http://x/v1" } } } });
  assert.equal(m.get("my-llm").kind, "http");
  assert.equal(m.get("codex").kind, "cli");
  assert.deepEqual(migrateAgentHttp({ "openai-api": { apiKey: "k" } }).openai.apiKey, "k");
});
test("listAgentModels http needs no CLI", async () => {
  const Agents = require("../core/agents.cjs");
  const core = { store: { agentHttp: {} }, modelCatalogs: new Map(), modelQueries: new Map(),
    normalizeProvider: (r) => Agents.normalizeProvider({ store: {} }, r),
    executable: () => null };
  const r = await Agents.listAgentModels(core, { provider: "deepseek" });
  assert.ok(r.models.includes("deepseek-chat"));
  assert.equal(r.source, "HTTP 预置");
});
test("runAgent http without key throws", () => {
  const Agents = require("../core/agents.cjs");
  const core = { store: { agentHttp: {} }, sessions: new Map(),
    normalizeProvider: (r) => Agents.normalizeProvider({ store: {} }, r) };
  assert.throws(() => Agents.runAgent(core, { provider: "openai" }), /API Key/);
});
test("providers catalog from models.dev", () => {
  const { loadCatalog, catalogEntry } = require("../core/providers.cjs");
  const c = loadCatalog();
  assert.ok(c.providers.length > 50);
  assert.equal(catalogEntry("openai").name, "OpenAI");
  assert.equal(catalogEntry("opencode-go").family, "openai");
});
test("cancelAgent kills active child", () => {
  const Agents = require("../core/agents.cjs");
  let killed = "";
  const core = { sessions: new Map(), active: { kill: (s) => { killed = s; } } };
  assert.equal(Agents.cancelAgent(core, "x"), true);
  assert.equal(killed, "SIGTERM");
});
test("template ids match templates.json", () => {
  const t = require("../assets/agents/templates.json");
  const ids = new Set(t.templates.map((x) => x.id));
  for (const id of ["polish", "review", "qa", "plan"]) assert.ok(ids.has(id));
});
