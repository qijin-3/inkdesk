const fs = require("node:fs");
const path = require("node:path");

const CLI_PROVIDERS = ["cursor", "codex", "claude", "zcode", "opencode", "antigravity"];
/** 旧 workspace.json 里的 HTTP id → models.dev id */
const HTTP_ALIASES = {
  "openai-api": "openai",
  "anthropic-api": "anthropic",
  "deepseek-api": "deepseek",
};

const HTTP_PRESETS = [
  { id: "openai", label: "OpenAI", kind: "http", family: "openai", baseURL: "https://api.openai.com/v1", models: ["gpt-4o", "gpt-4o-mini"], keyEnv: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", kind: "http", family: "anthropic", baseURL: "https://api.anthropic.com", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], keyEnv: "ANTHROPIC_API_KEY" },
  { id: "deepseek", label: "DeepSeek", kind: "http", family: "openai", baseURL: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], keyEnv: "DEEPSEEK_API_KEY" },
  { id: "openrouter", label: "OpenRouter", kind: "http", family: "openai", baseURL: "https://openrouter.ai/api/v1", models: [], keyEnv: "OPENROUTER_API_KEY" },
];

let _catalog;
function loadCatalog() {
  if (_catalog) return _catalog;
  try {
    _catalog = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "assets", "agents", "providers-catalog.json"), "utf8"),
    );
  } catch {
    _catalog = { popular: [], providers: [], custom: { id: "_custom", name: "自定义 OpenAI 兼容提供商" } };
  }
  return _catalog;
}

function catalogEntry(id) {
  return loadCatalog().providers.find((p) => p.id === String(id || "")) || null;
}

function migrateAgentHttp(agentHttp) {
  if (!agentHttp || typeof agentHttp !== "object") return {};
  const next = { ...agentHttp };
  for (const [oldId, newId] of Object.entries(HTTP_ALIASES)) {
    if (!next[oldId]) continue;
    if (!next[newId]) next[newId] = next[oldId];
    delete next[oldId];
  }
  return next;
}

function normalizeHttpId(id) {
  const raw = String(id || "");
  return HTTP_ALIASES[raw] || raw;
}

function registry(core) {
  // ponytail: presets + models.dev catalog + store.agentHttp extras
  const map = new Map();
  for (const id of CLI_PROVIDERS) map.set(id, { id, kind: "cli", label: id });
  for (const p of HTTP_PRESETS) map.set(p.id, p);
  for (const p of loadCatalog().providers) {
    if (map.has(p.id)) continue;
    map.set(p.id, {
      id: p.id,
      label: p.name,
      kind: "http",
      family: p.family || "openai",
      baseURL: p.api || "",
      models: p.models || [],
      keyEnv: p.env?.[0] || "",
    });
  }
  for (const [id, cfg] of Object.entries(core.store?.agentHttp || {})) {
    if (map.has(id)) continue;
    map.set(id, {
      id,
      label: cfg?.label || id,
      kind: "http",
      family: cfg?.family || "openai",
      baseURL: cfg?.baseURL || "",
      models: cfg?.models || [],
    });
  }
  return map;
}

function getProvider(core, id) {
  return registry(core).get(normalizeHttpId(id)) || null;
}

function isHttp(core, id) {
  return getProvider(core, id)?.kind === "http";
}

module.exports = {
  CLI_PROVIDERS,
  HTTP_PRESETS,
  HTTP_ALIASES,
  loadCatalog,
  catalogEntry,
  migrateAgentHttp,
  normalizeHttpId,
  registry,
  getProvider,
  isHttp,
};
