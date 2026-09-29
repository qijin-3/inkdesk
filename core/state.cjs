const fs = require("node:fs");
const path = require("node:path");
const { Vault, split } = require("../vault.cjs");
const { Knowledge } = require("../knowledge.cjs");
const { AccountModel } = require("../account-model.cjs");
const { AgentUsage } = require("../agent-usage.cjs");
const { within, scan } = require("../core.cjs");
const defaults = require("./defaults.cjs");

/**
 * 初始化应用数据目录与 Content_OS 仓库。
 * 仓库路径：INKDESK_VAULT > INKDESK_DATA/Content_OS > workspace.json vaultPath > vault.json。
 * @param {{ dataDir: string, projectDir: string, readerPath: string }} options
 */
function init(core, options) {
  const { dataDir, projectDir, readerPath } = options;
  core.data = path.resolve(dataDir);
  core.agentUsage = new AgentUsage(core.data);
  core.projectDir = projectDir;
  core.readerPath = readerPath;
  fs.mkdirSync(path.join(core.data, "assets"), { recursive: true });
  try {
    const loaded = JSON.parse(
      fs.readFileSync(path.join(core.data, "workspace.json"), "utf8"),
    );
    core.store = {
      ...structuredClone(defaults),
      ...loaded,
      followers: {
        ...defaults.followers,
        ...(loaded.followers || {}),
      },
      metricDeltas: {
        ...defaults.metricDeltas,
        ...(loaded.metricDeltas || {}),
      },
      backupPaths: {
        ...defaults.backupPaths,
        ...(loaded.backupPaths || {}),
      },
      groups: {
        ...defaults.groups,
        ...(loaded.groups || {}),
      },
      agentModels: {
        ...defaults.agentModels,
        ...(loaded.agentModels || {}),
      },
      agentsEnabled: {
        ...defaults.agentsEnabled,
        ...(loaded.agentsEnabled || {}),
      },
      wechatAccounts: {
        ...defaults.wechatAccounts,
        ...(loaded.wechatAccounts || {}),
      },
      wechat: {
        ...defaults.wechat,
        ...(loaded.wechat || {}),
      },
    };
    delete core.store.githubToken;
  } catch (e) {
    if (fs.existsSync(path.join(core.data, "workspace.json"))) throw e;
    core.store = structuredClone(defaults);
  }
  const root = core.resolveVaultRoot();
  if (!root)
    throw Error(
      "请先在设置中选择内容仓库，或配置 vault.json / INKDESK_VAULT",
    );
  core.bindVault(root);
  if (core.store.documents?.length) {
    const old = path.join(core.data, "workspace.json");
    if (fs.existsSync(old) && !fs.existsSync(old + ".v1-backup"))
      fs.copyFileSync(old, old + ".v1-backup");
    for (const doc of core.store.documents) {
      doc.conversations ||= [
        {
          id: require("node:crypto").randomUUID(),
          title: "历史对话",
          messages: doc.chat || [],
        },
      ];
      core.vault.saveDoc(doc);
    }
  }
  core.reload();
  core.save();
  return this;
}

/**
 * 绑定 Content_OS 仓库并重建依赖它的服务。
 * @param {string} root
 */
function bindVault(core, root) {
  core.vault = new Vault(root, path.join(core.data, "assets"));
  core.knowledge = new Knowledge(core.vault, core.readerPath);
  core.accountModel = new AccountModel(core.vault, core.knowledge);
}

/**
 * 解析 Content_OS 根目录：环境变量 > 用户选择 > 项目默认配置。
 * @returns {string|undefined}
 */
function resolveVaultRoot(core) {
  if (process.env.INKDESK_VAULT) return process.env.INKDESK_VAULT;
  if (process.env.INKDESK_DATA) return path.join(core.data, "Content_OS");
  if (core.store?.vaultPath) return core.store.vaultPath;
  const vaultFile = path.join(core.projectDir, "vault.json");
  if (fs.existsSync(vaultFile)) {
    const config = JSON.parse(fs.readFileSync(vaultFile, "utf8"));
    if (config.vaultPath) return config.vaultPath;
  }
  const legacyFile = path.join(core.projectDir, "development-vault.json");
  if (fs.existsSync(legacyFile)) {
    const config = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
    return config.vaultPath || config.developmentVault;
  }
}

/**
 * 当前仓库是否由环境变量锁定（测试/CI）。
 * @returns {boolean}
 */
function vaultLockedByEnv(core) {
  return !!(process.env.INKDESK_VAULT || process.env.INKDESK_DATA);
}

/**
 * 切换用户选定的内容仓库并重新加载。
 * @param {string} root 文件夹绝对路径
 */
function setVault(core, root) {
  if (core.vaultLockedByEnv())
    throw Error("当前仓库由环境变量指定，无法在设置中更改");
  if (!root || typeof root !== "string") throw Error("请选择有效的文件夹");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    throw Error("请选择有效的文件夹");
  if (core.active) throw Error("请等待 AI 完成后再切换仓库");
  const real = fs.realpathSync(root);
  if (core.vault) core.save();
  core.store.vaultPath = real;
  core.bindVault(real);
  core.reload();
  core.save();
  return core.publicState();
}

/**
 * 返回前端可用的完整状态快照。
 */
function publicState(core) {
  const accounts = core.vault?.listAccountsWithStats?.() || [];
  return {
    ...core.store,
    followers: core.store.followers || {},
    metricDeltas: core.store.metricDeltas || {},
    backupPaths: core.store.backupPaths || {},
    groups: core.store.groups || {},
    wechatAccounts: core.publicWechatAccounts(),
    wechat: {
      appId: core.store.wechat?.appId || "",
      appSecret: core.store.wechat?.appSecret || "",
      author: core.store.wechat?.author || "",
      coverPath: core.store.wechat?.coverPath || "",
    },
    dataPath: core.data,
    vaultPath: core.vault?.root || core.store.vaultPath || "",
    source: core.vault?.root || core.store.source || "",
    vaultLocked: core.vaultLockedByEnv(),
    accounts,
    agents: {
      cursor: !!core.executable("cursor"),
      codex: !!core.executable("codex"),
      claude: !!core.executable("claude"),
      zcode: !!core.executable("zcode"),
      opencode: !!core.executable("opencode"),
      antigravity: !!core.executable("antigravity"),
    },
  };
}

/** 持久化 workspace 设置与各文档 */
function save(core) {
  for (const doc of core.store.documents || []) core.vault.saveDoc(doc);
  const settings = {
    version: 2,
    vaultPath: core.store.vaultPath || core.vault?.root || "",
    provider: core.store.provider,
    model: core.store.model,
    agentModels: core.store.agentModels || {},
    agentsEnabled: core.store.agentsEnabled || {},
    followers: core.store.followers || {},
    metricDeltas: core.store.metricDeltas || {},
    backupPaths: core.store.backupPaths || {},
    groups: core.store.groups || {},
    wechatAccounts: core.publicWechatAccounts(),
    wechat: {
      appId: core.store.wechat?.appId || "",
      appSecret: core.store.wechat?.appSecret || "",
      author: core.store.wechat?.author || "",
      coverPath: core.store.wechat?.coverPath || "",
    },
  };
  fs.mkdirSync(core.data, { recursive: true });
  const p = path.join(core.data, "workspace.json");
  fs.writeFileSync(p + ".tmp", JSON.stringify(settings, null, 2));
  fs.renameSync(p + ".tmp", p);
}

/** 从 Vault 重新加载状态 */
function reload(core) {
  Object.assign(core.store, core.vault.load());
  return core.store;
}

/** 解析 inkasset 本地资源路径 */
function allowedAsset(core, p) {
  const base = path.join(core.data, "assets");
  return within(base, p);
}

/** 解析 Vault 内资源路径 */
function vaultAsset(core, rel) {
  return within(core.vault.root, core.vault.p(rel));
}

/** 同步保存（页面卸载时） */
function saveSync(core, next) {
  if (!Array.isArray(next.documents) || !Array.isArray(next.metrics))
    throw Error("Invalid state");
  core.store = { ...core.store, ...next };
  core.save();
  return true;
}
module.exports = {
  init,
  bindVault,
  resolveVaultRoot,
  vaultLockedByEnv,
  setVault,
  publicState,
  save,
  reload,
  allowedAsset,
  vaultAsset,
  saveSync,
};
