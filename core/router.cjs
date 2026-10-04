const { Skills } = require("../skills.cjs");

const API_CHANNELS = [
  "skills-list",
  "skills-import",
  "skills-create",
  "skills-remove",
  "skills-configure",
  "skills-reveal",
  "load",
  "model-load",
  "model-save",
  "model-decide",
  "model-restore",
  "save",
  "source",
  "scan",
  "import",
  "image",
  "refresh",
  "recover-refresh",
  "finalize",
  "to-draft",
  "material-read",
  "material-add",
  "versions",
  "archive-records",
  "profile",
  "profile-save",
  "profile-read",
  "profile-role",
  "profile-simplify",
  "profile-decide",
  "project-refs",
  "project-upload",
  "project-read",
  "project-toggle",
  "copy",
  "metrics",
  "agent",
  "agent-usage",
  "agent-models",
  "agent-test",
  "cancel",
  "pick-note-table",
  "import-notes-preview",
  "import-notes-apply",
  "published-read",
  "published-backup",
  "vault-reveal",
  "vault-open",
  "draft-delete",
  "materials-list",
  "materials-read",
  "materials-delete",
  "materials-link",
  "topics-list",
  "topics-create",
  "topics-read",
  "topics-save",
  "topics-delete",
  "wechat-draft-push",
  "wechat-test-token",
  "set-vault",
  "accounts-list",
  "account-create",
  "account-register",
  "account-unregister",
  "account-folder-candidates",
  "account-set-avatar",
  "account-set-backup-path",
  "group-upsert",
  "group-delete",
  "group-set-backup-path",
  "article-set-group",
];

/**
 * 统一 API 入口，供 Electron IPC 与 HTTP 服务调用。
 * @param {string} name
 * @param {*} data
 */
async function invoke(core, name, data) {
  if (!API_CHANNELS.includes(name)) throw Error("Invalid channel");
  switch (name) {
    case "skills-list":
      return new Skills(core.vault).list(data.account);
    case "skills-import":
      return new Skills(core.vault).import(data);
    case "skills-create":
      return new Skills(core.vault).create(data);
    case "skills-remove":
      return new Skills(core.vault).remove(data);
    case "skills-configure":
      return new Skills(core.vault).configure(data);
    case "skills-reveal":
      return new Skills(core.vault).reveal(data);
    case "load":
      return core.publicState();
    case "save":
      if (!Array.isArray(data.documents) || !Array.isArray(data.metrics))
        throw Error("数据格式错误");
      {
        const next = { ...data };
        delete next._update;
        delete next._appVersion;
        delete next.agents;
        delete next.warnings;
        delete next.dataPath;
        delete next.vaultLocked;
        core.store = { ...core.store, ...next };
      }
      core.save();
      return true;
    case "set-vault":
      return core.setVault(data);
    case "accounts-list":
      return core.vault.listAccountsWithStats();
    case "account-create": {
      const name =
        typeof data === "string" ? data : data?.name || data;
      const mode = typeof data === "object" && data ? data.mode : undefined;
      core.vault.createAccount(name, { mode });
      core.reload();
      return core.publicState();
    }
    case "account-register": {
      const folder =
        typeof data === "string" ? data : data?.folder || data;
      const mode = typeof data === "object" && data ? data.mode : undefined;
      core.vault.registerAccount(folder, { mode });
      core.reload();
      return core.publicState();
    }
    case "account-unregister": {
      const removed = String(data?.id || data || "").trim();
      let accountKey = removed;
      try {
        accountKey = core.vault.resolveAccountId(removed);
      } catch {
        /* 用原始 id 清理附属配置 */
      }
      core.vault.unregisterAccount(removed);
      if (core.store.wechatAccounts?.[accountKey]) {
        delete core.store.wechatAccounts[accountKey];
        core.save();
      }
      core.reload();
      return core.publicState();
    }
    case "account-folder-candidates":
      return core.vault.listAccountFolderCandidates();
    case "account-set-avatar": {
      core.vault.setAccountAvatar(data?.id, data);
      core.reload();
      return core.publicState();
    }
    case "account-set-backup-path":
      return core.setAccountBackupPath(data?.id, data?.path);
    case "group-upsert":
      return core.upsertGroup(data);
    case "group-delete":
      return core.deleteGroup(data?.name || data);
    case "group-set-backup-path":
      return core.setGroupBackupPath(data?.name, data?.path);
    case "article-set-group":
      return core.setArticleGroup(data);
    case "published-backup":
      return core.backupPublished(data?.rel || data, data?.destDir);
    case "source":
    case "scan":
      return { root: core.vault.root, files: scan(core.vault.root) };
    case "recover-refresh":
      core.vault.writeJSON(
        core.vault.meta + "/recovery/" + Date.now() + ".json",
        data,
      );
      return core.publicState();
    case "refresh":
      core.save();
      core.reload();
      return core.publicState();
    case "import": {
      const p = within(core.vault.root, data),
        rel = path.relative(core.vault.root, p);
      if (!p.endsWith(".md")) throw Error("只支持 Markdown");
      return {
        title: path.basename(p, ".md"),
        body: core.vault.display(split(fs.readFileSync(p, "utf8")).body, rel),
        account:
          core.vault.accountFromPath(rel) ||
          core.vault.listAccountIds()[0] ||
          "",
      };
    }
    case "versions": {
      // 用磁盘最新内容刷新 cache，避免沿用过期 raw 导致误报「外部修改」
      const loaded = core.vault.load();
      return loaded.documents.find((d) => d.id === data)?.snapshots || [];
    }
    case "archive-records":
      return core.archiveRecords(data);
    case "published-read":
      return core.readPublished(data);
    case "vault-reveal":
      return core.openVaultFile(data, "reveal");
    case "vault-open":
      return core.openVaultFile(data, "open");
    case "material-read":
      return core.vault.readMaterial(data);
    case "material-add":
      return core.vault.addMaterial(data);
    case "model-load":
      return core.accountModel.load(data);
    case "model-save":
      return core.accountModel.save(data.account, data.modules, data.hash);
    case "model-decide":
      return core.accountModel.decide(
        data.account,
        data.id,
        data.apply,
        data.edits,
      );
    case "model-restore": {
      const m = core.accountModel.load(data.account),
        h = m.history.find((x) => x.id === data.id);
      if (!h) throw Error("历史版本不存在");
      return core.accountModel.save(
        data.account,
        h.modules,
        data.hash,
        "恢复历史设定",
      );
    }
    case "profile":
      return core.knowledge.profile(data);
    case "profile-read":
      return core.knowledge.readProfile(data.account, data.path);
    case "profile-save":
      return core.knowledge.saveProfile(
        data.account,
        data.path,
        data.text,
        data.hash,
      );
    case "profile-simplify":
      return core.knowledge.simple(data, core.store);
    case "profile-decide":
      return core.knowledge.decide(
        data.account,
        data.id,
        data.action,
        data.edits,
      );
    case "profile-role": {
      core.knowledge.profileFile(data.account, data.path);
      const rel =
        core.vault.meta + "/profile-config/" + data.account + ".json";
      const c = core.vault.json(rel, { active: ["Writing_Contract.md"] });
      c.active = data.enabled
        ? [...new Set([...c.active, data.path])]
        : c.active.filter((x) => x !== data.path);
      c.simplified = true;
      core.vault.writeJSON(rel, c);
      return core.knowledge.profile(data.account);
    }
    case "project-refs":
      return core.knowledge.refs(typeof data === "string" ? data : data.id);
    case "project-read":
      return core.knowledge.refText(data.articleId, data.id);
    case "project-toggle":
      return core.knowledge.toggle(data.articleId, data.id, data.enabled);
    case "project-upload":
      return core.projectUpload(data);
    case "draft-delete":
      return core.deleteDraft(data);
    case "materials-list":
      return core.listMaterials(data);
    case "materials-read":
      return core.knowledge.materialText(data);
    case "materials-delete":
      return core.knowledge.deleteMaterial(data);
    case "materials-link":
      return core.knowledge.linkMaterial(data.articleId, data.id);
    case "topics-list":
      return core.vault.topics(data?.account ?? data);
    case "topics-create":
      return core.vault.createTopic(data.account, data);
    case "topics-read":
      return core.vault.readTopic(data?.path ?? data);
    case "topics-save":
      return core.vault.updateTopic(data.path, data);
    case "topics-delete":
      return core.vault.deleteTopic(data?.path ?? data);
    case "finalize":
      return core.finalize(data);
    case "to-draft":
      return core.toDraft(data);
    case "image":
      return core.image(data);
    case "copy":
      return true;
    case "metrics": {
      const result = core.vault.load();
      core.store.metrics = result.metrics;
      core.store.archives = result.archives;
      return result.metrics;
    }
    case "cancel":
      core.cancelAgent(data?.conversationId || data?.conversation_id || "default");
      return true;
    case "agent":
      return core.runAgent(data);
    case "agent-usage":
      return core.agentUsage.snapshot(data);
    case "agent-models":
      return core.listAgentModels(data);
    case "agent-test":
      return core.testAgentConnection(data);
    case "pick-note-table":
      return null;
    case "import-notes-preview":
      return core.importNotesPreview(data);
    case "import-notes-apply":
      return core.importNotesApply(data);
    case "wechat-draft-push":
      return core.pushWechatDraft(data);
    case "wechat-test-token":
      return core.testWechatToken(data);
    default:
      throw Error("Unknown channel: " + name);
  }
}

module.exports = { invoke, API_CHANNELS };
