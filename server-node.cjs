/* Node 18+ development server fallback for environments without Bun. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const port = Number(process.env.PORT || 4174);
const root = __dirname;
const proxyPrefix = "/__matrix_proxy/";
const assetPrefix = "/__asset_proxy/";

const AIHUBMIX_API_KEY = process.env.AIHUBMIX_API_KEY || "sk-ORD4wbVuj5ThPB0x52633eCc417c43A39b94D49123A7F719";
const AIHUBMIX_TRANSCRIBE_URLS = [
  "https://aihubmix.com/v1/audio/transcriptions",
  "https://api.aihubmix.com/v1/audio/transcriptions",
];

async function transcribeWithAiHubMix(bytes, filename, mime) {
  const safeName = String(filename || "audio.webm").replace(/[^A-Za-z0-9._-]/g, "_") || "audio.webm";
  const type = String(mime || "application/octet-stream").split(";")[0] || "application/octet-stream";
  let lastError = null;
  for (const url of AIHUBMIX_TRANSCRIBE_URLS) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), safeName);
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "zh");
    form.append("response_format", "json");
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${AIHUBMIX_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      const text = await upstream.text();
      if (upstream.ok || upstream.status < 500) return { status: upstream.status, text };
      lastError = text || `HTTP ${upstream.status}`;
    } catch (error) {
      lastError = error?.message || error;
    }
  }
  throw new Error(String(lastError || "转文字服务暂时不可用"));
}


const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".wasm": "application/wasm",
};

function corsHeaders(headers = {}) {
  return { ...headers, "access-control-allow-origin": "*", "access-control-expose-headers": "content-range, content-length, accept-ranges, content-type" };
}

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxy(req, res, target, asset = false) {
  let upstream;
  try {
    const targetUrl = new URL(target);
    if (!/^https?:$/.test(targetUrl.protocol)) throw new Error("Invalid target protocol");
    const headers = { ...req.headers };
    for (const name of ["host", "origin", "referer", "content-length", "connection", "accept-encoding"]) delete headers[name];
    if (asset) {
      delete headers.authorization;
      headers.accept = headers.accept || "*/*";
    }
    const init = { method: req.method, headers, redirect: "follow" };
    if (!['GET', 'HEAD'].includes(req.method)) {
      init.body = await requestBody(req);
    }
    upstream = await fetch(targetUrl, init);
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) responseHeaders[key] = value;
    });
    Object.assign(responseHeaders, corsHeaders());
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === "HEAD") return res.end();
    if (!upstream.body) return res.end();
    // Stream large Matrix key backups instead of buffering the entire
    // /room_keys/keys response in Node memory before the browser can parse it.
    const stream = require("node:stream").Readable.fromWeb(upstream.body);
    stream.on("error", error => { if (!res.headersSent) res.writeHead(502, corsHeaders()); res.destroy(error); });
    stream.pipe(res);
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
    res.end(JSON.stringify({ errcode: "M_PROXY_ERROR", error: String(error?.message || error) }));
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS" && (requestUrl.pathname.startsWith(proxyPrefix) || requestUrl.pathname.startsWith(assetPrefix))) {
    res.writeHead(204, corsHeaders({ "access-control-allow-methods": "GET,HEAD,OPTIONS,POST,PUT,DELETE", "access-control-allow-headers": "Authorization,Range,Content-Type", "access-control-max-age": "600" }));
    return res.end();
  }
  for (const [prefix, isAsset] of [[proxyPrefix, false], [assetPrefix, true]]) {
    if (!requestUrl.pathname.startsWith(prefix)) continue;
    const encoded = requestUrl.pathname.slice(prefix.length).split("/")[0];
    let target;
    try { target = decodeURIComponent(encoded); } catch { res.writeHead(400); return res.end("Invalid target"); }
    if (!/^https?:\/\//i.test(target)) { res.writeHead(400); return res.end("Invalid target"); }
    const suffix = requestUrl.pathname.slice(prefix.length + encoded.length) || "/";
    const upstream = `${target.replace(/\/$/, "")}${isAsset ? "" : suffix}${requestUrl.search}`;
    return proxy(req, res, upstream, isAsset);
  }
  if (requestUrl.pathname === "/__stt") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders({ "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "Content-Type,X-Orbit-Filename", "access-control-max-age": "600" }));
      return res.end();
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
      return res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    try {
      const bytes = await requestBody(req);
      if (!bytes.length) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
        return res.end(JSON.stringify({ error: "没有可识别的语音" }));
      }
      const result = await transcribeWithAiHubMix(bytes, req.headers["x-orbit-filename"], req.headers["content-type"]);
      res.writeHead(result.status, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
      return res.end(result.text);
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
      return res.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  }
  let relative;
  try { relative = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname); } catch { res.writeHead(400); return res.end("Invalid path"); }
  const filePath = path.resolve(root, `.${relative}`);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream", "cache-control": "no-store, max-age=0" });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, () => console.log(`Orbit 正在运行：http://localhost:${port} (Node fallback)`));
