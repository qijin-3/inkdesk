/**
 * 读取已发布（03_Archive）文章正文，供仪表盘预览。
 * @param {string} rel vault 相对路径
 */
function readPublished(core, rel) {
  if (
    typeof rel !== "string" ||
    !rel.includes("/03_Archive/") ||
    !rel.endsWith(".md")
  )
    throw Error("不是已发布文章");
  within(core.vault.root, core.vault.p(rel));
  const { body } = split(fs.readFileSync(core.vault.p(rel), "utf8"));
  return core.vault.display(body, rel);
}

/**
 * 设置或清除账号的本地备份默认目录。
 * @param {string} id
 * @param {string} [dirPath] 空则清除
 */
function setAccountBackupPath(core, id, dirPath) {
  const accountId = core.vault.resolveAccountId(id);
  if (!core.store.backupPaths) core.store.backupPaths = {};
  if (!dirPath) {
    delete core.store.backupPaths[accountId];
  } else {
    if (typeof dirPath !== "string") throw Error("请选择有效的文件夹");
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
      throw Error("请选择有效的文件夹");
    core.store.backupPaths[accountId] = fs.realpathSync(dirPath);
  }
  core.save();
  return core.publicState();
}

/**
 * 规范化分组名称。
 * @param {unknown} name
 * @returns {string}
 */
function normalizeGroupName(core, name) {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) throw Error("请填写分组名称");
  if (n.length > 40) throw Error("分组名称过长");
  if (/[/\\]/.test(n)) throw Error("分组名称不能包含路径分隔符");
  return n;
}

/**
 * 新建或重命名分组；可同时写入备份路径。
 * @param {{ name: string, oldName?: string, backupPath?: string }} data
 */
function upsertGroup(core, data) {
  const name = core.normalizeGroupName(data?.name);
  if (!core.store.groups) core.store.groups = {};
  const oldName =
    typeof data?.oldName === "string" && data.oldName.trim()
      ? data.oldName.trim()
      : "";
  let entry = { backupPath: "" };
  if (oldName && oldName !== name) {
    if (!core.store.groups[oldName]) throw Error("原分组不存在");
    if (core.store.groups[name]) throw Error("目标分组名称已存在");
    entry = { ...core.store.groups[oldName] };
    delete core.store.groups[oldName];
    core.vault.renameArticleGroup(oldName, name);
  } else if (core.store.groups[name]) {
    entry = { ...core.store.groups[name] };
  }
  if (data?.backupPath != null) {
    const dirPath = String(data.backupPath || "").trim();
    if (!dirPath) entry.backupPath = "";
    else {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
        throw Error("请选择有效的文件夹");
      entry.backupPath = fs.realpathSync(dirPath);
    }
  }
  core.store.groups[name] = {
    backupPath: entry.backupPath || "",
  };
  core.save();
  core.reload();
  return core.publicState();
}

/**
 * 删除分组定义（文章上的分组标签保留为普通文本）。
 * @param {string} name
 */
function deleteGroup(core, name) {
  const n = core.normalizeGroupName(name);
  if (!core.store.groups?.[n]) throw Error("分组不存在");
  delete core.store.groups[n];
  core.save();
  return core.publicState();
}

/**
 * 设置或清除分组的本地同步默认目录。
 * @param {string} name
 * @param {string} [dirPath] 空则清除
 */
function setGroupBackupPath(core, name, dirPath) {
  const n = core.normalizeGroupName(name);
  if (!core.store.groups) core.store.groups = {};
  if (!core.store.groups[n]) core.store.groups[n] = { backupPath: "" };
  if (!dirPath) {
    core.store.groups[n].backupPath = "";
  } else {
    if (typeof dirPath !== "string") throw Error("请选择有效的文件夹");
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
      throw Error("请选择有效的文件夹");
    core.store.groups[n].backupPath = fs.realpathSync(dirPath);
  }
  core.save();
  return core.publicState();
}

/**
 * 为草稿或已发布文章设置分组标签。
 * @param {{ id?: string, paths?: string|string[], group?: string|null }} data
 */
function setArticleGroup(core, data) {
  const group =
    data?.group == null || data.group === ""
      ? null
      : core.normalizeGroupName(data.group);
  if (group && !core.store.groups?.[group]) {
    if (!core.store.groups) core.store.groups = {};
    core.store.groups[group] = { backupPath: "" };
  }
  const paths = (
    Array.isArray(data?.paths) ? data.paths : data?.paths ? [data.paths] : []
  ).filter((p) => typeof p === "string" && p);
  if (data?.id) {
    const doc = (core.store.documents || []).find((d) => d.id === data.id);
    if (!doc) throw Error("草稿不存在");
    doc.group = group;
    core.vault.saveDoc(doc);
  }
  for (const rel of paths) core.vault.setMarkdownGroup(rel, group);
  core.save();
  core.reload();
  return core.publicState();
}

/**
 * 将已发布文章 Markdown 复制到本地目录（覆盖同名文件）。
 * @param {string} rel vault 相对路径
 * @param {string} destDir 目标文件夹绝对路径
 */
function backupPublished(core, rel, destDir) {
  if (
    typeof rel !== "string" ||
    !rel.includes("/03_Archive/") ||
    !rel.endsWith(".md")
  )
    throw Error("不是已发布文章");
  if (typeof destDir !== "string" || !destDir.trim())
    throw Error("请选择备份目录");
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory())
    throw Error("备份目录不存在");
  const from = within(core.vault.root, core.vault.p(rel));
  if (!fs.existsSync(from)) throw Error("文件不存在");
  const name = path.basename(rel);
  const dest = path.join(fs.realpathSync(destDir), name);
  fs.copyFileSync(from, dest);
  return { path: dest, name };
}

/**
 * 在 Finder 中定位或用系统默认应用打开 vault 内 Markdown。
 * @param {string} rel vault 相对路径
 * @param {"reveal"|"open"} mode
 */
function openVaultFile(core, rel, mode) {
  if (typeof rel !== "string" || !rel.endsWith(".md"))
    throw Error("无效路径");
  const abs = within(core.vault.root, core.vault.p(rel));
  if (!fs.existsSync(abs)) throw Error("文件不存在");
  if (process.platform !== "darwin") throw Error("当前仅支持 macOS");
  const { execFileSync } = require("node:child_process");
  execFileSync("open", mode === "reveal" ? ["-R", abs] : [abs]);
  return abs;
}

/** 读取归档文章的版本与对话 */
function archiveRecords(core, rel) {
  const found = Object.entries(core.vault.index).find(
    ([, v]) => v.path === rel && v.status === "archive",
  );
  if (!found) return { versions: [], conversations: [], materials: [] };
  const id = found[0],
    read = (folder, extension) => {
      const dir = core.vault.p(core.vault.meta + "/" + folder + "/" + id);
      return fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((n) => n.endsWith(extension))
            .map((n) => fs.readFileSync(path.join(dir, n), "utf8"))
        : [];
    };
  return {
    versions: read("versions", ".md").map((raw) => {
      const v = split(raw);
      return {
        name: v.yaml.get("版本名称"),
        at: v.yaml.get("版本时间"),
        body: v.body,
      };
    }),
    conversations: read("conversations", ".json").map(JSON.parse),
    materials:
      core.vault.json(core.vault.meta + "/articles/" + id + ".json", {})
        .materials || [],
  };
}
module.exports = {
  readPublished,
  setAccountBackupPath,
  normalizeGroupName,
  upsertGroup,
  deleteGroup,
  setGroupBackupPath,
  setArticleGroup,
  backupPublished,
  openVaultFile,
  archiveRecords,
};
