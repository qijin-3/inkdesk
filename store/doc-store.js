/**
 * 文档保存协议（M3 状态层）。
 * 拥有：防抖 timer、磁盘冲突标志。文档数据本身仍由调用方持有，
 * 本模块通过 getState/getCurrent 访问，通过 set 回写，保证行为与原 renderer 实现一致。
 *
 * deps: {
 *   getState: () => state, getCurrent: () => current,
 *   isReviewDemo: () => boolean, isDirty: () => boolean, setDirty: (v: boolean) => void,
 *   api: (name, data) => Promise<any>, toast: (t, opts?) => void,
 *   setSavedStatus: (t: string) => void,
 *   onExternalConflict: (msg: string) => void,  // 磁盘外部修改时的引导流程
 *   queryCard: (id: string) => Element | null,  // 侧栏卡片（changed 时刷新标题/字数）
 * }
 */
export function createDocStore(deps) {
  let saveTimer = 0;
  const store = {
    saveConflict: false,

    async persist() {
      clearTimeout(saveTimer);
      if (deps.isReviewDemo()) {
        deps.setSavedStatus("演示中 · 不保存");
        deps.setDirty(false);
        return true;
      }
      if (store.saveConflict) return false;
      const state = deps.getState();
      try {
        const before = JSON.stringify(state);
        await deps.api("save", state);
        if (before === JSON.stringify(state)) deps.setDirty(false);
        deps.setSavedStatus("");
        return true;
      } catch (e) {
        const msg = (e && e.message) || String(e);
        if (/外部修改|外部移动|草稿已在外部/.test(msg)) {
          deps.onExternalConflict(msg);
          return false;
        }
        deps.toast("保存失败：" + msg);
        return false;
      }
    },

    /** 内容变化：刷新侧栏卡片，标记 dirty，500ms 防抖保存 */
    markChanged(delay = 500) {
      const current = deps.getCurrent();
      const card = current && deps.queryCard(current.id);
      if (card) {
        card.querySelector("span").textContent = current.title;
        card.querySelector("small").textContent =
          new Date().toLocaleDateString("zh-CN") +
          " · " +
          current.body.length +
          " 字";
      }
      deps.setDirty(true);
      if (current) current.updated = new Date().toISOString();
      deps.setSavedStatus("保存中…");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.persist(), delay);
    },

    /** 延迟触发一次保存（审阅流程用），会取消已排队的防抖 */
    deferPersist(delay = 500) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.persist(), delay);
    },

    cancelPending() {
      clearTimeout(saveTimer);
    },
  };
  return store;
}
