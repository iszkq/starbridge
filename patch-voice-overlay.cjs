const fs = require("fs");

function replaceOnce(src, from, to, label) {
  const lf = src.replaceAll("\r\n", "\n");
  const fromLf = from.replaceAll("\r\n", "\n");
  if (!lf.includes(fromLf)) throw new Error("missing snippet: " + label);
  const next = lf.replace(fromLf, to.replaceAll("\r\n", "\n"));
  return src.includes("\r\n") ? next.replaceAll("\n", "\r\n") : next;
}

let call = fs.readFileSync("src/call/ElementCall.js", "utf8");
call = replaceOnce(call, `function getElementCallHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "call-element-stage";
    document.body.appendChild(host);
  }
  return host;
}

function hideElementCallHostIfEmpty() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  if (!host.querySelector("iframe")) {
    host.classList.remove("is-active");
    host.replaceChildren();
  }
}`, `function getElementCallHost(kind = "voice") {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "call-element-stage";
    document.body.appendChild(host);
  }
  host.classList.toggle("is-voice", kind !== "video");
  host.classList.toggle("is-video", kind === "video");
  return host;
}

function hideElementCallHostIfEmpty() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  if (!host.querySelector("iframe")) {
    host.classList.remove("is-active", "is-voice", "is-video");
    host.replaceChildren();
  }
}`, "host kind");
call = replaceOnce(call, "const host = getElementCallHost();", "const host = getElementCallHost(kind);", "host call");
fs.writeFileSync("src/call/ElementCall.js", call);

let app = fs.readFileSync("app.js", "utf8");
app = replaceOnce(app, `  const isElement = session.mode === "element";
  const isVideoCall = session.kind === "video";
  const inboundRinging = session.direction === "inbound" && session.state === "ringing";
  const compact = isElement ? !inboundRinging : isVideoCall;
  const overlayState = inboundRinging ? "incoming" : (session.state === "connected" ? "connected" : (session.state === "ended" ? "ended" : "ringing"));`, `  const isElement = session.mode === "element";
  const isVideoCall = session.kind === "video";
  const inboundRinging = session.direction === "inbound" && session.state === "ringing";
  const compact = isVideoCall && !inboundRinging;
  const overlayState = inboundRinging ? "incoming" : (session.state === "connected" ? "connected" : (session.state === "ended" ? "ended" : "ringing"));`, "compact class");
app = replaceOnce(app, `  return createPortal(h("div", { className: \`call-overlay \${compact ? "is-video" : "is-voice"} \${isElement ? "is-element" : ""} is-\${overlayState}\` },`, `  return createPortal(h("div", { className: \`call-overlay \${compact ? "is-video" : "is-voice"} \${isElement ? "is-element" : ""} is-\${overlayState}\` },`, "overlay class noop");
app = app.replaceAll("Icon.js?v=270", "Icon.js?v=271");
app = app.replaceAll("ElementCall.js?v=270", "ElementCall.js?v=271");
fs.writeFileSync("app.js", app);

let html = fs.readFileSync("index.html", "utf8");
html = html.replaceAll("v=270", "v=271");
fs.writeFileSync("index.html", html);

let css = fs.readFileSync("styles.css", "utf8");
css = replaceOnce(css, `.call-element-stage { position: fixed; inset: 0; z-index: 4290; display: none; background: #0b1220; }
.call-element-stage.is-active { display: block; }
.call-element-stage iframe { width: 100%; height: 100%; border: 0; background: #0b1220; }
.call-overlay.is-element { inset: 0; background: rgba(15, 23, 42, .62); transform: none; }
.call-overlay.is-element.is-connected, .call-overlay.is-element.is-ended { inset: 0; top: 0; left: 0; background: transparent; transform: none; pointer-events: none; }
.call-overlay.is-element.is-connected .call-card, .call-overlay.is-element.is-ended .call-card { position: absolute; top: 18px; left: 50%; bottom: auto; min-width: 0; padding: 12px 16px 14px; flex-direction: row; gap: 14px; color: #fff; background: rgba(15, 23, 42, .78); backdrop-filter: blur(12px); transform: translateX(-50%); pointer-events: auto; }
.call-overlay.is-element.is-connected .call-copy, .call-overlay.is-element.is-ended .call-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.call-overlay.is-element.is-connected .call-name, .call-overlay.is-element.is-ended .call-name { font-size: 14px; }
.call-overlay.is-element.is-connected .call-status, .call-overlay.is-element.is-ended .call-status { color: #d0d5dd; font-size: 12px; }
.call-overlay.is-element.is-connected .call-actions, .call-overlay.is-element.is-ended .call-actions { margin-top: 0; gap: 10px; }
.call-overlay.is-element.is-connected .call-action span, .call-overlay.is-element.is-ended .call-action span { color: #e4e7ec; }

.call-overlay.is-voice.is-connected, .call-overlay.is-voice.is-ended { inset: auto; top: 18px; left: 50%; background: transparent; transform: translateX(-50%); pointer-events: none; }`, `.call-element-stage { position: fixed; inset: 0; z-index: 4290; display: none; background: #0b1220; }
.call-element-stage.is-active { display: block; }
.call-element-stage.is-voice {
  inset: auto;
  top: 0;
  left: -12000px;
  width: 360px;
  height: 220px;
  opacity: 0;
  pointer-events: none;
  background: transparent;
}
.call-element-stage iframe { width: 100%; height: 100%; border: 0; background: #0b1220; }
.call-overlay.is-element.is-voice { background: rgba(15, 23, 42, .42); }
.call-overlay.is-element.is-video { inset: 0; background: rgba(15, 23, 42, .62); transform: none; }
.call-overlay.is-element.is-video.is-connected, .call-overlay.is-element.is-video.is-ended { inset: 0; top: 0; left: 0; background: transparent; transform: none; pointer-events: none; }
.call-overlay.is-element.is-video.is-connected .call-card, .call-overlay.is-element.is-video.is-ended .call-card { position: absolute; top: 18px; left: 50%; bottom: auto; min-width: 0; padding: 12px 16px 14px; flex-direction: row; gap: 14px; color: #fff; background: rgba(15, 23, 42, .78); backdrop-filter: blur(12px); transform: translateX(-50%); pointer-events: auto; }
.call-overlay.is-element.is-video.is-connected .call-copy, .call-overlay.is-element.is-video.is-ended .call-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.call-overlay.is-element.is-video.is-connected .call-name, .call-overlay.is-element.is-video.is-ended .call-name { font-size: 14px; }
.call-overlay.is-element.is-video.is-connected .call-status, .call-overlay.is-element.is-video.is-ended .call-status { color: #d0d5dd; font-size: 12px; }
.call-overlay.is-element.is-video.is-connected .call-actions, .call-overlay.is-element.is-video.is-ended .call-actions { margin-top: 0; gap: 10px; }
.call-overlay.is-element.is-video.is-connected .call-action span, .call-overlay.is-element.is-video.is-ended .call-action span { color: #e4e7ec; }
.call-overlay.is-voice.is-connected, .call-overlay.is-voice.is-ended, .call-overlay.is-voice.is-ringing, .call-overlay.is-voice.is-incoming {
  inset: 0;
  top: 0;
  left: 0;
  background: rgba(15, 23, 42, .42);
  transform: none;
  pointer-events: auto;
  display: grid;
  place-items: center;
}`, "call overlay css");
fs.writeFileSync("styles.css", css);
console.log("voice card overlay patched");
