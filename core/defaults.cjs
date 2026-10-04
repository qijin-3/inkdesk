const defaults = {
  documents: [],
  metrics: [],
  source: "",
  provider: "codex",
  model: "",
  /** 对话模板（assets/agents/templates.json），空为默认 */
  templateId: "",
  /** 各 Agent 用户收藏的模型 ID 列表 */
  agentModels: {},
  /** HTTP 直调配置：providerId → { baseURL, apiKey, models? }（Key 脱敏显示，不进日志） */
  agentHttp: {},
  /**
   * 各 Agent 是否在对话中可选：providerId → boolean
   * 缺省视为启用；关闭后仍可在设置中配置，但不出现在对话模型选择器中。
   */
  agentsEnabled: {},
  followers: {},
  metricDeltas: {},
  /** 各账号已发布文章的本地备份默认目录（无分组时回退） */
  backupPaths: {},
  /**
   * 文章分组：名称 → { backupPath? }
   * 本地同步默认路径优先按文章「分组」字段解析。
   */
  groups: {},
  /**
   * 各账号的公众号同步凭证：accountId → { appId, appSecret, author, coverPath }
   * 旧版全局 wechat 仅作迁移回退，新写入一律进 wechatAccounts。
   */
  wechatAccounts: {},
  wechat: {
    appId: "",
    appSecret: "",
    author: "",
    coverPath: "",
  },
  /** 用户选定的 Content_OS 仓库路径 */
  vaultPath: "",
};

module.exports = defaults;
