const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DeskCore, API_CHANNELS } = require("./desk-core.cjs");

const HOST = "127.0.0.1";
const PORT = Number(process.env.INKDESK_PORT || 5173);
const ROOT = __dirname;

const desk = new DeskCore();
desk.init({
  dataDir: process.env.INKDESK_DATA || path.join(ROOT, "data"),
  projectDir: ROOT,
  readerPath: path.join(ROOT, "assets/reference-reader"),
});

const agentSse = new Set();
const reloadSse = new Set();

desk.onAgentProgress = (text) => {
  const line = "data: " + JSON.stringify(text) + "\n\n";
  for (const res of agentSse) {
    try {
      res.write(line);
    } catch {
      agentSse.delete(res);
    }
  }
};

/**
 * 通知浏览器刷新（bundle / css 变更）。
 */
function notifyReload() {
  const line = "data: reload\n\n";
  for (const res of reloadSse) {
    try {
      res.write(line);
    } catch {
      reloadSse.delete(res);
    }
  }
}

/**
 * 读取 HTTP 请求体。
 * @param {import('http').IncomingMessage} req
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * 提供静态文件（项目根目录）。
 * @param {string} urlPath
 * @param {import('http').ServerResponse} res
 */
function serveStatic(urlPath, res) {
  let rel = urlPath === "/" ? "/index.html" : urlPath.split("?")[0];
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, "index.html"))
    return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * 提供 vault / 本地 assets 图片。
 * @param {string} urlPath
 * @param {import('http').ServerResponse} res
 */
function serveAsset(urlPath, res) {
  const parts = urlPath.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "asset") return false;
  const kind = parts[2];
  const rel = decodeURIComponent(parts.slice(3).join("/"));
  try {
    const p =
      kind === "vault"
        ? desk.vaultAsset(rel)
        : desk.allowedAsset(path.join(desk.data, "assets", rel));
    const ext = path.extname(p).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    fs.createReadStream(p).pipe(res);
    return true;
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  if (url === "/api/events/agent" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    agentSse.add(res);
    req.on("close", () => agentSse.delete(res));
    return;
  }

  if (url === "/api/events/reload" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    reloadSse.add(res);
    req.on("close", () => reloadSse.delete(res));
    return;
  }

  if (serveAsset(url, res)) return;

  if (req.method === "POST" && url === "/api/save-sync") {
    try {
      const raw = await readBody(req);
      const next = JSON.parse(raw.toString("utf8"));
      desk.saveSync(next);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url.startsWith("/api/")) {
    const name = decodeURIComponent(url.slice(5).split("?")[0]);
    try {
      if (!API_CHANNELS.includes(name)) throw Error("Invalid channel");
      const raw = await readBody(req);
      const data =
        raw.length === 0 ? undefined : JSON.parse(raw.toString("utf8"));
      let result = await desk.invoke(name, data);
      if (name === "finalize" && result?.needsConfirmation) {
        /* 网页端由 renderer 二次确认 */
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === "GET" && serveStatic(url, res)) return;

  res.writeHead(404);
  res.end("Not found");
});

/**
 * 启动本机 HTTP 开发服务。
 */
function start() {
  server.listen(PORT, HOST, () => {
    console.log(`Inkdesk web dev: http://${HOST}:${PORT}`);
  });
}

if (require.main === module) start();

module.exports = { server, notifyReload, start, HOST, PORT };
