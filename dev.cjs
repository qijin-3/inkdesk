const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { notifyReload } = require("./server.cjs");

const ROOT = __dirname;

/**
 * 启动 esbuild watch、HTTP 服务，并在静态资源变更时通知浏览器刷新。
 */
function main() {
  const esbuild = spawn(
    process.execPath,
    [
      path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
      "renderer.js",
      "--bundle",
      "--format=esm",
      "--outfile=bundle.js",
      "--watch",
    ],
    { stdio: "inherit", cwd: ROOT },
  );

  const { start } = require("./server.cjs");
  start();

  for (const file of ["bundle.js", "style.css"]) {
    const target = path.join(ROOT, file);
    let last = 0;
    fs.watchFile(target, { interval: 400 }, () => {
      const m = fs.statSync(target).mtimeMs;
      if (m === last) return;
      last = m;
      notifyReload();
    });
  }

  process.on("SIGINT", () => {
    esbuild.kill();
    process.exit(0);
  });
}

main();
