import { join, normalize } from "node:path";

const port = Number(Bun.env.PORT || 4174);
const root = import.meta.dir;

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


Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    // Local-development proxy for Matrix homeservers that do not expose CORS.
    // The browser only talks to localhost; the server forwards the request.
    const proxyPrefix = "/__matrix_proxy/";
    if (url.pathname.startsWith(proxyPrefix)) {
      const proxyPath = url.pathname.slice(proxyPrefix.length);
      const slash = proxyPath.indexOf("/");
      const encodedTarget = slash < 0 ? proxyPath : proxyPath.slice(0, slash);
      let target;
      try { target = decodeURIComponent(encodedTarget); } catch { return new Response("Invalid Matrix target", { status: 400 }); }
      if (!/^https?:\/\//i.test(target)) return new Response("Invalid Matrix target", { status: 400 });
      const upstreamPath = slash < 0 ? "/" : proxyPath.slice(slash) || "/";
      const upstreamUrl = `${target.replace(/\/$/, "")}${upstreamPath}${url.search}`;
      const headers = new Headers(request.headers);
      ["host", "origin", "referer", "content-length", "connection", "accept-encoding"].forEach(name => headers.delete(name));
      // Preserve the Matrix bearer token explicitly. Some runtimes normalize
      // request headers and otherwise omit it while forwarding media requests.
      const authorization = request.headers.get("authorization");
      if (authorization) headers.set("authorization", authorization);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,HEAD,OPTIONS",
          "access-control-allow-headers": "Authorization,Range,Content-Type",
          "access-control-max-age": "600"
        } });
      }
      try {
        const upstream = await fetch(upstreamUrl, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body });
        const responseHeaders = new Headers(upstream.headers);
        ["content-encoding", "content-length", "transfer-encoding"].forEach(name => responseHeaders.delete(name));
        responseHeaders.set("access-control-allow-origin", "*");
        responseHeaders.set("access-control-expose-headers", "content-range, content-length, accept-ranges, content-type");
        return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
      } catch (error) {
        console.warn(`Matrix proxy request failed: ${upstreamUrl}`, error?.message || error);
        return new Response(JSON.stringify({ errcode: "M_PROXY_ERROR", error: String(error?.message || error) }), { status: 502, headers: { "content-type": "application/json" } });
      }
    }

    // Proxy the cloud sticker index/assets so browsers with strict CORS
    // policies can download an image before uploading it to Matrix.
    const assetPrefix = "/__asset_proxy/";
    if (url.pathname.startsWith(assetPrefix)) {
      const encodedTarget = url.pathname.slice(assetPrefix.length);
      const target = decodeURIComponent(encodedTarget);
      if (!/^https:\/\//i.test(target)) return new Response("Invalid asset target", { status: 400 });
      try {
        const upstream = await fetch(target, { headers: { accept: request.headers.get("accept") || "*/*" } });
        const headers = new Headers(upstream.headers);
        ["content-encoding", "content-length", "transfer-encoding"].forEach(name => headers.delete(name));
        headers.set("access-control-allow-origin", "*");
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
    }

    if (url.pathname === "/__stt") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "Content-Type,X-Orbit-Filename",
          "access-control-max-age": "600"
        } });
      }
      if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
      try {
        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength) return new Response(JSON.stringify({ error: "没有可识别的语音" }), { status: 400, headers: { "content-type": "application/json" } });
        const result = await transcribeWithAiHubMix(bytes, request.headers.get("x-orbit-filename"), request.headers.get("content-type"));
        return new Response(result.text, { status: result.status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 502, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
      }
    }

    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = normalize(join(root, relative));
    if (!filePath.startsWith(root)) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(filePath);
    // Always serve the local app shell without a browser cache.  Otherwise
    // the embedded browser can keep an older index.html (and its old app.js
    // query version) alive after a fix, making stale editor chips reappear.
    return (await file.exists())
      ? new Response(file, { headers: { "cache-control": "no-store, max-age=0" } })
      : new Response("Not found", { status: 404 });
  }
});

console.log(`Orbit 正在运行：http://localhost:${port}`);
