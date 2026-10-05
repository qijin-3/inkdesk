const Wechat = require("./core/wechat.cjs");
const Agents = require("./core/agents.cjs");
const State = require("./core/state.cjs");
const Materials = require("./core/materials.cjs");
const Groups = require("./core/groups.cjs");
const Notes = require("./core/notes.cjs");

/** 与 preload 一致的 API 通道名 */
const { invoke, API_CHANNELS } = require("./core/router.cjs");

/**
 * Aster* 共享业务层：Vault、人设、Agent 等与 UI 无关的逻辑。
 */
class DeskCore {
  constructor() {
    this.active = null;
    this.data = null;
    this.projectDir = null;
    this.readerPath = null;
    this.store = null;
    this.vault = null;
    this.knowledge = null;
    this.accountModel = null;
    this.onAgentProgress = null;
    this.onAgentEvent = null;
    /** @type {Record<string, { token?: string, expiresAt?: number }>} appId → token cache */
    this.wechatTokenCache = {};
  }

  init(options) { return State.init(this, options); }
  bindVault(root) { return State.bindVault(this, root); }
  resolveVaultRoot() { return State.resolveVaultRoot(this); }
  vaultLockedByEnv() { return State.vaultLockedByEnv(this); }
  setVault(root) { return State.setVault(this, root); }
  publicState() { return State.publicState(this); }
  save() { return State.save(this); }
  reload() { return State.reload(this); }
  allowedAsset(p) { return State.allowedAsset(this, p); }
  vaultAsset(rel) { return State.vaultAsset(this, rel); }
  saveSync(next) { return State.saveSync(this, next); }

  agentPathDirs() { return Agents.agentPathDirs(this); }
  findOnPath(names) { return Agents.findOnPath(this, names); }
  executable(provider) { return Agents.executable(this, provider); }
  zcodeLaunch(exe) { return Agents.zcodeLaunch(this, exe); }
  agentEnv(extra = {}) { return Agents.agentEnv(this, extra); }
  async runCliCapture(cmd, args, opts = {}) { return Agents.runCliCapture(this, cmd, args, opts); }
  parseModelLines(text) { return Agents.parseModelLines(this, text); }
  zcodeCurrentModel() { return Agents.zcodeCurrentModel(this); }
  async listAgentModels(data = {}) { return Agents.listAgentModels(this, data); }
  normalizeProvider(raw) { return Agents.normalizeProvider(this, raw); }
  agentWorkDir() { return Agents.agentWorkDir(this); }
  agentInvokeSpec(provider, exe, prompt, model, cwd) { return Agents.agentInvokeSpec(this, provider, exe, prompt, model, cwd); }
  spawnAgent(spec, opts) { return Agents.spawnAgent(this, spec, opts); }
  cancelAgent(conversationId) { return Agents.cancelAgent(this, conversationId); }
  async testAgentConnection(data = {}) { return Agents.testAgentConnection(this, data); }


  async invoke(name, data) { return invoke(this, name, data); }

  importNotesPreview(payload) { return Notes.importNotesPreview(this, payload); }
  sameAccount(a, b) { return Notes.sameAccount(this, a, b); }
  snapshotAccountMetrics(account) { return Notes.snapshotAccountMetrics(this, account); }
  importNotesApply(payload) { return Notes.importNotesApply(this, payload); }

  readPublished(rel) { return Groups.readPublished(this, rel); }
  setAccountBackupPath(id, dirPath) { return Groups.setAccountBackupPath(this, id, dirPath); }
  normalizeGroupName(name) { return Groups.normalizeGroupName(this, name); }
  upsertGroup(data) { return Groups.upsertGroup(this, data); }
  deleteGroup(name) { return Groups.deleteGroup(this, name); }
  setGroupBackupPath(name, dirPath) { return Groups.setGroupBackupPath(this, name, dirPath); }
  setArticleGroup(data) { return Groups.setArticleGroup(this, data); }
  backupPublished(rel, destDir) { return Groups.backupPublished(this, rel, destDir); }
  openVaultFile(rel, mode) { return Groups.openVaultFile(this, rel, mode); }
  archiveRecords(rel) { return Groups.archiveRecords(this, rel); }

  listMaterials(data) { return Materials.listMaterials(this, data); }
  deleteDraft(id) { return Materials.deleteDraft(this, id); }
  listDraftProjects(data) { return Materials.listDraftProjects(this, data); }
  createDraftProject(data) { return Materials.createDraftProject(this, data); }
  deleteDraftProject(data) { return Materials.deleteDraftProject(this, data); }
  moveDraft(data) { return Materials.moveDraft(this, data); }
  projectUpload(payload) { return Materials.projectUpload(this, payload); }
  finalize(payload) { return Materials.finalize(this, payload); }
  toDraft(rel) { return Materials.toDraft(this, rel); }
  image(payload = {}) { return Materials.image(this, payload); }

  runAgent(req, onProgress) { return Agents.runAgent(this, req, onProgress); }

    publicWechatAccounts() { return Wechat.publicWechatAccounts(this); }
  async testWechatToken(payload = {}) { return Wechat.testWechatToken(this, payload); }
  async pushWechatDraft(payload) { return Wechat.pushWechatDraft(this, payload); }
  loadWechatImageBuffer(src) { return Wechat.loadWechatImageBuffer(this, src); }
  wechatTokenBucket(appId) { return Wechat.wechatTokenBucket(this, appId); }
  wechatConfig(accountId) { return Wechat.wechatConfig(this, accountId); }
  resolveWechatImageSrc(src) { return Wechat.resolveWechatImageSrc(this, src); }
}

module.exports = { DeskCore, API_CHANNELS };
