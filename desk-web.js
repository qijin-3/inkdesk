/**
 * 浏览器环境下的 desk 桥接：HTTP API + SSE Agent 进度 + 本地剪贴板。
 */
(function () {
  if (window.desk) return;

  const agentListeners = new Set();
  let agentSource = null;

  /**
   * 建立 Agent 进度 SSE 连接。
   */
  function ensureAgentStream() {
    if (agentSource) return;
    agentSource = new EventSource("/api/events/agent");
    agentSource.onmessage = (e) => {
      let text = e.data;
      try {
        text = JSON.parse(e.data);
      } catch {
        /* 纯文本 */
      }
      for (const fn of agentListeners) fn(text);
    };
    agentSource.onerror = () => {
      agentSource?.close();
      agentSource = null;
      setTimeout(ensureAgentStream, 2000);
    };
  }

  /**
   * 调用与 Electron 同名的后端 API。
   * @param {string} name
   * @param {*} data
   */
  async function call(name, data) {
    if (name === "copy") {
      if (data.html && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([data.text || ""], { type: "text/plain" }),
            "text/html": new Blob([data.html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(data.text || "");
      }
      return true;
    }
    const res = await fetch("/api/" + encodeURIComponent(name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? null),
    });
    const body = await res.json();
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || "请求失败");
    }
    return body.result;
  }

  window.desk = {
    web: true,
    call,
    flush(data) {
      const blob = new Blob([JSON.stringify(data)], {
        type: "application/json",
      });
      if (navigator.sendBeacon("/api/save-sync", blob)) return true;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/save-sync", false);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(JSON.stringify(data));
      return xhr.status === 200;
    },
    progress(fn) {
      ensureAgentStream();
      agentListeners.add(fn);
      return () => agentListeners.delete(fn);
    },
  };

  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    const reload = new EventSource("/api/events/reload");
    reload.onmessage = (e) => {
      if (e.data === "reload") location.reload();
    };
  }
})();
