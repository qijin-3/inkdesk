/**
 * 列出素材库，并用当前草稿标题补全引用信息。
 * @param {string|{ account?: string }} [data]
 */
function listMaterials(core, data) {
  const account =
    typeof data === "string" ? data : data?.account || undefined;
  const list = core.knowledge.allMaterials(account);
  const titles = Object.fromEntries(
    (core.store.documents || []).map((d) => [d.id, d.title]),
  );
  return list.map((m) => ({
    ...m,
    usedBy: (m.usedBy || []).map((u) => ({
      ...u,
      title: titles[u.id] || u.title,
    })),
  }));
}

/**
 * 删除草稿并刷新工作区状态。
 * @param {string} id
 */
function deleteDraft(core, id) {
  if (core.active) throw Error("请等待 AI 完成后再删除");
  core.save();
  core.vault.deleteDoc(id);
  return { ...core.reload(), dataPath: core.data };
}

/**
 * 上传项目参考文件；Electron 传 filePaths，网页传 files（name + bytes）。
 * @param {string|{ id: string, filePaths?: string[], files?: { name: string, bytes: number[] }[] }} payload
 */
function projectUpload(core, payload) {
  const id = typeof payload === "string" ? payload : payload.id;
  core.knowledge.project(id);
  let filePaths = typeof payload === "object" ? payload.filePaths : null;
  if (typeof payload === "object" && payload.files?.length) {
    const tmpDir = path.join(
      core.data,
      "upload-tmp",
      String(Date.now()) + "-" + Math.random().toString(36).slice(2),
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    filePaths = payload.files.map((f) => {
      const safe = path.basename(f.name);
      const p = path.join(tmpDir, safe);
      fs.writeFileSync(p, Buffer.from(f.bytes));
      return p;
    });
  }
  if (!filePaths?.length) return null;
  return core.knowledge.upload(id, filePaths);
}

/**
 * 定稿归档；未 confirmed 时返回确认信息，由 UI 二次确认后再提交。
 * @param {string|{ id: string, confirmed?: boolean, contentSnapshot?: string }} payload
 */
function finalize(core, payload) {
  const id = typeof payload === "string" ? payload : payload.id;
  const confirmed = typeof payload === "object" && payload.confirmed === true;
  const snapshot =
    typeof payload === "object" ? payload.contentSnapshot : undefined;
  if (core.active) throw Error("请等待 AI 完成后再定稿");
  core.save();
  const item = core.vault.index[id];
  if (!item || item.status !== "draft") throw Error("草稿不存在");
  const target = item.path.replace("/02_Drafts/", "/03_Archive/");
  const raw = fs.readFileSync(core.vault.p(item.path), "utf8");
  if (!confirmed) {
    return {
      needsConfirmation: true,
      contentSnapshot: raw,
      message: "将这篇草稿标记为已发布并归档？",
      detail:
        "从：" +
        item.path +
        "\n移至：" +
        target +
        "\n\n保留版本、素材关系和对话。仅在本地 Content_OS 内移动；不会自动发布到公众号，也不会填写平台发布时间。",
    };
  }
  if (
    snapshot !== undefined &&
    fs.readFileSync(core.vault.p(item.path), "utf8") !== snapshot
  )
    throw Error("确认期间草稿发生变化，请重新定稿");
  core.vault.finalize(id);
  return { ...core.reload(), dataPath: core.data };
}

/**
 * 将已发布文章移回草稿箱。
 * @param {string} rel vault 相对路径
 */
function toDraft(core, rel) {
  if (core.active) throw Error("请等待 AI 完成后再操作");
  core.save();
  const moved = core.vault.toDraft(rel);
  return { ...core.reload(), dataPath: core.data, restoredId: moved.id };
}

/**
 * 插入图片；支持 bytes、filePath，或由 Electron 对话框在外部选文件后传入 filePath。
 * @param {{ articleId: string, bytes?: number[], type?: string, filePath?: string }} payload
 */
function image(core, payload = {}) {
  const doc = core.store.documents.find((d) => d.id === payload.articleId);
  if (!doc) throw Error("请先保存文章再添加图片");
  let bytes, ext;
  if (payload.filePath) {
    bytes = fs.readFileSync(payload.filePath);
    ext = path.extname(payload.filePath).toLowerCase();
  } else if (payload.bytes) {
    bytes = Buffer.from(payload.bytes);
    ext = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
    }[payload.type];
  } else {
    return null;
  }
  return core.vault.image(
    path.basename(core.vault.index[doc.id].path, ".md"),
    bytes,
    ext,
  );
}
module.exports = {
  listMaterials,
  deleteDraft,
  projectUpload,
  finalize,
  toDraft,
  image,
};
