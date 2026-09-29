import { esc } from "./dom.js";

/** 为未自动匹配的表格行选择归档文章（优先建议，默认近半年，可搜索） */
export function showUnmatchedMatcher(preview) {
  return new Promise((resolve) => {
    const archives = preview.archives || [];
    const halfYearAgo = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
    })();
    /** 近半年归档；搜索时扩大到全量 */
    const recent = () =>
      archives.filter(
        (a) => !a.date || String(a.date).slice(0, 10) >= halfYearAgo,
      );
    /** 按关键词筛选归档，无关键词时返回近半年列表 */
    const filterArchives = (q) => {
      const list = q ? archives : recent();
      const key = String(q || "")
        .trim()
        .toLowerCase();
      if (!key) return list;
      return list.filter(
        (a) =>
          a.title.toLowerCase().includes(key) ||
          String(a.date || "").includes(key),
      );
    };
    /** 渲染单条未匹配行的下拉选项 */
    const optionsHtml = (u, q = "") => {
      const suggested = (u.suggestions || []).map((s) => s.path);
      const list = filterArchives(q);
      const merged = [];
      const seen = new Set();
      for (const s of u.suggestions || []) {
        const a = archives.find((x) => x.path === s.path);
        if (a && !seen.has(a.path)) {
          seen.add(a.path);
          merged.push({ ...a, hint: `建议 ${s.score}%` });
        }
      }
      for (const a of list) {
        if (!seen.has(a.path)) {
          seen.add(a.path);
          merged.push(a);
        }
      }
      const preferred = u.suggestions?.[0]?.path || "";
      return (
        `<option value="">跳过</option>` +
        merged
          .map(
            (a) =>
              `<option value="${esc(a.path)}" ${a.path === preferred ? "selected" : ""}>${esc(a.title)}${a.date ? " · " + esc(String(a.date).slice(0, 10)) : ""}${a.hint ? " · " + a.hint : ""}</option>`,
          )
          .join("")
      );
    };
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog import-dialog"><div class="row"><h2>未能自动匹配的笔记</h2><button type="button" id="close-unmatched">关闭</button></div><p>已按相似度给出建议；列表默认近半年，也可搜索全部归档。</p>${preview.unmatched
      .map(
        (u) =>
          `<div class="match-row" data-index="${u.index}"><p><strong>${esc(u.row.title)}</strong>${u.row["首次发布时间"] ? `<small>${esc(u.row["首次发布时间"])}</small>` : ""}</p><input class="match-search" type="search" placeholder="搜索归档文章…"><select class="match-pick" aria-label="匹配归档">${optionsHtml(u)}</select></div>`,
      )
      .join(
        "",
      )}<div class="row"><button type="button" id="cancel-unmatched">取消导入</button><button type="button" id="confirm-unmatched" class="primary">确认匹配</button></div></div>`;
    document.body.append(m);
    m.querySelectorAll(".match-row").forEach((row) => {
      const u = preview.unmatched.find((x) => x.index === +row.dataset.index);
      const search = row.querySelector(".match-search");
      const pick = row.querySelector(".match-pick");
      search.oninput = () => {
        const current = pick.value;
        pick.innerHTML = optionsHtml(u, search.value);
        if ([...pick.options].some((o) => o.value === current))
          pick.value = current;
      };
    });
    $("#close-unmatched").onclick = $("#cancel-unmatched").onclick = () => {
      m.remove();
      resolve(null);
    };
    $("#confirm-unmatched").onclick = () => {
      const extra = [];
      m.querySelectorAll(".match-row").forEach((row) => {
        const path = row.querySelector(".match-pick").value;
        if (path) extra.push({ index: +row.dataset.index, path });
      });
      m.remove();
      resolve(extra);
    };
  });
}
