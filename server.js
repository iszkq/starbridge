import { join, normalize } from "node:path";

const port = Number(Bun.env.PORT || 4174);
const root = import.meta.dir;

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    // Local-development proxy for Matrix homeservers that do not expose CORS.
    // The browser only talks to localhost; the server forwards the request.
    const proxyPrefix = "/__matrix_proxy/";
    if (url.pathname.startsWith(proxyPrefix)) {
      const encodedTarget = url.pathname.slice(proxyPrefix.length).split("/")[0];
      const target = decodeURIComponent(encodedTarget);
      if (!/^https?:\/\//i.test(target)) return new Response("Invalid Matrix target", { status: 400 });
      const upstreamPath = url.pathname.slice(proxyPrefix.length + encodedTarget.length) || "/";
      const upstreamUrl = `${target.replace(/\/$/, "")}${upstreamPath}${url.search}`;
      const headers = new Headers(request.headers);
      ["host", "origin", "referer", "content-length", "connection", "accept-encoding"].forEach(name => headers.delete(name));
      // Preserve the Matrix bearer token explicitly. Some runtimes normalize
      // request headers and otherwise omit it while forwarding media requests.
      const authorization = request.headers.get("authorization");
      if (authorization) headers.set("authorization", authorization);
      try {
        const upstream = await fetch(upstreamUrl, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body });
        const responseHeaders = new Headers(upstream.headers);
        ["content-encoding", "content-length", "transfer-encoding"].forEach(name => responseHeaders.delete(name));
        return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
      } catch (error) {
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

    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = normalize(join(root, relative));
    if (!filePath.startsWith(root)) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(filePath);
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  }
});

console.log(`Orbit 正在运行：http://localhost:${port}`);
