const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-live-"));
  const env = { ...process.env, INKDESK_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve("main.cjs")], env });
  try {
    const w = await app.firstWindow();
    await w.waitForSelector("#start");
    for (const provider of ["cursor", "codex"]) {
      try {
        const result = await w.evaluate(
          async (provider) =>
            window.desk.call("agent", {
              provider,
              account: "AI",
              task: "chat",
              instruction: "请只回复：连接成功。不要调用工具。",
              body: "",
              history: "",
            }),
          provider,
        );
        console.log(provider + ": " + result.slice(0, 150));
      } catch (e) {
        console.log(provider + ": FAILED " + e.message.slice(-700));
      }
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
