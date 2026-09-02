import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import * as Antd from "https://esm.sh/antd@5.27.4?bundle&deps=react@18.3.1,react-dom@18.3.1";
import Plyr from "https://esm.sh/plyr@3.7.8?bundle";
import * as MatrixSDK from "https://esm.sh/matrix-js-sdk@42.3.0?bundle&external=@matrix-org/matrix-sdk-crypto-wasm";
import { decodeRecoveryKey } from "https://esm.sh/matrix-js-sdk@42.3.0/lib/crypto-api/recovery-key?bundle";
import { SlidingSync } from "https://esm.sh/matrix-js-sdk@42.3.0/lib/sliding-sync.js?bundle&external=@matrix-org/matrix-sdk-crypto-wasm";

// esm.sh's bundled SDK points the Rust WASM request at a non-existent path.
// Redirect that one asset to the published crypto-wasm package while leaving
// all other network requests untouched.
const orbitFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (url.includes("/matrix-js-sdk@42.3.0/es2022/pkg/matrix_sdk_crypto_wasm_bg.wasm")) {
    const fixed = url.replace("/matrix-js-sdk@42.3.0/es2022/pkg/", "/@matrix-org/matrix-sdk-crypto-wasm@18.4.0/es2022/pkg/");
    return orbitFetch(fixed, init);
  }
  return orbitFetch(input, init);
};

const { Input: AntInput, Avatar: AntAvatar, Button: AntButton, Popover: AntPopover, Checkbox: AntCheckbox, message: antMessage } = Antd;
const TextArea = AntInput.TextArea;
const Input = props => h(AntInput, { ...props, allowClear: props.showClear, onChange: event => props.onChange?.(event?.target?.value ?? event) });
const Avatar = props => h(AntAvatar, { ...props, size: props.size === "small" ? 32 : props.size, shape: props.shape === "square" ? "square" : props.shape });
const Toast = { success: value => antMessage?.success(value), error: value => antMessage?.error(value), warning: value => antMessage?.warning(value), info: value => antMessage?.info(value) };
const UiButton = ({ variant = "default", danger = false, ...props }) => h(AntButton, { type: variant === "primary" ? "primary" : "default", danger, ...props });
const h = React.createElement;
function Icon({ name, size = 17 }) {
  const paths = { search: "M11 19a8 8 0 1 1 5.66-2.34L21 21", phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z", video: "M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14M3 6h12v12H3z", list: "M5 6h.01M9 6h10M5 12h.01M9 12h10M5 18h.01M9 18h10", pin: "M9 3h6l-1 6 4 3v2h-5v7h-2v-7H6v-2l4-3z", room: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM8 8h8M8 12h5M8 16h3", chevronLeft: "M15 18l-6-6 6-6", chevronRight: "M9 18l6-6-6-6", forward: "M14 5l7 7-7 7M21 12H3", reply: "M9 17l-5-5 5-5M4 12h10a6 6 0 0 1 6 6v1", thread: "M4 6h16M4 12h11M4 18h7", edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z", redact: "M6 7h12M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v6m4-6v6" };
  paths.room = "M3 11.5 12 4l9 7.5M5 10v10h14V10M9 20v-6h6v6";
  return h("svg", { className: "ui-icon", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: paths[name] || paths.room }));
}
const colors = ["#6264dc", "#2e9d78", "#e58a45", "#b66ad0", "#db6872", "#4d91c6"];
const initials = (name = "?") => [...name.replace(/^[@#]/, "")].slice(0, 2).join("") || "?";
const colorFor = (id = "") => colors[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length];
const orbitNotifiedEvents = new Set();
const orbitOfficeEditorUrl = window.orbitOfficeEditorUrl || "https://124.222.193.241:6258/editor";

function isNotifiableMessage(event) {
  const type = event?.getClearType?.() || event?.getType?.();
  if (type === "m.sticker") return true;
  if (type === "m.room.encrypted") return true;
  if (type !== "m.room.message") return false;
  const msgtype = event?.getClearContent?.()?.msgtype || event?.getContent?.()?.msgtype;
  return ["m.text", "m.notice", "m.emote", "m.image", "m.file", "m.video", "m.audio", "m.sticker"].includes(msgtype);
}

function notificationBody(event) {
  const content = event?.getClearContent?.() || event?.getContent?.() || {};
  if (event?.getType?.() === "m.sticker") return "发送了一个贴纸";
  if (event?.getType?.() === "m.room.encrypted" && !event?.getClearContent?.()) return "收到一条加密消息";
  if (content.msgtype === "m.image") return "发送了一张图片";
  if (content.msgtype === "m.video") return "发送了一段视频";
  if (content.msgtype === "m.audio") return "发送了一段音频";
  if (content.msgtype === "m.sticker") return "发送了一个贴纸";
  if (content.msgtype === "m.file") return content.body ? `发送了文件：${content.body}` : "发送了一个文件";
  const plain = String(content.body || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return plain || "收到一条新消息";
}

async function markRoomRead(client, roomId, event) {
  if (!client || !roomId || !event) return;
  if (typeof client.setRoomReadMarkers === "function" && event.getId?.()) {
    await client.setRoomReadMarkers(roomId, event.getId(), event);
  } else {
    await client.sendReadReceipt?.(event);
  }
}

function roomAvatarMxc(room) {
  const event = room?.currentState?.getStateEvents?.("m.room.avatar", "");
  const content = Array.isArray(event) ? event[0]?.getContent?.() : event?.getContent?.();
  return room?.getMxcAvatarUrl?.() || content?.url || room?.getAvatarUrl?.() || null;
}

function memberAvatarMxc(member) {
  return member?.getMxcAvatarUrl?.() || member?.avatarUrl || member?.events?.member?.getContent?.()?.avatar_url || null;
}

function decodeBase64(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  const binary = atob(normalized); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function decryptMatrixBuffer(buffer, encryptedInfo) {
  if (!encryptedInfo?.key?.k || !encryptedInfo?.iv) return buffer;
  const key = await window.crypto.subtle.importKey("raw", decodeBase64(encryptedInfo.key.k), { name: "AES-CTR" }, false, ["decrypt"]);
  return window.crypto.subtle.decrypt({ name: "AES-CTR", counter: decodeBase64(encryptedInfo.iv), length: 64 }, key, buffer);
}

async function uploadMatrixMedia(client, file, encrypted = false) {
  if (!encrypted || !window.crypto?.subtle) {
    const uploaded = await client.uploadContent(file, { name: file.name, type: file.type });
    return { uploaded, fileInfo: null };
  }
  // E2EE media is encrypted before it leaves the browser. The event itself is
  // then encrypted by the Matrix SDK as usual, while the `file` descriptor
  // lets every compatible client decrypt the downloaded bytes.
  const rawKey = new Uint8Array(32); const iv = new Uint8Array(16);
  window.crypto.getRandomValues(rawKey); window.crypto.getRandomValues(iv);
  const key = await window.crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, false, ["encrypt"]);
  const cipher = await window.crypto.subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, await file.arrayBuffer());
  const digest = await window.crypto.subtle.digest("SHA-256", cipher);
  const encryptedFile = new File([cipher], `${file.name || "attachment"}.encrypted`, { type: "application/octet-stream" });
  const uploaded = await client.uploadContent(encryptedFile, { name: encryptedFile.name, type: encryptedFile.type });
  // Matrix encrypted media (MSC3916 / current clients) carries the MXC URL
  // inside the `file` descriptor.  Keep the descriptor URL-free here so the
  // caller can attach the URL returned by uploadContent exactly once.
  return { uploaded, fileInfo: { v: "v2", key: { alg: "A256CTR", ext: true, k: encodeBase64Url(rawKey), key_ops: ["encrypt", "decrypt"], kty: "oct" }, iv: encodeBase64Url(iv), hashes: { sha256: encodeBase64Url(digest) }, mimetype: file.type || "application/octet-stream", size: file.size } };
}

function applyUploadedMedia(content, uploaded, fileInfo) {
  if (!uploaded?.content_uri) throw new Error("Matrix 未返回媒体地址");
  if (fileInfo) {
    content.file = { ...fileInfo, url: uploaded.content_uri };
    delete content.url;
  } else content.url = uploaded.content_uri;
  return content;
}

async function normalizeImageBlob(blob) {
  const declared = String(blob?.type || "").toLowerCase();
  if (declared.startsWith("image/")) return blob;
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  let mime = "";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) mime = "image/gif";
  else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) mime = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = "image/jpeg";
  else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) mime = "image/webp";
  return mime ? new Blob([blob], { type: mime }) : blob;
}

async function fetchEmojiBlob(item) {
  const response = await fetch(assetRequestUrl(item.url));
  if (!response.ok) throw new Error(`表情下载失败（${response.status}）`);
  return normalizeImageBlob(await response.blob());
}

async function composeEmojiRowFile(items) {
  const blobs = await Promise.all(items.map(fetchEmojiBlob));
  const bitmaps = await Promise.all(blobs.map(blob => createImageBitmap(blob)));
  const cell = 40; const gap = 4; const width = Math.max(cell, items.length * cell + Math.max(0, items.length - 1) * gap); const height = cell;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); context.clearRect(0, 0, width, height);
  bitmaps.forEach((bitmap, index) => { const scale = Math.min(cell / bitmap.width, cell / bitmap.height); const drawWidth = Math.max(1, Math.round(bitmap.width * scale)); const drawHeight = Math.max(1, Math.round(bitmap.height * scale)); const x = index * (cell + gap) + Math.round((cell - drawWidth) / 2); const y = Math.round((cell - drawHeight) / 2); context.drawImage(bitmap, x, y, drawWidth, drawHeight); bitmap.close?.(); });
  const output = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("表情合成失败")), "image/png"));
  return new File([output], "emoji-row.png", { type: "image/png" });
}

// Keep emoji messages interoperable with Element and other Matrix clients.
// Plain rooms use one formatted text event; encrypted rooms use standard
// encrypted m.image events so every client can decrypt and render them.
async function sendEmojiImageEvents(client, roomId, items, encryptedRoom, sendFn) {
  if (!items?.length) return;
  sendFn ||= (client.__orbitOriginalSendMessage || client.sendMessage)?.bind(client);
  if (!sendFn) throw new Error("Matrix 当前不支持发送消息");
  // In encrypted rooms each image must be a normal encrypted m.image event.
  // This is the only representation understood by Element/Cinny and avoids
  // putting a single opaque `file` descriptor on an HTML event.
  if (encryptedRoom) {
    for (const item of items) {
      const blob = await fetchEmojiBlob(item);
      const type = blob.type || item.mimeType || "image/gif";
      const file = new File([blob], item.fileName || `${item.name || "emoji"}.${type.split("/")[1] || "gif"}`, { type });
      const result = await uploadMatrixMedia(client, file, true);
      const info = { mimetype: type, size: file.size };
      try { const bitmap = await createImageBitmap(blob); info.w = bitmap.width; info.h = bitmap.height; bitmap.close?.(); } catch {}
      await sendFn(roomId, applyUploadedMedia({ msgtype: "m.image", body: item.name || "表情", info, "org.orbit.sticker": true }, result.uploaded, result.fileInfo));
    }
    return;
  }
  // Cinny's interoperable pattern: upload each remote emoji to Matrix, then
  // put all original (including animated GIF/WebP) MXC URLs in one formatted
  // HTML text event. This is one event, while every client can load the
  // standard <img src="mxc://…"> elements and preserve animation.
  const uploaded = [];
  for (const item of items) {
    const blob = await fetchEmojiBlob(item);
    const type = blob.type || item.mimeType || "image/gif";
    const ext = type.split("/")[1] || "gif";
    const file = new File([blob], item.fileName || `${item.name || "emoji"}.${ext}`, { type });
    // The media itself stays unencrypted here on purpose. The room event is
    // encrypted by Matrix, while a plain MXC image in formatted_body is the
    // only representation that Element/Cinny and other clients can render as
    // an animated inline image. The source assets are public emoji artwork,
    // not room content.
    const result = await uploadMatrixMedia(client, file, false);
    if (!result?.uploaded?.content_uri) throw new Error("Matrix 未返回表情媒体地址");
    uploaded.push({ item, mxc: result.uploaded.content_uri });
  }
  const body = uploaded.map(({ item }) => `:${item.name || "表情"}:`).join(" ");
  const formattedBody = uploaded.map(({ item, mxc }) => `<img src="${mxc}" alt="${escapeEditorText(item.name || "表情")}" title="${escapeEditorText(item.name || "表情")}" data-mx-emoticon="1">`).join(" ");
  await sendFn(roomId, { msgtype: "m.text", body, format: "org.matrix.custom.html", formatted_body: formattedBody });
}

function mediaRequestUrl(client, url) {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.origin === location.origin && parsed.pathname.startsWith("/__matrix_proxy/")) return url;
    const home = client?.getHomeserverUrl?.() || parsed.origin;
    if (["localhost", "127.0.0.1"].includes(location.hostname)) return `${location.origin}/__matrix_proxy/${encodeURIComponent(home)}${parsed.pathname}${parsed.search}`;
  } catch {}
  return url;
}

function mediaRequestCandidates(client, rawUrl, requestUrl) {
  const candidates = [requestUrl];
  if (rawUrl?.startsWith("mxc://")) {
    const [, server, mediaId] = rawUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/) || [];
    const home = client?.getHomeserverUrl?.();
    if (server && mediaId && home) {
      // Synapse deployments increasingly disable the legacy unauthenticated
      // media API. Try the authenticated Client-Server v1 route first, then
      // retain v3/r0 compatibility for older homeservers.
      for (const prefix of ["/_matrix/client/v1/media/download/", "/_matrix/media/v3/download/", "/_matrix/media/r0/download/"]) {
        const legacy = mediaRequestUrl(client, `${home}${prefix}${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`);
        if (!candidates.includes(legacy)) candidates.push(legacy);
      }
    }
  }
  return candidates;
}

function assetRequestUrl(url) {
  if (!url || !/^https:\/\//i.test(url)) return url;
  if (["localhost", "127.0.0.1"].includes(location.hostname) && url.includes("image.527012.xyz")) return `${location.origin}/__asset_proxy/${encodeURIComponent(url)}`;
  return url;
}

let orbitEmojiCatalogPromise;
function ensureEmojiCatalog() {
  if (window.orbitEmojiItems?.length) return Promise.resolve(window.orbitEmojiItems);
  if (!orbitEmojiCatalogPromise) orbitEmojiCatalogPromise = fetch(assetRequestUrl("https://image.527012.xyz/index.json")).then(response => response.ok ? response.json() : null).then(data => { window.orbitEmojiItems = data?.items || []; window.orbitEmojiPacks = data?.packs || []; return window.orbitEmojiItems; }).catch(() => []);
  return orbitEmojiCatalogPromise;
}

function useMatrixAsset(client, rawUrl, width = null, height = null, resizeMethod = null, encryptedInfo = null) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(null);
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    setSrc(null); setFailed(false); setResolvedUrl(null);
    if (!rawUrl) return () => {};
    const encrypted = encryptedInfo?.key?.k && encryptedInfo?.iv;
    const httpUrl = rawUrl.startsWith("mxc://") ? client?.mxcUrlToHttp?.(rawUrl, encrypted ? undefined : width, encrypted ? undefined : height, encrypted ? undefined : resizeMethod, false, true, true) : rawUrl;
    if (!httpUrl) { setFailed(true); return () => {}; }
    const requestUrl = mediaRequestUrl(client, httpUrl);
    setResolvedUrl(requestUrl);
    const token = client?.getAccessToken?.();
    if (!token) { setSrc(requestUrl); return () => {}; }
    const fetchMedia = async () => { let lastError = null; for (const candidate of mediaRequestCandidates(client, rawUrl, requestUrl)) { try { const response = await fetch(candidate, { headers: { Authorization: `Bearer ${token}` } }); if (response.ok) { if (candidate !== requestUrl && active) setResolvedUrl(candidate); return response.arrayBuffer(); } lastError = new Error(`媒体请求失败（${response.status}）`); } catch (error) { lastError = error; } } throw lastError || new Error("媒体请求失败"); };
    fetchMedia().then(async buffer => {
      if (!encrypted) return new Blob([buffer]);
      const plain = await decryptMatrixBuffer(buffer, encryptedInfo);
      return new Blob([plain], { type: encryptedInfo.mimetype || "application/octet-stream" });
    }).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); } }).catch(error => { console.warn("媒体解密失败", error); if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, rawUrl, width, height, resizeMethod, encryptedInfo]);
  return { src, failed, url: resolvedUrl };
}

function MatrixAvatar({ client, mxcUrl, httpUrl, size = 38, className = "room-avatar", style, fallback, alt }) {
  const asset = useMatrixAsset(client, mxcUrl || httpUrl, size, size, "crop");
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [asset.src]);
  return h("div", { className, style, title: alt }, asset.src && !asset.failed && !imageFailed ? h("img", { src: asset.src, alt: alt || "", onError: () => setImageFailed(true) }) : fallback);
}

function MessageText({ text }) {
  const [items, setItems] = useState(() => window.orbitEmojiItems || []);
  useEffect(() => { let active = true; ensureEmojiCatalog().then(next => active && setItems(next || [])); return () => { active = false; }; }, []);
  const catalog = items || [];
  const parts = String(text || "").split(/(:[^:\s]+:)/g);
  return h(React.Fragment, null, parts.map((part, index) => {
    const match = part.match(/^:([^:\s]+):$/); const item = match && catalog.find(entry => entry.name === match[1]);
    return item ? h("img", { key: index, className: "inline-message-emoji", src: assetRequestUrl(item.thumbUrl || item.url), alt: item.name, title: item.name }) : h(React.Fragment, { key: index }, part);
  }));
}

function FormattedMessage({ html, client, onImage, emojiFiles }) {
  const [nodes, setNodes] = useState([]);
  useEffect(() => {
    try { const doc = new DOMParser().parseFromString(String(html || ""), "text/html"); setNodes([...doc.body.childNodes]); } catch { setNodes([]); }
  }, [html]);
  const renderNode = (node, key) => {
    if (node.nodeType === Node.TEXT_NODE) return h(React.Fragment, { key }, node.nodeValue || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.tagName === "BR") return h("br", { key });
    if (node.tagName === "A") { const href = node.getAttribute("href") || "#"; return h("a", { key, href, target: "_blank", rel: "noreferrer noopener" }, [...node.childNodes].map((child, index) => renderNode(child, `${key}-${index}`))); }
    if (node.tagName === "IMG") { const alt = node.getAttribute("alt") || "图片"; return h(InlineMatrixImage, { key, client, mxcUrl: node.getAttribute("src"), alt, encryptedFile: emojiFiles?.[alt] || null, onOpen: onImage }); }
    return h(React.Fragment, { key }, [...node.childNodes].map((child, index) => renderNode(child, `${key}-${index}`)));
  };
  return h(React.Fragment, null, nodes.map((node, index) => renderNode(node, index)));
}

function InlineMatrixImage({ client, mxcUrl, alt, encryptedFile, onOpen }) {
  const resolvedEncryptedFile = encryptedFile || window.orbitEncryptedEmojiFiles?.[alt] || null;
  const asset = useMatrixAsset(client, mxcUrl, undefined, undefined, undefined, resolvedEncryptedFile);
  if (!asset.src) return h("span", { className: "inline-media-placeholder" }, "⌛");
  return h("img", { className: "inline-message-image", src: asset.src, alt, onClick: () => onOpen?.(asset.src, alt), onError: () => {} });
}

function MediaLightbox({ viewer, onClose }) {
  const [rotation, setRotation] = useState(0); const [scale, setScale] = useState(1); const [offset, setOffset] = useState({ x: 0, y: 0 }); const [dragging, setDragging] = useState(false); const dragRef = useRef(null);
  useEffect(() => { setRotation(0); setScale(1); setOffset({ x: 0, y: 0 }); }, [viewer?.src]);
  useEffect(() => { if (scale <= 1) setOffset({ x: 0, y: 0 }); }, [scale]);
  if (!viewer) return null;
  const adjustScale = delta => setScale(value => Math.min(4, Math.max(0.35, Number((value + delta).toFixed(2)))));
  const beginDrag = event => { if (scale <= 1) return; event.preventDefault(); dragRef.current = { x: event.clientX, y: event.clientY, offset }; setDragging(true); };
  const moveDrag = event => { if (!dragRef.current) return; const start = dragRef.current; setOffset({ x: start.offset.x + event.clientX - start.x, y: start.offset.y + event.clientY - start.y }); };
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  return h("div", { className: "media-lightbox", onMouseDown: event => event.target === event.currentTarget && onClose() },
    h("div", { className: "media-lightbox-toolbar" }, h("span", null, viewer.alt || "图片预览"), h("div", null, h(UiButton, { size: "small", title: "缩小", onClick: () => adjustScale(-0.2) }, "−"), h("span", { className: "media-zoom-value" }, `${Math.round(scale * 100)}%`), h(UiButton, { size: "small", title: "放大", onClick: () => adjustScale(0.2) }, "+"), h(UiButton, { size: "small", title: "重置缩放", onClick: () => setScale(1) }, "1:1"), h(UiButton, { size: "small", onClick: () => setRotation(value => value - 90) }, "↶"), h(UiButton, { size: "small", onClick: () => setRotation(value => value + 90) }, "↷"), h(UiButton, { size: "small", onClick: onClose }, "关闭"))),
    h("div", { className: `media-lightbox-stage ${dragging ? "is-dragging" : ""}`, onWheel: event => { event.preventDefault(); adjustScale(event.deltaY > 0 ? -0.1 : 0.1); }, onMouseDown: event => event.target === event.currentTarget ? onClose?.() : beginDrag(event), onMouseMove: moveDrag, onMouseUp: endDrag, onMouseLeave: endDrag }, h("img", { className: "media-lightbox-image", src: viewer.src, alt: viewer.alt || "图片预览", draggable: false, style: { transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})` } })));
}

function EmojiPicker({ onSelect, onInsert }) {
  const [items, setItems] = useState([]); const [packs, setPacks] = useState([]); const [pack, setPack] = useState("all"); const [query, setQuery] = useState(""); const [loading, setLoading] = useState(false);
  useEffect(() => { let active = true; setLoading(true); ensureEmojiCatalog().then(nextItems => { if (active) { setItems(nextItems); setPacks(window.orbitEmojiPacks || []); } }).finally(() => active && setLoading(false)); return () => { active = false; }; }, []);
  const shown = items.filter(item => (pack === "all" || item.packId === pack) && (!query.trim() || `${item.name} ${(item.keywords || []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 180);
  const content = h("div", { className: "emoji-popover" }, h(Input, { size: "small", value: query, onChange: setQuery, placeholder: "搜索表情包" }), h("div", { className: "emoji-browser" }, h("nav", { className: "emoji-category-nav", "aria-label": "表情分类" }, h("button", { type: "button", className: `emoji-category ${pack === "all" ? "active" : ""}`, onClick: () => setPack("all") }, "全部", h("small", null, items.length)), packs.map(item => h("button", { type: "button", className: `emoji-category ${pack === item.id ? "active" : ""}`, key: item.id, title: item.description || item.name, onClick: () => setPack(item.id) }, h("span", null, item.name), h("small", null, item.itemCount || items.filter(entry => entry.packId === item.id).length)))), h("section", { className: "emoji-category-content" }, h("div", { className: "emoji-category-title" }, pack === "all" ? "全部表情" : packs.find(item => item.id === pack)?.name || "表情"), loading ? h("div", { className: "emoji-loading" }, "正在加载表情包…") : h("div", { className: "emoji-grid" }, shown.map(item => h("div", { className: "emoji-item-wrap", key: item.id, "data-emoji-name": item.name, style: { "--emoji-preview": `url(${assetRequestUrl(item.url || item.thumbUrl)})` } }, h("button", { type: "button", className: "emoji-item", title: `${item.name}：插入小表情`, onClick: () => onInsert?.(item) }, h("img", { src: assetRequestUrl(item.thumbUrl || item.url), alt: item.name, loading: "lazy" })), h("button", { type: "button", className: "emoji-sticker-action", title: "作为大图贴纸发送", onClick: () => onSelect?.(item) }, "↗")))))));
  return h(AntPopover, { trigger: "click", placement: "topLeft", content }, h("button", { type: "button", className: "tool-button", title: "表情包" }, "☺"));
}

function emojiItemForToken(token) {
  const name = String(token || "").replace(/^:/, "").replace(/:$/, "");
  return (window.orbitEmojiItems || []).find(item => item.name === name) || null;
}

function reactionLabel(key) {
  const item = emojiItemForToken(key);
  return item ? h("img", { className: "reaction-image", src: assetRequestUrl(item.thumbUrl || item.url), alt: item.name }) : key;
}

function readRichEditor(node) {
  if (!node) return "";
  const walk = current => [...current.childNodes].map(child => {
    if (child.nodeType === Node.TEXT_NODE) return child.nodeValue || "";
    if (child.nodeType !== Node.ELEMENT_NODE) return "";
    if (child.dataset?.token) return child.dataset.token;
    if (child.tagName === "BR") return "\n";
    // Browsers commonly represent pasted/newly-entered lines as DIV/P blocks
    // instead of BR elements. Preserve those block boundaries when sending.
    const block = ["DIV", "P", "LI"].includes(child.tagName);
    return walk(child) + (block ? "\n" : "");
  }).join("");
  return walk(node).replace(/\n+$/, "");
}

function escapeEditorText(value) {
  return String(value || "").replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}

function renderRichEditor(node, value) {
  if (!node) return;
  const text = String(value || "");
  const parts = text.split(/(:[^:\s]+:)/g);
  node.innerHTML = parts.map(part => {
    const item = emojiItemForToken(part);
    if (item) return `<span class="editor-emoji-chip" data-token=":${escapeEditorText(item.name)}:" contenteditable="false"><img src="${assetRequestUrl(item.thumbUrl || item.url)}" alt="${escapeEditorText(item.name)}"><span>${escapeEditorText(item.name)}</span></span>`;
    return escapeEditorText(part).replace(/\n/g, "<br>");
  }).join("");
}

const RichEditor = React.forwardRef(function RichEditor({ value, onChange, onKeyDown, onFiles, placeholder }, ref) {
  const nodeRef = useRef(null);
  React.useImperativeHandle(ref, () => ({
    focus: () => nodeRef.current?.focus(),
    format: command => { nodeRef.current?.focus(); document.execCommand(command, false); },
    insertText: text => {
      const node = nodeRef.current;
      if (!node) return;
      node.focus();
      const selection = window.getSelection?.();
      if (!selection || !selection.rangeCount || !node.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      document.execCommand("insertText", false, String(text || ""));
      onChange?.(readRichEditor(node), node.innerHTML);
    },
  }));
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (readRichEditor(node) !== String(value || "")) renderRichEditor(node, value);
  }, [value]);
  return h("div", { ref: nodeRef, className: "rich-editor", contentEditable: true, role: "textbox", "aria-label": placeholder, "data-placeholder": placeholder, suppressContentEditableWarning: true,
    onInput: event => onChange?.(readRichEditor(event.currentTarget), event.currentTarget.innerHTML),
    onKeyDown,
    onPaste: event => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); onFiles?.(files); return; } event.preventDefault(); const text = event.clipboardData?.getData("text/plain") || ""; document.execCommand("insertText", false, text); },
    onDragOver: event => { event.preventDefault(); event.currentTarget.classList.add("drag-active"); },
    onDragLeave: event => event.currentTarget.classList.remove("drag-active"),
    onDrop: event => { event.preventDefault(); event.currentTarget.classList.remove("drag-active"); const files = [...(event.dataTransfer?.files || [])]; if (files.length) onFiles?.(files); },
  });
});

function normalizeHomeserverInput(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请输入 Homeserver 或域名");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("请输入有效的 Matrix 域名");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("请输入有效的 Matrix 域名");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

async function fetchWithTimeout(input, init = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function promiseWithTimeout(promise, timeoutMs = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Matrix 登录请求超时，请检查服务器或网络")), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getMatrixLoginFlows(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/_matrix/client/v3/login`, {}, 5000);
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.flows)) throw new Error("无法读取 Matrix 登录方式");
  return body.flows.map(flow => flow?.type).filter(Boolean);
}

async function loginWithMatrixToken(homeserver, token) {
  const resolved = await resolveHomeserver(homeserver);
  const loginClient = MatrixSDK.createClient({ baseUrl: resolved.clientBaseUrl, cryptoCallbacks: orbitCryptoCallbacks });
  const result = await promiseWithTimeout(loginClient.login("m.login.token", { token }));
  const client = MatrixSDK.createClient({ baseUrl: resolved.clientBaseUrl, userId: result.user_id, accessToken: result.access_token, deviceId: result.device_id, cryptoCallbacks: orbitCryptoCallbacks });
  await initCryptoSafely(client);
  return { resolved, result, client };
}

async function resolveHomeserver(input, { detect = true } = {}) {
  let homeserver = normalizeHomeserverInput(input);
  try {
    const discovery = await fetchWithTimeout(`${homeserver}/.well-known/matrix/client`, {}, 2500);
    if (discovery.ok) {
      const config = await discovery.json();
      const discovered = config?.["m.homeserver"]?.base_url;
      if (discovered) homeserver = normalizeHomeserverInput(discovered);
    }
  } catch {}
  let clientBaseUrl = homeserver;
  if (!detect) {
    const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (local) clientBaseUrl = `${window.location.origin}/__matrix_proxy/${encodeURIComponent(homeserver)}`;
    return { homeserver, clientBaseUrl, slidingSync: false, detectionPending: true };
  }
  let versions = null;
  try {
    const probe = await fetchWithTimeout(`${homeserver}/_matrix/client/versions`);
    versions = await probe.json();
    if (!probe.ok || !Array.isArray(versions?.versions)) throw new Error("Matrix API invalid");
  } catch (error) {
    const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!local) throw new Error(`无法连接 Matrix homeserver：${error?.message || "网络错误"}`);
    clientBaseUrl = `${window.location.origin}/__matrix_proxy/${encodeURIComponent(homeserver)}`;
    const probe = await fetchWithTimeout(`${clientBaseUrl}/_matrix/client/versions`);
    versions = await probe.json().catch(() => null);
    if (!probe.ok || !Array.isArray(versions?.versions)) throw new Error("Invalid Matrix homeserver");
  }
  const unstable = versions?.unstable_features || {};
  const slidingSync = unstable["org.matrix.simplified_msc3575"] === true || unstable["org.matrix.msc3575"] === true;
  return { homeserver, clientBaseUrl, slidingSync };
}

// Use MSC3575 when the homeserver advertises it; otherwise retain /sync.
async function startOrbitSync(client, { clientBaseUrl, slidingSync = false } = {}) {
  const fallback = () => client.startClient({ initialSyncLimit: 30 });
  if (!slidingSync || typeof SlidingSync !== "function") return fallback();
  try {
    const lists = new Map([
      ["all", { ranges: [[0, 50]], sort: ["by_recency"], filters: { is_invite: false }, required_state: [["m.room.create", ""], ["m.room.name", ""], ["m.room.avatar", ""], ["m.room.encryption", ""], ["m.room.member", "*"], ["m.room.topic", ""], ["m.space.child", "*"], ["m.space.parent", "*"]], timeline_limit: 30 }],
      ["invites", { ranges: [[0, 20]], sort: ["by_recency"], filters: { is_invite: true }, required_state: [["m.room.create", ""], ["m.room.name", ""], ["m.room.avatar", ""], ["m.room.encryption", ""], ["m.room.member", "*"], ["m.room.topic", ""], ["m.space.child", "*"], ["m.space.parent", "*"]], timeline_limit: 30 }]
    ]);
    const roomSubscriptionInfo = { required_state: [["m.room.create", ""], ["m.room.name", ""], ["m.room.avatar", ""], ["m.room.encryption", ""], ["m.room.member", "*"], ["m.room.topic", ""], ["m.space.child", "*"], ["m.space.parent", "*"]], timeline_limit: 30 };
    const slidingClient = new SlidingSync(clientBaseUrl, lists, roomSubscriptionInfo, client, 30000);
    client.startClient({ initialSyncLimit: 30, slidingSync: slidingClient });
    client.__orbitSlidingSync = slidingClient;
  } catch (error) {
    console.warn("Unable to start Sliding Sync; using regular sync", error);
    fallback();
  }
}

async function initCryptoSafely(client) {
  if (typeof client?.initRustCrypto !== "function") return false;
  const identity = `${client.getUserId?.() || "anonymous"}:${client.getDeviceId?.() || "unknown"}`;
  let storageKey;
  try { storageKey = new Uint8Array(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))); } catch {}
  const init = () => Promise.race([
    client.initRustCrypto({ useIndexedDB: true, ...(storageKey ? { storageKey } : {}) }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("加密模块初始化超时")), 20000)),
  ]);
  try {
    await init();
    return true;
  } catch (error) {
    const mismatch = /account in the store doesn't match|doesn't match the account|unknown deviceId|failed to be decrypted while unpickling|unpickling|store.*decrypt|decrypt.*store/i.test(error?.message || "");
    if (mismatch && typeof client.clearStores === "function") {
      try { await client.clearStores(); await init(); return true; } catch (retryError) { console.warn("清理旧设备加密存储后仍无法初始化", retryError); }
    }
    console.warn("E2EE 初始化未完成，将先连接并显示加密占位消息", error);
    return false;
  }
}

const orbitCryptoCallbacks = {
  getSecretStorageKey: async ({ keys }) => {
    const recoveryKey = window.orbitRecoveryKeyBytes;
    if (!recoveryKey) return null;
    const keyId = Object.keys(keys || {})[0];
    return keyId ? [keyId, recoveryKey] : null;
  },
};

function localVerificationKey(client) {
  const userId = client?.getUserId?.() || "anonymous";
  const deviceId = client?.getDeviceId?.() || "unknown";
  return `orbit.matrix.device-verified:${userId}:${deviceId}`;
}

function roomToView(room, client) {
  const last = room.getLastLiveEvent?.();
  const name = room.name || room.getCanonicalAlias?.() || room.roomId;
  const lastContent = last?.getClearContent?.() || last?.getContent?.() || {};
  const isEncrypted = last?.getType?.() === "m.room.encrypted";
  const joinedMembers = room.getJoinedMembers?.() || [];
  const myUserId = client?.getUserId?.();
  const otherMember = joinedMembers.find(member => member.userId !== myUserId);
  const directMap = client?.getAccountData?.("m.direct")?.getContent?.() || {};
  const directRoom = Object.values(directMap).some(ids => Array.isArray(ids) && ids.includes(room.roomId));
  // Only mark a room as a DM when Matrix explicitly identifies it as direct
  // (or it is present in m.direct). Small group rooms must remain groups.
  const directUserId = directRoom ? otherMember?.userId : (room.isDirect?.() ? otherMember?.userId : null);
  const directMember = directUserId && room.getMember?.(directUserId);
  const unread = Number(room.getUnreadNotificationCount?.() || 0);
  return {
    id: room.roomId,
    name,
    initials: initials(name),
    color: colorFor(room.roomId),
    preview: lastContent?.body || (isEncrypted ? "🔒 加密消息" : "暂无消息"),
    time: last?.getTs?.() ? new Date(last.getTs()).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "",
    lastTs: last?.getTs?.() || 0,
    unread,
    hasUnread: unread > 0,
    members: room.getJoinedMemberCount?.() || room.getJoinedMembers?.().length || 0,
    desc: room.getCanonicalAlias?.() || room.roomId,
    avatarUrl: room.getAvatarUrl?.(client?.getHomeserverUrl?.() || "", 64, 64, "crop", false, true, true) || null,
    avatarMxc: roomAvatarMxc(room) || (joinedMembers.length <= 2 ? memberAvatarMxc(directMember) : null),
    directUserId: joinedMembers.length <= 2 ? directUserId : null,
    pinnedEventIds: (() => { const event = room.currentState?.getStateEvents?.("m.room.pinned_events", ""); const content = Array.isArray(event) ? event[0]?.getContent?.() : event?.getContent?.(); return Array.isArray(content?.pinned) ? content.pinned : []; })(),
    isDirect: Boolean(directUserId),
    isGroup: room.getType?.() !== "m.space" && !directUserId,
    isSpace: room.getType?.() === "m.space",
    matrixRoom: room,
    hidden: Boolean(window.orbitExcludedRooms?.has(room.roomId)),
  };
}

function spaceChildIds(space) {
  if (!space) return [];
  if (typeof space.getSpaceChildren === "function") {
    try {
      const children = space.getSpaceChildren();
      if (children && (Array.isArray(children) || typeof children[Symbol.iterator] === "function")) return [...children].map(child => child?.roomId || child?.room_id || child?.id || child).filter(Boolean);
    } catch {}
  }
  const state = space.currentState;
  let events = [];
  try { events = state?.getStateEvents?.("m.space.child") || []; } catch {}
  if (!Array.isArray(events)) events = [events];
  return events.filter(Boolean).filter(event => {
    const content = event.getContent?.() || event.content || {};
    return content.via || content.order || content.suggest || event.getStateKey?.();
  }).map(event => event.getStateKey?.() || event.stateKey || event.getStateKey).filter(Boolean);
}

function roomParentSpaceIds(room) {
  const state = room?.currentState;
  let events = [];
  try { events = state?.getStateEvents?.("m.space.parent") || []; } catch {}
  if (!Array.isArray(events)) events = [events];
  return events.filter(Boolean).map(event => event.getStateKey?.() || event.stateKey).filter(Boolean);
}

function formatMentions(text, room) {
  if (!text || !room) return text || "";
  return String(text).replace(/@[A-Za-z0-9._=\-/+]+:[A-Za-z0-9.-]+/g, token => room.getMember?.(token)?.name || token);
}

function stripReplyFallback(text) {
  return String(text || "").replace(/^\s*(?:in reply to[^\n]*(?:\n|$))?/i, "").replace(/^(?:>[^\n]*(?:\n|$))+\s*/, "").trim();
}

function stripReplyHtml(html) {
  return String(html || "").replace(/<mx-reply[\s\S]*?<\/mx-reply>/gi, "").replace(/^\s*(?:in reply to[^<]*(?:<br\s*\/?>|$))/i, "").trim();
}

function sanitizeFormattedBody(html) {
  // Matrix clients commonly wrap each line in <p>/<div>. Removing those
  // tags outright joins every line into one paragraph, so turn block ends
  // into explicit breaks before stripping unsupported markup.
  return String(html || "")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi, "<br>")
    .replace(/<\s*(p|div|li|h[1-6]|blockquote|pre|tr)(?:\s[^>]*)?>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/<(?!\/?(?:img|br|a)\b)[^>]*>/gi, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(?:<br>\s*)+$/i, "")
    .trim();
}

function mentionHtml(text, mentions = []) {
  let html = String(text || "").replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])).replace(/\n/g, "<br>");
  for (const mention of mentions || []) {
    const name = String(mention?.name || "").replace(/^@/, "").trim();
    const userId = String(mention?.userId || "").trim();
    if (!name || !userId) continue;
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matrixTarget = encodeURIComponent(userId).replace(/%40/gi, "@").replace(/%3A/gi, ":");
    html = html.replace(new RegExp(`@${safeName}(?=\\s|$)`, "g"), `<a href="https://matrix.to/#/${matrixTarget}">@${name}</a>`);
  }
  return html;
}

function eventToMessage(event, room, userId) {
  const eventType = event.getClearType?.() || event.getType?.();
  const encrypted = event.getType?.() === "m.room.encrypted" || event.isEncrypted?.();
  const content = event.getClearContent?.() || event.getContent?.() || {};
  const stickerEvent = eventType === "m.sticker";
  if (eventType !== "m.room.message" && !stickerEvent && !encrypted) return null;
  if (encrypted && eventType === "m.room.encrypted") {
    const sender = event.getSender?.() || "";
    const member = room.getMember?.(sender);
    const displayName = member?.name || sender;
    const failed = event.isDecryptionFailure?.() || !event.getClearContent?.();
    return {
      id: event.getId?.() || `${sender}-${event.getTs?.()}`, event, encrypted: true,
      decryptFailed: failed, needsKeyBackup: failed,
      decryptReason: event.decryptionFailureReason?.() || "缺少会话密钥",
      author: sender === userId ? "你" : displayName, handle: sender,
      avatar: initials(displayName), avatarMxc: memberAvatarMxc(member), color: colorFor(sender),
      time: event.getTs?.() ? new Date(event.getTs()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
      text: failed ? "此消息已加密，当前设备缺少解密密钥" : (content.body || ""), isMe: sender === userId,
    };
  }
  const msgtype = stickerEvent ? "m.sticker" : content.msgtype;
  if (!["m.text", "m.notice", "m.emote", "m.image", "m.file", "m.video", "m.audio", "m.sticker"].includes(msgtype)) return null;
  const sender = event.getSender?.() || "";
  const member = room.getMember?.(sender);
  const displayName = member?.name || sender;
  const avatarMxc = memberAvatarMxc(member);
  const reply = content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
  const threadRoot = content["m.relates_to"]?.rel_type === "m.thread" ? content["m.relates_to"]?.event_id : null;
  const replacement = content["m.relates_to"]?.rel_type === "m.replace";
  const body = replacement ? (content["m.new_content"]?.body || content.body || "") : (content.body || "");
  const cleanBody = reply ? stripReplyFallback(body) : body;
  const emojiNames = [...String(cleanBody || "").matchAll(/:([^:\s]+):/g)].map(match => match[1]);
  const emojiFiles = content["org.orbit.emoji_files"] || (content.file && emojiNames.length ? Object.fromEntries(emojiNames.map(name => [name, content.file])) : null);
  if (emojiFiles && typeof emojiFiles === "object") window.orbitEncryptedEmojiFiles = { ...(window.orbitEncryptedEmojiFiles || {}), ...emojiFiles };
  const formatted = content.format === "org.matrix.custom.html" && content.formatted_body ? sanitizeFormattedBody(reply ? stripReplyHtml(content.formatted_body) : content.formatted_body) : null;
  // A few clients send a formatted body without any block markers while the
  // plain Matrix body still contains the authoritative line breaks.  Prefer
  // that plain body in this case so copied multi-line messages stay readable.
  const formattedHasBreaks = /<br\b/i.test(String(content.formatted_body || "")) || /<\/(?:p|div|li|h[1-6]|blockquote|pre)>/i.test(String(content.formatted_body || ""));
  const updatedMeta = content["org.orbit.updated"] || null;
  const updatedMember = updatedMeta?.user_id ? room.getMember?.(updatedMeta.user_id) : null;
  return {
    id: event.getId?.() || `${sender}-${event.getTs?.()}`, roomId: room.roomId,
    event,
    author: sender === userId ? "你" : displayName,
    handle: sender,
    avatar: initials(displayName),
    avatarMxc,
    color: colorFor(sender),
    time: event.getTs?.() ? new Date(event.getTs()).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "",
    text: formatMentions(cleanBody, room),
    formattedBody: formatted && (!String(cleanBody || "").includes("\n") || formattedHasBreaks) ? formatted : null,
    emojiFiles: content["org.orbit.emoji_files"] || null,
    emojiItems: Array.isArray(content["org.orbit.emoji_items"]) ? content["org.orbit.emoji_items"] : null,
    updatedBy: updatedMember?.name || updatedMeta?.user_id || null,
    updatedAt: Number(updatedMeta?.ts) || 0,
    isMe: sender === userId,
    replyTo: reply,
    threadRoot,
    edited: replacement,
    attachment: ["m.image", "m.file", "m.video", "m.audio", "m.sticker"].includes(msgtype) ? { name: content.body, url: content.url || content.file?.url, file: content.file, info: content.info || null, emoji: msgtype === "m.image" && (Array.isArray(content["org.orbit.emoji_items"]) || (content.body === "表情" && Number(content.info?.w || 0) <= 96 && Number(content.info?.h || 0) <= 96)), sticker: msgtype === "m.sticker" || content["org.orbit.sticker"] === true, type: msgtype === "m.sticker" ? "m.image" : msgtype } : null,
  };
}

async function retryLoadedRoomDecryption(client) {
  if (!client?.decryptEventIfNeeded) return 0;
  const encryptedEvents = [];
  for (const room of client.getRooms?.() || []) {
    for (const event of room.getLiveTimeline?.().getEvents?.() || []) {
      if (event?.getType?.() === "m.room.encrypted" || event?.isEncrypted?.()) encryptedEvents.push(event);
    }
  }
  await Promise.all(encryptedEvents.map(event => Promise.resolve(client.decryptEventIfNeeded(event)).catch(() => {})));
  return encryptedEvents.length;
}

async function roomMessages(room, userId, client) {
  const events = room?.getLiveTimeline?.().getEvents?.() || [];
  const redacted = new Set(); const reactions = new Map(); const edits = new Map(); const replacements = new Map(); const updates = new Map(); const byId = new Map();
  events.forEach(event => {
    if (event.getType?.() === "m.room.redaction") { const id = event.getRedacts?.() || event.getContent?.()?.redacts; if (id) redacted.add(id); return; }
    if (event.getType?.() === "m.reaction") { const relation = event.getContent?.()?.["m.relates_to"]; if (relation?.event_id) { const list = reactions.get(relation.event_id) || []; list.push({ id: event.getId?.(), key: relation.key || "👍", sender: event.getSender?.() }); reactions.set(relation.event_id, list); } return; }
    const clearType = event.getClearType?.() || event.getType?.();
    if (clearType !== "m.room.message" && clearType !== "m.sticker" && event.getType?.() !== "m.room.encrypted") return;
    const eventContent = event.getClearContent?.() || event.getContent?.() || {};
    const relation = eventContent["m.relates_to"];
    if (relation?.rel_type === "m.replace" && relation.event_id) { const nextContent = eventContent?.["m.new_content"] || eventContent; edits.set(relation.event_id, nextContent?.body || eventContent?.body || ""); replacements.set(relation.event_id, nextContent); const updated = eventContent?.["org.orbit.updated"] || nextContent?.["org.orbit.updated"]; if (updated) updates.set(relation.event_id, updated); return; }
    const message = eventToMessage(event, room, userId); if (message) byId.set(message.id, message);
  });
  const members = room?.getJoinedMembers?.() || [];
  byId.forEach((message, id) => { if (redacted.has(id)) { byId.delete(id); return; } if (edits.has(id)) { message.text = edits.get(id); message.edited = true; } const reactionCounts = {}; (reactions.get(id) || []).forEach(reaction => { if (!reaction.id || redacted.has(reaction.id)) return; reactionCounts[reaction.key] = (reactionCounts[reaction.key] || 0) + 1; }); message.reactions = reactionCounts; const reply = message.replyTo ? byId.get(message.replyTo) : null; if (reply) { message.replyPreview = reply.text; message.replyAuthor = reply.author; message.replyAvatarMxc = reply.avatarMxc; } const thread = message.threadRoot ? byId.get(message.threadRoot) : null; if (thread) { message.threadPreview = thread.text || thread.attachment?.name || "消息"; message.threadAuthor = thread.author; message.threadAvatarMxc = thread.avatarMxc; } });
  replacements.forEach((replacement, id) => { const message = byId.get(id); if (!message || !replacement) return; if (message.attachment && ["m.image", "m.file", "m.video", "m.audio"].includes(replacement.msgtype)) { message.attachment = { ...message.attachment, name: replacement.body || message.attachment.name, url: replacement.url || replacement.file?.url || message.attachment.url, file: replacement.file || message.attachment.file, info: replacement.info || message.attachment.info, type: replacement.msgtype }; } });
  updates.forEach((updated, id) => { const message = byId.get(id); if (!message) return; message.updatedAt = Number(updated.ts) || 0; const member = room.getMember?.(updated.user_id); message.updatedBy = member?.name || updated.user_id || null; });
  // A receipt is a moving marker, not a badge that belongs on every message.
  // Find the latest event read by each member, then render that member only
  // beneath the corresponding message (as mature Matrix clients do).
  if (room?.hasUserReadEvent) {
    const ordered = [...byId.values()];
    const latestByUser = new Map();
    members.filter(member => member.userId !== userId).forEach(member => {
      const receiptTarget = room.getEventReadUpTo?.(member.userId, true);
      const receiptIndex = receiptTarget ? ordered.findIndex(candidate => candidate.id === receiptTarget) : -1;
      const startIndex = receiptIndex >= 0 ? receiptIndex : ordered.length - 1;
      for (let index = startIndex; index >= 0; index -= 1) {
        const candidate = ordered[index];
        if (receiptIndex >= 0 || room.hasUserReadEvent(member.userId, candidate.id)) {
          latestByUser.set(member.userId, candidate.id);
          break;
        }
      }
    });
    latestByUser.forEach((messageId, memberId) => {
      const message = byId.get(messageId);
      const member = members.find(item => item.userId === memberId);
      if (!message || !member) return;
      const receipt = room.getLastUnthreadedReceiptFor?.(memberId);
      const wrappedReceipt = room.getReadReceiptForUserId?.(memberId, true);
      const entry = { userId: memberId, name: member.name || memberId, ts: receipt?.ts || wrappedReceipt?.data?.ts || null };
      message.readBy = [...(message.readBy || []), entry].sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    });
  }
  // Keep a generous window so “加载更早的消息” can prepend a page while
  // still avoiding an unbounded DOM for very large rooms.
  const result = [...byId.values()].slice(-300);
  return result.length ? result : [{ type: "empty", label: "这个房间还没有消息，发一条问候吧" }];
}

function LoginDialog({ onConnected, onClose }) {
  const [homeserver, setHomeserver] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginFlows, setLoginFlows] = useState([]);
  const [checkingFlows, setCheckingFlows] = useState(false);
  const checkLoginFlows = async () => {
    if (!homeserver.trim()) return;
    setCheckingFlows(true);
    try {
      const resolved = await resolveHomeserver(homeserver, { detect: false });
      setLoginFlows(await getMatrixLoginFlows(resolved.clientBaseUrl));
    } catch { setLoginFlows([]); }
    finally { setCheckingFlows(false); }
  };
  const startSsoLogin = async () => {
    setLoading(true);
    try {
      const resolved = await resolveHomeserver(homeserver, { detect: false });
      const flows = await getMatrixLoginFlows(resolved.clientBaseUrl);
      if (!flows.includes("m.login.sso")) throw new Error("当前 homeserver 未启用 SSO 登录");
      const redirectUrl = `${window.location.origin}${window.location.pathname}?matrix_sso=1`;
      localStorage.setItem("orbit.matrix.sso.pending", JSON.stringify({ homeserver: resolved.homeserver }));
      window.location.assign(`${resolved.clientBaseUrl}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(redirectUrl)}`);
    } catch (error) { setLoading(false); Toast.error(`SSO 登录失败：${error?.message || "无法启动单点登录"}`); }
  };
  const submit = async e => {
    e.preventDefault(); setLoading(true);
    try {
      const input = normalizeHomeserverInput(homeserver);
      const resolved = await resolveHomeserver(input, { detect: false });
      let detectedResolved = null;
      const detectionPromise = resolveHomeserver(input).then(value => { detectedResolved = value; return value; }).catch(() => null);
      const loginClient = MatrixSDK.createClient({ baseUrl: resolved.clientBaseUrl, cryptoCallbacks: orbitCryptoCallbacks });
      const result = await promiseWithTimeout(loginClient.login("m.login.password", { identifier: { type: "m.id.user", user: username.trim() }, password }));
      const client = MatrixSDK.createClient({ baseUrl: resolved.clientBaseUrl, userId: result.user_id, accessToken: result.access_token, deviceId: result.device_id, cryptoCallbacks: orbitCryptoCallbacks });
      await initCryptoSafely(client);
      localStorage.setItem("orbit.matrix.session", JSON.stringify({ homeserver: resolved.homeserver, userId: result.user_id, accessToken: result.access_token, deviceId: result.device_id }));
      window.orbitMatrixClient = client;
      const syncResolved = detectedResolved || resolved;
      onConnected({ client, userId: result.user_id, homeserver: syncResolved.homeserver });
      startOrbitSync(client, syncResolved);
      detectionPromise.then(detected => {
        if (detected?.slidingSync && !syncResolved.slidingSync) Toast.info("已检测到 Sliding Sync，下次登录时启用");
      });
      Toast.success("登录成功，正在同步房间");
    } catch (error) { Toast.error(`登录失败：${error?.message || "请检查地址、账号和密码"}`); }
    finally { setLoading(false); }
  };
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card" },
    h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "连接 Matrix 账户"), h("div", { className: "modal-copy" }, "支持直接填写域名，Orbit 会自动补全 HTTPS；服务能力在后台检测，不影响登录。")), h(UiButton, { className: "icon-button", type: "text", "aria-label": "关闭", onClick: onClose }, "×")),
    h("form", { className: "modal-form", onSubmit: submit },
      h("label", { className: "form-label" }, "Homeserver 或域名", h(Input, { value: homeserver, onChange: setHomeserver, onBlur: checkLoginFlows, required: true, placeholder: "mtx01.cc、matrix.example.com 或 https://matrix.example.com" })),
      h("label", { className: "form-label" }, "用户名", h(Input, { value: username, onChange: setUsername, required: true, placeholder: "alice 或 @alice:example.com" })),
      h("label", { className: "form-label" }, "密码", h(AntInput.Password, { value: password, onChange: event => setPassword(event.target.value), required: true, placeholder: "请输入 Matrix 密码", visibilityToggle: true })),
      h("div", { className: "modal-actions" }, h(UiButton, { htmlType: "button", className: "ghost-btn", onClick: onClose }, "取消"), loginFlows.includes("m.login.sso") && h(UiButton, { htmlType: "button", className: "ghost-btn", disabled: loading || checkingFlows, onClick: startSsoLogin }, "使用 SSO 登录"), h(UiButton, { htmlType: "submit", variant: "primary", className: "primary-btn", disabled: loading }, loading ? "登录中…" : "登录并同步"))
    )
  ));
}

function UserPicker({ client, value, onChange, placeholder }) {
  const [options, setOptions] = useState([]); const [focused, setFocused] = useState(false); const timer = useRef(null);
  const search = next => { onChange(next); clearTimeout(timer.current); if (!next.trim()) { setOptions([]); return; } timer.current = setTimeout(async () => { try { const result = await client.searchUserDirectory?.({ term: next.trim(), limit: 20 }); setOptions(result?.results || []); } catch { setOptions([]); } }, 220); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const select = user => { onChange(user.user_id); setOptions([]); setFocused(false); };
  return h("div", { className: "user-picker" },
    h(Input, { value, onChange: search, onFocus: () => setFocused(true), showClear: true, placeholder }),
    focused && options.length > 0 && h("div", { className: "user-picker-menu" }, options.map(user =>
      h("button", { type: "button", className: "user-option", key: user.user_id, onMouseDown: e => e.preventDefault(), onClick: () => select(user) },
        h(MatrixAvatar, { client, mxcUrl: user.avatar_url, size: 32, className: "user-option-avatar", fallback: initials(user.display_name || user.user_id), alt: user.display_name || user.user_id }),
        h("span", { className: "user-option-copy" }, h("strong", null, user.display_name || user.user_id), h("small", null, user.user_id))
      )
    ))
  );
}

function RoomDialog({ client, onClose, onCreated, space }) {
  const [name, setName] = useState(""); const [invite, setInvite] = useState(""); const [encrypted, setEncrypted] = useState(true); const [loading, setLoading] = useState(false);
  const submit = async e => { e.preventDefault(); setLoading(true); try { const invites = invite.split(/[\s,]+/).map(s => s.trim()).filter(Boolean); const result = await client.createRoom({ name: name.trim(), invite: invites, ...(encrypted ? { initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }] } : {}) }); if (space?.id) { const via = [new URL(client.getHomeserverUrl?.() || location.origin).host]; await client.sendStateEvent(space.id, "m.space.child", { via, order: String(Date.now()) }, result.room_id); await client.sendStateEvent(result.room_id, "m.space.parent", { via, canonical: true }, space.id); } Toast.success(space?.id ? "房间已创建并加入空间" : "房间创建成功"); onCreated(result.room_id); onClose(); } catch (error) { Toast.error(`创建房间失败：${error?.message || "未知错误"}`); } finally { setLoading(false); } };
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, space?.id ? "在空间中创建房间" : "创建 Matrix 房间"), h("div", { className: "modal-copy" }, space?.id ? `创建后会自动加入「${space.name}」` : "创建后会自动加入房间。输入昵称或 Matrix ID 选择成员。")), h("button", { className: "icon-button", onClick: onClose }, "×")), h("form", { className: "modal-form", onSubmit: submit }, h("label", { className: "form-label" }, "房间名称", h(Input, { value: name, onChange: setName, required: true, placeholder: "例如：产品设计组" })), h("label", { className: "form-label" }, "邀请成员（可选）", h(UserPicker, { client, value: invite, onChange: setInvite, placeholder: "输入昵称或 @user:server" })), h("label", { className: "encryption-choice" }, h(AntCheckbox, { checked: encrypted, onChange: event => setEncrypted(event.target.checked) }), h("span", null, h("strong", null, "启用端到端加密"), h("small", null, "使用 Matrix Megolm；创建后无法关闭"))), h("div", { className: "modal-actions" }, h("button", { type: "button", className: "ghost-btn", onClick: onClose }, "取消"), h("button", { className: "primary-btn", disabled: loading }, loading ? "创建中…" : "创建房间")))));
}

function InviteDialog({ client, room, onClose }) {
  const [userId, setUserId] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async e => { e.preventDefault(); setLoading(true); try { const targetUserId = userId.trim(); const crypto = client.getCrypto?.(); if (room.matrixRoom?.hasEncryptionStateEvent?.() && crypto?.shareRoomHistoryWithUser && targetUserId) { try { await crypto.shareRoomHistoryWithUser(room.id, targetUserId); } catch (error) { console.warn("Unable to share encrypted history", error); } } await client.invite(room.id, targetUserId); Toast.success(room.matrixRoom?.hasEncryptionStateEvent?.() ? "邀请已发送，并共享可用的加密历史" : "邀请已发送"); onClose(); } catch (error) { Toast.error(`邀请失败：${error?.message || "请确认 Matrix ID"}`); } finally { setLoading(false); } };
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "邀请成员"), h("div", { className: "modal-copy" }, `邀请成员加入「${room.name}」`)), h("button", { className: "icon-button", onClick: onClose }, "×")), h("form", { className: "modal-form", onSubmit: submit }, h("label", { className: "form-label" }, "成员", h(UserPicker, { client, value: userId, onChange: setUserId, placeholder: "输入昵称或 @user:server" })), h("div", { className: "modal-actions" }, h("button", { type: "button", className: "ghost-btn", onClick: onClose }, "取消"), h("button", { className: "primary-btn", disabled: loading }, loading ? "邀请中…" : "发送邀请")))));
}

function LegacyAccountDialog({ client, onClose, onBack, cryptoState, onRestore }) {
  const [devices, setDevices] = useState([]); const [loading, setLoading] = useState(true); const [displayName, setDisplayName] = useState(() => client.getUser?.(client.getUserId?.())?.displayName || ""); const [profileSaving, setProfileSaving] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState(""); const [passphrase, setPassphrase] = useState(""); const [verification, setVerification] = useState(null);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  React.useEffect(() => { Promise.resolve(client.getDevices ? client.getDevices() : { devices: [] }).then(async data => { const list = data?.devices || []; setDevices(list); const crypto = client.getCrypto?.(); if (crypto?.getDeviceVerificationStatus) { const statuses = {}; await Promise.all(list.map(async device => { try { statuses[device.device_id] = await crypto.getDeviceVerificationStatus(client.getUserId(), device.device_id); } catch {} })); setDeviceStatuses(statuses); } }).catch(() => {}).finally(() => setLoading(false)); }, [client]);
  React.useEffect(() => { const crypto = client.getCrypto?.(); const currentUserId = client.getUserId?.(); const existing = crypto?.getVerificationRequestsToDeviceInProgress?.(currentUserId)?.[0]; if (existing) setVerification({ request: existing, deviceId: existing.otherDeviceId, status: existing.initiatedByMe ? "waiting" : "incoming" }); const onRequest = request => { if (request) setVerification({ request, deviceId: request.otherDeviceId, status: request.initiatedByMe ? "waiting" : "incoming" }); }; const eventName = MatrixSDK.CryptoEvent?.VerificationRequestReceived || "crypto.verificationRequestReceived"; client.on?.(eventName, onRequest); crypto?.on?.(eventName, onRequest); return () => { client.off?.(eventName, onRequest); crypto?.off?.(eventName, onRequest); }; }, [client]);
  const runVerification = async (request, deviceId) => { if (!request) return; setVerification({ request, deviceId, status: request.initiatedByMe ? "waiting" : "incoming" }); let started = false; const start = async () => { if (started || request.phase < 3) return; started = true; try { const verifier = request.verifier || await request.startVerification?.("m.sas.v1"); if (!verifier) throw new Error("当前设备不支持 SAS 验证"); const onSas = sasCallbacks => setVerification(value => ({ ...value, verifier, sas: sasCallbacks, status: "confirm" })); verifier.on?.("show_sas", onSas); verifier.on?.("cancel", error => setVerification(value => ({ ...value, verifier, status: "error", error: error?.message || "验证已取消" }))); setVerification(value => ({ ...value, verifier, status: "verifying" })); const existingSas = verifier.getShowSasCallbacks?.(); if (existingSas) onSas(existingSas); await verifier.verify(); const crypto = client.getCrypto?.(); if (crypto?.crossSignDevice && deviceId && deviceId !== client.getDeviceId?.()) await crypto.crossSignDevice(deviceId); await crypto?.setDeviceVerified?.(client.getUserId?.(), deviceId, true); const nextStatus = await Promise.resolve(crypto?.getDeviceVerificationStatus?.(client.getUserId?.(), deviceId)).catch(() => null); if (nextStatus) setDeviceStatuses(current => ({ ...current, [deviceId]: nextStatus })); setVerification(value => ({ ...value, verifier, status: "done" })); Toast.success("设备验证完成，已发布跨签名信任"); } catch (error) { setVerification(value => ({ ...value, status: "error", error: error?.message || "设备验证失败" })); } }; request.on?.("change", start); if (!request.initiatedByMe) { await request.accept?.(); } await start(); };
  const verify = async deviceId => { try { const crypto = client.getCrypto?.(); if (!crypto?.requestDeviceVerification) throw new Error("加密模块尚未就绪，请重新登录后再试"); const request = await crypto.requestDeviceVerification(client.getUserId(), deviceId); await runVerification(request, deviceId); Toast.info("验证请求已发送，请在另一台设备上接受"); } catch (error) { Toast.error(`无法发起设备验证：${error?.message || "请检查加密配置"}`); } };
  const confirmSas = async () => { try { await verification?.sas?.confirm?.(); setVerification(value => ({ ...value, status: "verifying" })); } catch (error) { setVerification(value => ({ ...value, status: "error", error: error?.message || "确认验证失败" })); } };
  const mismatchSas = () => { try { verification?.sas?.mismatch?.(); } catch {} setVerification(value => ({ ...value, status: "error", error: "安全码不匹配，验证已取消" })); };
  const cancelVerification = () => { try { if (verification?.status === "confirm") { verification?.sas?.mismatch?.(); setVerification(value => ({ ...value, status: "error", error: "安全码不匹配，验证已取消" })); return; } else { verification?.verifier?.cancel?.(new Error("用户取消验证")); verification?.request?.cancel?.(); } } catch {} setVerification(null); };
  const enableNotifications = async () => { if (typeof Notification === "undefined") { setNotificationPermission("unsupported"); return Toast.error("当前浏览器不支持桌面通知"); } const result = await Notification.requestPermission(); setNotificationPermission(result); Toast[result === "granted" ? "success" : "warning"](result === "granted" ? "桌面通知已开启" : "桌面通知未授权"); };
  const saveProfile = async () => { const value = displayName.trim(); if (!value) return; setProfileSaving(true); try { await client.setDisplayName?.(value); Toast.success("昵称已更新"); } catch (error) { Toast.error(`昵称更新失败：${error?.message || "请检查账户权限"}`); } finally { setProfileSaving(false); } };
  const backup = cryptoState?.backupInfo; const generatedSas = verification?.sas?.sas || verification?.sas || {}; const sasText = generatedSas?.emoji?.map(item => item[0]).join(" ") || generatedSas?.decimal?.join(" · ") || "";
  const localDeviceId = client.getDeviceId?.();
  const renderDevice = device => { const status = deviceStatuses[device.device_id]; const verified = Boolean(status?.crossSigningVerified); const locallyTrusted = Boolean(status?.localVerified); return h("div", { className: `device-row ${verified ? "device-row-verified" : locallyTrusted ? "device-row-local-trusted" : ""}`, key: device.device_id }, h("div", { className: "device-icon" }, verified ? "✓" : locallyTrusted ? "•" : "▣"), h("div", { className: "device-copy" }, h("div", null, device.display_name || "未命名设备", device.device_id === localDeviceId && h("span", { className: "device-current" }, "本机"), verified && h("span", { className: "device-verified-mini" }, "跨设备已验证"), !verified && locallyTrusted && h("span", { className: "device-local-mini" }, "本地信任")), h("div", { className: "device-id" }, device.device_id)), verified ? h("span", { className: "device-state" }, "可信设备") : h(UiButton, { className: "ghost-btn", onClick: () => verify(device.device_id) }, locallyTrusted ? "发布验证" : "验证")); };
   return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card security-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "设备与安全"), h("div", { className: "modal-copy" }, "恢复密钥、设备验证和端到端加密。")), h("div", { className: "modal-head-actions" }, h(UiButton, { className: "ghost-btn settings-back-button", onClick: onBack }, "返回设置"), h(UiButton, { className: `ghost-btn notification-toggle ${notificationPermission === "granted" ? "notification-enabled" : ""}`, onClick: enableNotifications }, notificationPermission === "granted" ? "通知已开启" : "开启桌面通知"), h(UiButton, { className: "icon-button", type: "text", "aria-label": "关闭", onClick: onClose }, "×"))),
    h("div", { className: "settings-overview" }, h("div", { className: "settings-section-label" }, "我的账户"), h("div", { className: "settings-profile-row" }, h("div", { className: "settings-profile-copy" }, h("strong", null, client.getUser?.(client.getUserId?.())?.displayName || client.getUserId?.()), h("span", null, client.getUserId?.())), h("span", { className: "profile-online" }, "在线")), h("div", { className: "settings-profile-edit" }, h(Input, { value: displayName, onChange: setDisplayName, placeholder: "修改显示昵称" }), h(UiButton, { size: "small", variant: "primary", disabled: profileSaving || !displayName.trim(), onClick: saveProfile }, profileSaving ? "保存中…" : "保存昵称")), h("div", { className: "settings-section-label" }, "偏好设置"), h("div", { className: "settings-preference-grid" }, h("div", { className: "settings-preference-card" }, h("strong", null, "桌面通知"), h("span", null, notificationPermission === "granted" ? "已开启新消息提醒" : "新消息到达时提醒"), h(UiButton, { size: "small", onClick: enableNotifications }, notificationPermission === "granted" ? "已开启" : "开启")), h("div", { className: "settings-preference-card" }, h("strong", null, "界面主题"), h("span", null, "当前为浅色企业主题"), h(UiButton, { size: "small", onClick: () => Toast.info("主题设置已使用当前企业浅色方案") }, "浅色")), h("div", { className: "settings-preference-card" }, h("strong", null, "会话"), h("span", null, "此设备的 Matrix 登录会话"), h(UiButton, { size: "small", danger: true, onClick: onClose }, "关闭设置")))),
    h("section", { className: "backup-section" }, h("div", { className: "backup-title" }, "加密消息恢复"),
      h("div", { className: "backup-status" }, !cryptoState?.available ? "正在初始化加密模块…" : backup ? `服务器备份：${backup.version ? `版本 ${backup.version}` : "已启用"}${backup.count != null ? ` · ${backup.count} 个会话` : ""}` : "未发现服务器密钥备份", cryptoState?.activeVersion && h("span", null, ` · 当前版本 ${cryptoState.activeVersion}`), cryptoState?.keyRestored && h("span", { className: "verified-badge" }, "密钥已恢复"), cryptoState?.verified && h("span", { className: "verified-badge" }, "跨设备已验证"), !cryptoState?.verified && cryptoState?.localTrusted && h("span", { className: "local-trusted-badge" }, "本机已信任")),
      h("div", { className: "security-status-grid" },
        h("div", { className: "security-status-card" }, h("span", null, "加密验证状态"), h("strong", { className: cryptoState?.verified ? "status-ok" : "status-pending" }, cryptoState?.verified ? "已验证" : "未验证")),
        h("div", { className: "security-status-card" }, h("span", null, "本机设备状态"), h("strong", { className: cryptoState?.verified || cryptoState?.localTrusted ? "status-ok" : "status-pending" }, cryptoState?.verified ? "跨设备可信" : cryptoState?.localTrusted ? "本机已信任" : "待验证")),
        h("div", { className: "security-status-card" }, h("span", null, "密钥状态"), h("strong", { className: cryptoState?.keyRestored || backup ? "status-ok" : "status-pending" }, cryptoState?.keyRestored ? "已恢复" : backup ? "服务器备份可用" : "未发现备份"))
      ),
      h("label", { className: "form-label" }, "恢复密钥", h(TextArea, { value: recoveryKey, onChange: e => setRecoveryKey(e.target.value), autoSize: { minRows: 2, maxRows: 4 }, placeholder: "粘贴 Matrix 恢复密钥（推荐）" })),
      h(UiButton, { variant: "primary", className: "primary-btn full-btn", disabled: !cryptoState.available || cryptoState.restoring || !recoveryKey.trim() || !backup?.version, onClick: () => { try { const key = decodeRecoveryKey(recoveryKey.trim()); onRestore({ type: "key", key, version: backup.version }); setRecoveryKey(""); } catch { Toast.error("恢复密钥格式无效，请粘贴完整的 Matrix 恢复密钥"); } } }, cryptoState.restoring ? `恢复中 ${cryptoState.restoreProgress || 0}%…` : "使用恢复密钥解密历史"),
      h("label", { className: "form-label" }, "备份密码短语（兼容方式）", h(Input, { type: "password", value: passphrase, onChange: setPassphrase, placeholder: "如果你的备份使用密码短语" })),
      h(UiButton, { className: "ghost-btn full-btn", disabled: !cryptoState.available || cryptoState.restoring || !backup?.version, onClick: () => onRestore({ type: "secret", version: backup.version }) }, cryptoState?.keyRestored ? "再次解密历史消息" : "从密钥存储恢复"),
      h(UiButton, { className: "ghost-btn full-btn", disabled: !cryptoState.available || cryptoState.restoring || !passphrase.trim() || !backup?.version, onClick: () => { onRestore({ type: "passphrase", passphrase: passphrase.trim(), version: backup.version }); setPassphrase(""); } }, "使用密码短语恢复"),
      h("div", { className: "backup-hint" }, "恢复密钥只在当前浏览器内使用，不会发送给 Orbit。恢复完成后会自动重新解密历史消息。"), cryptoState.error && h("div", { className: "backup-error" }, cryptoState.error)
    ), h("div", { className: `local-device-status ${cryptoState?.verified ? "verified" : ""}` }, h("span", { className: "local-device-dot" }), h("span", null, "本机设备 · ", localDeviceId || "当前设备"), cryptoState?.verified ? h("span", { className: "verified-badge" }, "跨设备已验证") : cryptoState?.localTrusted ? h("span", { className: "device-state-pending" }, "本机已信任 · 其他客户端未同步") : h("span", { className: "device-state-pending" }, cryptoState?.keyRestored ? "密钥已恢复 · 待设备验证" : "待设备验证")), h("div", { className: "device-list-heading" }, h("strong", null, "设备列表"), h("span", null, "验证后会发布跨签名信任，其他客户端也会同步状态")), loading ? h("div", { className: "dialog-loading" }, "正在读取设备…") : h("div", { className: "device-list" }, devices.length ? devices.map(renderDevice) : h("div", { className: "dialog-empty" }, "服务器没有返回设备列表")), verification && h("section", { className: "verification-panel" }, h("div", { className: "verification-head" }, h("div", { className: "verification-title" }, "设备验证"), h(UiButton, { className: "verification-close", type: "text", onClick: cancelVerification }, "取消")), h("div", { className: "verification-copy" }, verification.status === "incoming" ? `收到来自 ${verification.deviceId || "其他设备"} 的验证请求` : verification.status === "waiting" ? "验证请求已发送，等待另一台设备接受" : verification.status === "verifying" ? "正在交换验证信息…" : verification.status === "confirm" ? "请核对两台设备上的安全码是否一致" : verification.status === "done" ? "两台设备已建立跨设备信任，其他客户端同步后会显示已验证" : verification.error || "验证准备中"), verification.status === "confirm" && h("div", { className: "sas-code" }, sasText), verification.status === "incoming" && h(UiButton, { variant: "primary", className: "primary-btn full-btn", onClick: () => runVerification(verification.request, verification.deviceId) }, "接受并开始验证"), verification.status === "confirm" && h("div", { className: "verification-actions" }, h(UiButton, { variant: "primary", className: "primary-btn", onClick: confirmSas }, "匹配，完成验证"), h(UiButton, { className: "ghost-btn", onClick: cancelVerification }, "不匹配")), verification.status === "done" && h("div", { className: "verification-success" }, "验证完成，已发布跨签名信任。"), verification.status === "error" && h("div", { className: "backup-error" }, verification.error || "验证失败"))));
}

function ForwardDialog({ client, rooms, items, onClose }) {
  const [targets, setTargets] = useState([]); const [loading, setLoading] = useState(false); const [query, setQuery] = useState("");
  const available = rooms.filter(room => !room.isSpace);
  const filtered = available.filter(room => `${room.name} ${room.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = id => setTargets(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const forward = async () => { if (!targets.length || !items.length) return; setLoading(true); try { for (const targetId of targets) for (const item of items) { const eventContent = item.event?.getClearContent?.() || item.event?.getContent?.() || { msgtype: "m.text", body: item.text || "" }; const content = { ...eventContent }; delete content.event_id; delete content.room_id; delete content.sender; delete content.origin_server_ts; delete content["m.relates_to"]; await client.sendMessage(targetId, content); } Toast.success(`已转发 ${items.length} 条消息到 ${targets.length} 个房间`); onClose(); } catch (error) { Toast.error(`转发失败：${error?.message || "未知错误"}`); } finally { setLoading(false); } };
  return h("div", { className: "modal-backdrop", onMouseDown: event => event.target === event.currentTarget && onClose() }, h("div", { className: "modal-card forward-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "转发消息"), h("div", { className: "modal-copy" }, `已选择 ${items.length} 条消息，可发送到多个房间`)), h(UiButton, { className: "icon-button", type: "text", onClick: onClose }, "×")), h(Input, { className: "forward-search", value: query, onChange: setQuery, placeholder: "搜索房间名称或 Matrix ID", prefix: "⌕", allowClear: true }), h("div", { className: "forward-room-list" }, filtered.length ? filtered.map(room => h("label", { className: "forward-room", key: room.id }, h(AntCheckbox, { checked: targets.includes(room.id), onChange: () => toggle(room.id) }), h(MatrixAvatar, { client, mxcUrl: room.avatarMxc, httpUrl: room.avatarUrl, size: 30, style: { background: room.color }, fallback: room.initials, alt: room.name }), h("span", null, room.name))) : h("div", { className: "dialog-empty" }, "没有匹配的房间")), h("div", { className: "modal-actions" }, h(UiButton, { className: "ghost-btn", onClick: onClose }, "取消"), h(UiButton, { variant: "primary", className: "primary-btn", disabled: !targets.length || loading, onClick: forward }, loading ? "转发中…" : `转发到 ${targets.length || 0} 个房间`))));
}

function SearchDialog({ client, room, onClose }) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState([]); const [loading, setLoading] = useState(false);
  const scoreResult = (entry, term) => {
    const result = entry?.result || entry || {}; const content = result.content || {}; const haystack = `${content.body || ""} ${content.formatted_body || ""}`.toLowerCase(); const needle = term.toLowerCase();
    let cursor = 0; for (const char of needle) { const found = haystack.indexOf(char, cursor); if (found < 0) return 0; cursor = found + 1; }
    const exact = String(content.body || "").toLowerCase() === needle ? 100 : 0;
    const starts = String(content.body || "").toLowerCase().startsWith(needle) ? 30 : 0;
    const occurrences = haystack.split(needle).length - 1;
    return Number(entry?.rank || 0) + exact + starts + occurrences * 4;
  };
  const decorateResults = (raw, term) => raw.filter(item => !item.result?.room_id || item.result.room_id === room.id).map(item => {
    const result = item.result || item; const sender = result.sender || result.user_id; const member = sender && room.matrixRoom?.getMember?.(sender); const user = sender && client?.getUser?.(sender); return { ...item, result: { ...result, senderName: member?.name || user?.displayName || sender || "未知用户", sender } };
  }).filter(item => scoreResult(item, term) > 0).sort((a, b) => scoreResult(b, term) - scoreResult(a, term));
  const search = async e => { e.preventDefault(); const term = query.trim(); if (!term) return; setLoading(true); try {
    let response;
    if (typeof client.searchRoomEvents === "function") response = await client.searchRoomEvents({ term, filter: { rooms: [room.id] } });
    else if (typeof client.searchMessageText === "function") response = await client.searchMessageText({ query: term });
    else throw new Error("当前 homeserver 不支持搜索接口");
    const raw = response?.results || response?.search_categories?.room_events?.results || [];
    setResults(decorateResults(raw, term));
  } catch (error) {
    try {
      const response = await client.searchMessageText?.({ query: term });
      const raw = response?.search_categories?.room_events?.results || response?.results || [];
      const remote = decorateResults(raw, term);
      if (remote.length) { setResults(remote); return; }
    } catch {}
    const localEvents = room.getLiveTimeline?.().getEvents?.() || [];
    const local = decorateResults(localEvents.map(event => ({ result: { room_id: room.id, sender: event.getSender?.(), origin_server_ts: event.getTs?.(), content: event.getClearContent?.() || event.getContent?.() || {} } })).filter(item => scoreResult(item, term) > 0), term);
    setResults(local);
    if (!local.length) Toast.warning("服务器搜索不可用，仅搜索当前已加载的消息");
  } finally { setLoading(false); } };
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card search-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "搜索房间消息"), h("div", { className: "modal-copy" }, room.name)), h("button", { className: "icon-button", onClick: onClose }, "×")), h("form", { className: "search-form", onSubmit: search }, h("input", { value: query, onChange: e => setQuery(e.target.value), placeholder: "输入关键词", autoFocus: true }), h("button", { className: "primary-btn", disabled: loading }, loading ? "搜索中…" : "搜索")), h("div", { className: "search-results" }, !results.length && query && !loading && h("div", { className: "dialog-empty" }, "没有找到匹配的消息"), results.map((item, i) => h("div", { className: "search-result", key: item.result?.event_id || item.rank || i }, h("div", { className: "search-result-author" }, item.result?.senderName || item.result?.sender || "未知用户", h("span", { className: "message-time" }, item.result?.origin_server_ts ? new Date(item.result.origin_server_ts).toLocaleString("zh-CN") : "")), h("div", { className: "search-result-body" }, item.result?.content?.body || ""))))));
}

function Sidebar({ rooms, allRooms: roomUniverse = rooms, invites = [], spaces, selectedId, connected, presence, viewMode, activeSpaceId, onViewMode, onSpaceSelect, onSelect, onCreate, onCreateSpace, onManageSpace, onLeaveSpace = window.orbitLeaveSpace, onAcceptInvite, onDeclineInvite, onAccount, onLogout }) {
  const [query, setQuery] = useState("");
  const [directSort, setDirectSort] = useState("active");
  const scopedRooms = rooms;
  const filtered = scopedRooms.filter(room => !room.hidden && `${room.name} ${room.id}`.toLowerCase().includes(query.toLowerCase()));
  const currentUser = connected.client?.getUser?.(connected.userId); spaces = spaces.filter(space => !space.hidden);
  const allRooms = window.orbitAllRooms || roomUniverse;
  const totalUnread = allRooms.filter(room => room.id !== selectedId && room.isDirect).reduce((sum, room) => sum + (Number(room.unread) || 0), 0);
  const groupUnread = allRooms.filter(room => room.id !== selectedId && room.isGroup).reduce((sum, room) => sum + (Number(room.unread) || 0), 0);
  const unreadBadge = count => count > 0 ? h("span", { className: "nav-unread-badge", title: `${count} 条未读消息` }, count > 99 ? "99+" : count) : null;
  const sortedRooms = viewMode !== "messages" ? filtered : [...filtered].sort((a, b) => {
    if (directSort === "online") {
      const aOnline = a.directUserId && connected.client?.getUser?.(a.directUserId)?.presence === "online" ? 1 : 0;
      const bOnline = b.directUserId && connected.client?.getUser?.(b.directUserId)?.presence === "online" ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
    }
    return (b.lastTs || 0) - (a.lastTs || 0);
  });
  const inviteNotice = invites.length ? h("section", { className: "invite-section", "aria-label": "房间邀请" },
    h("div", { className: "section-label invite-section-label" }, h("span", null, "房间邀请"), h("span", { className: "invite-count" }, invites.length)),
    invites.map(invite => h("div", { className: "invite-card", key: invite.id },
      h(MatrixAvatar, { client: connected.client, mxcUrl: invite.avatarMxc, httpUrl: invite.avatarUrl, size: 34, style: { background: invite.color }, fallback: invite.initials, alt: invite.name }),
      h("div", { className: "invite-copy" }, h("strong", null, invite.name), h("span", null, "有人邀请你加入此房间")),
      h("div", { className: "invite-actions" }, h("button", { type: "button", className: "invite-accept", onClick: () => onAcceptInvite?.(invite) }, "接受"), h("button", { type: "button", className: "invite-decline", onClick: () => onDeclineInvite?.(invite) }, "忽略"))
    ))
  ) : null;
  return h("aside", { className: "sidebar" }, h("div", { className: "brand-row" }, h("div", { className: "brand" }, h("div", { className: "brand-mark" }, "O"), h("div", null, "Orbit", h("div", { className: "workspace-pill" }, "Matrix 工作台"))), h("button", { className: "icon-button", title: viewMode === "spaces" && activeSpaceId ? "在当前空间创建房间" : "创建房间", onClick: onCreate }, "+")), h("button", { className: "user-card", onClick: onAccount, title: "打开我的设置" }, h(MatrixAvatar, { client: connected.client, mxcUrl: memberAvatarMxc(currentUser), size: 32, className: "user-avatar", style: { background: colorFor(connected.userId) }, fallback: initials(connected.userId), alt: connected.userId }), h("div", { className: "user-meta" }, h("div", { className: "user-name" }, connected.client?.getUser?.(connected.userId)?.displayName || connected.userId), h("div", { className: "user-id" }, "我的设置")), h("span", { className: `online-dot ${presence === "offline" ? "offline-dot" : ""}`, title: presence || "online" })), h("div", { className: "sidebar-nav" }, h("button", { className: `nav-item ${viewMode === "messages" ? "active" : ""}`, onClick: () => onViewMode("messages") }, "私聊", unreadBadge(totalUnread)), h("button", { className: `nav-item ${viewMode === "groups" ? "active" : ""}`, onClick: () => onViewMode("groups") }, "群聊", unreadBadge(groupUnread), invites.length > 0 && h("span", { className: "nav-unread-dot", title: `${invites.length} 个房间邀请` })), h("button", { className: `nav-item ${viewMode === "spaces" ? "active" : ""}`, onClick: () => onViewMode("spaces") }, "空间")), inviteNotice, viewMode === "spaces" && h("div", { className: "space-list" }, h("div", { className: "section-label" }, h("span", null, "我的空间"), h("span", { className: "space-actions" }, h("button", { className: "mini-link", onClick: event => { event.stopPropagation(); onCreateSpace?.(); }, title: "创建空间" }, "+"), activeSpaceId && h("button", { className: "mini-link", onClick: event => { event.stopPropagation(); onCreate?.(); }, title: "在当前空间创建房间" }, "新房间"), activeSpaceId && h("button", { className: "mini-link danger-mini-link", onClick: event => { event.stopPropagation(); onLeaveSpace?.(); }, title: "退出当前空间" }, "退出"), h("button", { className: "mini-link", onClick: event => { event.stopPropagation(); onManageSpace?.(); }, title: "管理空间房间" }, "⋯"))), spaces.length ? spaces.map(space => h("div", { className: `space-row ${space.id === activeSpaceId ? "active" : ""}`, key: space.id, onClick: () => onSpaceSelect(space.id) }, h("div", { className: "space-icon", style: { background: space.color } }, space.initials), h("span", null, space.name))) : h("div", { className: "empty-sidebar" }, "服务器没有返回 Space 房间")), h("div", { className: "room-tools" }, h(Input, { prefix: "⌕", placeholder: viewMode === "spaces" ? "搜索空间内房间" : viewMode === "groups" ? "搜索群聊" : "搜索私聊", value: query, onChange: setQuery, showClear: true })), h("div", { className: "section-label" }, h("span", null, viewMode === "spaces" ? "空间内房间" : viewMode === "groups" ? "群聊" : "私聊"), h("span", null, filtered.length), viewMode === "messages" && h("span", { className: "sort-switch", role: "group", "aria-label": "私聊排序" }, h("button", { type: "button", className: directSort === "active" ? "active" : "", onClick: () => setDirectSort("active") }, "活跃优先"), h("button", { type: "button", className: directSort === "online" ? "active" : "", onClick: () => setDirectSort("online") }, "在线优先"))), h("div", { className: "room-list" }, sortedRooms.length ? sortedRooms.map(room => { const directPresence = room.directUserId ? connected.client?.getUser?.(room.directUserId)?.presence : null; const showUnread = room.id !== selectedId && room.unread > 0; return h("div", { key: room.id, className: `room-row ${room.id === selectedId ? "active" : ""}`, onClick: () => onSelect(room.id) }, h(MatrixAvatar, { client: connected.client, mxcUrl: room.avatarMxc, httpUrl: room.avatarUrl, size: 38, style: { background: room.color }, fallback: room.initials, alt: room.name }), h("div", { className: "room-copy" }, h("div", { className: "room-name-line" }, h("span", { className: "room-name" }, room.name), directPresence && h("span", { className: `room-presence-dot ${directPresence === "online" ? "online" : ""}`, title: directPresence === "online" ? "在线" : "离线" })), h("div", { className: "room-preview" }, room.preview)), h("div", { className: "room-trailing" }, h("span", { className: "room-time" }, room.time), showUnread ? h("span", { className: `room-unread-badge ${room.unread === 1 ? "dot" : ""}`, title: `${room.unread} 条未读消息` }, room.unread > 1 ? room.unread : null) : null)); }) : h("div", { className: "empty-sidebar" }, viewMode === "spaces" ? "请选择一个空间，或该空间还没有子房间" : "暂无房间")), h("div", { className: "sidebar-footer" }, h("div", { className: "connection-state" }, h("span", { className: `online-dot ${presence === "offline" ? "offline-dot" : ""}` }), presence === "offline" ? "离线" : "Matrix 已连接"), h("button", { className: "icon-button", title: "退出登录", onClick: onLogout }, "↪")));
}

function SpaceDialog({ client, onClose, onCreated }) {
  const [name, setName] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async e => { e.preventDefault(); setLoading(true); try { const result = await client.createRoom({ name: name.trim(), creation_content: { type: "m.space" }, initial_state: [] }); Toast.success("空间创建成功"); onCreated?.(result.room_id); onClose(); } catch (error) { Toast.error(`空间创建失败：${error?.message || "当前 homeserver 不支持 Space"}`); } finally { setLoading(false); } };
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "创建空间"), h("div", { className: "modal-copy" }, "Space 是房间的组织容器。")), h(UiButton, { className: "icon-button", type: "text", onClick: onClose }, "×")), h("form", { className: "modal-form", onSubmit: submit }, h("label", { className: "form-label" }, "空间名称", h(Input, { value: name, onChange: setName, required: true, placeholder: "例如：产品与研发" })), h("div", { className: "modal-actions" }, h(UiButton, { htmlType: "button", className: "ghost-btn", onClick: onClose }, "取消"), h(UiButton, { htmlType: "submit", variant: "primary", disabled: loading }, loading ? "创建中…" : "创建空间")))));
}

function SpaceRoomsDialog({ client, space, rooms, onClose, onChanged }) {
  const [query, setQuery] = useState(""); const [selected, setSelected] = useState(() => new Set(spaceChildIds(space.matrixRoom))); const [loading, setLoading] = useState(false);
  const candidates = rooms.filter(room => !room.isSpace && `${room.name} ${room.id}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = id => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const save = async () => { setLoading(true); try { const existing = new Set(spaceChildIds(space.matrixRoom)); const via = [new URL(client.getHomeserverUrl?.() || location.origin).host]; for (const room of rooms.filter(item => selected.has(item.id) && !existing.has(item.id))) { await client.sendStateEvent(space.id, "m.space.child", { via, order: String(Date.now()) }, room.id); try { await client.sendStateEvent(room.id, "m.space.parent", { via, canonical: false }, space.id); } catch {} } await onChanged?.(); Toast.success("空间房间已更新"); onClose(); } catch (error) { Toast.error(`添加房间失败：${error?.message || "请检查空间权限"}`); } finally { setLoading(false); } };
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card forward-card" }, h("div", { className: "modal-head" }, h("div", null, h("div", { className: "modal-title" }, "管理空间房间"), h("div", { className: "modal-copy" }, space.name)), h(UiButton, { className: "icon-button", type: "text", onClick: onClose }, "×")), h(Input, { value: query, onChange: setQuery, placeholder: "搜索已有房间", prefix: "⌕" }), h("div", { className: "forward-room-list" }, candidates.map(room => h("label", { className: "forward-room", key: room.id }, h(AntCheckbox, { checked: selected.has(room.id), onChange: () => toggle(room.id) }), h(MatrixAvatar, { client, mxcUrl: room.avatarMxc, httpUrl: room.avatarUrl, size: 30, style: { background: room.color }, fallback: room.initials, alt: room.name }), h("span", null, room.name)))), h("div", { className: "modal-actions" }, h(UiButton, { className: "ghost-btn", onClick: onClose }, "取消"), h(UiButton, { variant: "primary", disabled: loading, onClick: save }, loading ? "保存中…" : "保存"))));
}

function ReactionPicker({ client, onSelect }) {
  const [items, setItems] = useState([]); const [packs, setPacks] = useState([]); const [pack, setPack] = useState("all"); const [open, setOpen] = useState(false); const [custom, setCustom] = useState("");
  useEffect(() => { if (!open || items.length) return; ensureEmojiCatalog().then(next => { setItems(next); setPacks(window.orbitEmojiPacks || []); }).catch(() => {}); }, [open]);
  const shown = items.filter(item => pack === "all" || item.packId === pack).slice(0, 240);
  const submitCustom = () => { const value = custom.trim(); if (!value) return; onSelect(value); setCustom(""); setOpen(false); };
  const content = h("div", { className: "reaction-picker" }, h("div", { className: "reaction-picker-title" }, "选择回应"), h("div", { className: "reaction-custom" }, h(Input, { size: "small", value: custom, onChange: setCustom, placeholder: "输入文字回应" }), h(UiButton, { size: "small", variant: "primary", disabled: !custom.trim(), onClick: submitCustom }, "回应")), h("div", { className: "emoji-packs reaction-packs" }, h("button", { type: "button", className: `emoji-pack ${pack === "all" ? "active" : ""}`, onClick: () => setPack("all") }, "全部"), packs.map(item => h("button", { type: "button", className: `emoji-pack ${pack === item.id ? "active" : ""}`, key: item.id, onClick: () => setPack(item.id) }, item.name))), items.length > 0 && h("div", { className: "reaction-sticker-grid" }, shown.map(item => h("button", { type: "button", key: item.id, title: `回应：${item.name}`, onClick: () => { onSelect(`:${item.name}:`); setOpen(false); } }, h("img", { src: assetRequestUrl(item.thumbUrl || item.url), alt: item.name, loading: "lazy" })))));
  return h(AntPopover, { trigger: "click", open, onOpenChange: setOpen, placement: "topLeft", content }, h("button", { type: "button", className: "message-action-reaction", title: "选择回应" }, "😊"));
}

function ReadReceipt({ readBy = [], client }) {
  client = client || window.orbitMatrixClient;
  const content = h("div", { className: "read-popover" },
    h("div", { className: "read-popover-title" }, readBy.length ? `已读 ${readBy.length} 人` : "暂未收到已读回执"),
    readBy.length ? h("div", { className: "read-people-grid" }, readBy.map(entry => { const user = client?.getUser?.(entry.userId); const fullTime = entry.ts ? new Date(entry.ts).toLocaleString("zh-CN") : "已读"; const readTime = entry.ts ? new Date(entry.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "已读"; const label = `${entry.name || entry.userId} · ${fullTime}`; return h("div", { className: "read-person", key: entry.userId, title: label, "aria-label": label },
      h(MatrixAvatar, { client, mxcUrl: memberAvatarMxc(user), size: 28, className: "read-person-avatar", style: { background: colorFor(entry.userId), color: "#fff" }, fallback: initials(entry.name || entry.userId), alt: entry.name || entry.userId }),
      h("span", { className: "read-person-name" }, entry.name || user?.displayName || "未命名用户"),
      h("time", { className: "read-person-time" }, readTime)); })) :
      h("div", { className: "read-empty" }, "对方打开房间后会显示读取时间"));
  const avatars = readBy.slice(0, 4).map(entry => { const user = client?.getUser?.(entry.userId); return h(MatrixAvatar, { key: entry.userId, client, mxcUrl: memberAvatarMxc(user), size: 20, className: "read-stack-avatar", style: { background: colorFor(entry.userId), color: "#fff" }, fallback: initials(entry.name || entry.userId), alt: entry.name || entry.userId }); });
  return h(AntPopover, { content, trigger: "click", placement: "topRight" },
    h("button", { className: "read-status read-status-avatars", type: "button", title: `${readBy.length} 人已读`, "aria-label": `${readBy.length} 人已读` }, h("span", { className: "read-stack" }, avatars)));
}

function RelationContext({ item, client, onJumpTo, onThread }) {
  const isThread = Boolean(item.threadRoot);
  const targetId = item.replyTo || item.threadRoot;
  const author = isThread ? item.threadAuthor : item.replyAuthor;
  const snippet = isThread ? item.threadPreview : item.replyPreview;
  if (!targetId) return null;
  return h("button", { type: "button", className: `relation-context ${isThread ? "relation-thread" : "relation-quote"}`, onClick: event => { event.stopPropagation(); (isThread ? onThread : onJumpTo)?.(isThread ? item : targetId); }, title: isThread ? "打开线程" : "跳转到原消息", "aria-label": isThread ? `打开 ${author || "消息"} 的线程` : `跳转到 ${author || "消息"} 的原消息` },
    h("span", { className: "relation-context-rail" }),
    h(MatrixAvatar, { client, mxcUrl: isThread ? item.threadAvatarMxc : item.replyAvatarMxc, size: 20, className: "relation-context-avatar", style: { background: item.color }, fallback: initials(author || "消息"), alt: author || "消息" }),
    h("span", { className: "relation-context-copy" }, h("span", { className: "relation-context-label" }, isThread ? `⌁ ${author || "消息"}` : `↪ ${author || "消息"}`), h("span", { className: "relation-context-snippet" }, String(snippet || "消息内容不可用").replace(/\s+/g, " ").trim())),
    h("span", { className: "relation-context-arrow" }, "›")
  );
}

function attachmentKind(name = "") {
  const ext = String(name).split(".").pop()?.toLowerCase() || "file";
  if (["txt", "log", "md", "json", "xml"].includes(ext)) return { ext, label: ext.toUpperCase(), icon: "T", className: "file" };
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return { ext, label: "DOCX", icon: "W", className: "doc" };
  if (["ppt", "pptx", "odp"].includes(ext)) return { ext, label: "PPTX", icon: "P", className: "ppt" };
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return { ext, label: ext === "csv" ? "CSV" : "XLSX", icon: "X", className: "xls" };
  if (ext === "pdf") return { ext, label: "PDF", icon: "P", className: "pdf" };
  return { ext, label: ext.toUpperCase().slice(0, 5) || "FILE", icon: "↗", className: "file" };
}

function formatAttachmentSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function decodeTextAttachment(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  const zeroCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (zeroCount > sample.length * 0.18) {
    try { return new TextDecoder("utf-16le").decode(bytes); } catch {}
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {}
  for (const encoding of ["gb18030", "gbk", "big5", "shift_jis", "windows-1252"]) {
    try { return new TextDecoder(encoding).decode(bytes); } catch {}
  }
  return new TextDecoder().decode(bytes);
}

function shortenAttachmentName(name, maxLength = 30) {
  const original = String(name || "附件");
  if (original.length <= maxLength) return original;
  const dot = original.lastIndexOf(".");
  const ext = dot > 0 && dot < original.length - 1 ? original.slice(dot).toLowerCase() : "";
  if (/^\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(ext)) return `image${ext}`;
  const keep = Math.max(8, maxLength - ext.length - 1);
  return `${original.slice(0, keep)}…${ext}`;
}

async function saveEditedAttachment(client, item, buffer, fileName, mimeType) {
  if (!client || !item?.roomId || !item?.id || !buffer) throw new Error("无法保存文件：缺少房间或文件信息");
  const name = fileName || item.attachment?.name || "document";
  const type = mimeType || item.attachment?.info?.mimetype || "application/octet-stream";
  const file = new File([buffer], name, { type });
  const encrypted = Boolean(item.attachment?.file?.key?.k && item.attachment?.file?.iv);
  const { uploaded, fileInfo } = await uploadMatrixMedia(client, file, encrypted);
  const msgtype = item.attachment?.type || "m.file";
  const info = { ...(item.attachment?.info || {}), mimetype: type, size: file.size };
  const updated = { user_id: client.getUserId?.() || "", ts: Date.now(), from_event_id: item.id, mode: item.isMe ? "replace" : "copy" };
  const content = { msgtype, body: name, info, "org.orbit.updated": updated };
  if (item.isMe) {
    content["m.relates_to"] = { rel_type: "m.replace", event_id: item.id };
    content["m.new_content"] = { msgtype, body: name, info, "org.orbit.updated": updated };
  }
  if (fileInfo) {
    content.file = { ...fileInfo, url: uploaded.content_uri };
    if (content["m.new_content"]) content["m.new_content"].file = content.file;
  } else {
    content.url = uploaded.content_uri;
    if (content["m.new_content"]) content["m.new_content"].url = uploaded.content_uri;
  }
  await client.sendMessage(item.roomId, content);
}

let orbitOfficeCryptoPromise;
async function decryptOfficeForEditor(buffer, fileName) {
  if (!buffer) return buffer;
  orbitOfficeCryptoPromise ||= import("https://esm.sh/officecrypto-tool@0.0.19?bundle");
  let crypto;
  try { crypto = await orbitOfficeCryptoPromise; } catch (error) { console.warn("Office 解密模块加载失败", error); return buffer; }
  let encrypted = false;
  try { encrypted = Boolean(crypto?.isEncrypted?.(buffer)); } catch (error) { console.warn("Office 加密检测失败", error); return buffer; }
  if (!encrypted) return buffer;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const password = window.prompt(`文件“${fileName || "Office 文件"}”已加密，请输入密码：`, "");
    if (password == null) throw new Error("已取消密码输入");
    try {
      const plain = await crypto.decrypt(buffer, { password });
      const bytes = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } catch (error) {
      if (attempt === 2) throw new Error("Office 文件密码错误或解密失败");
    }
  }
  throw new Error("Office 文件解密失败");
}

function EmojiRowMedia({ items = [], client, onOpen, fallback }) {
  const [failed, setFailed] = useState(0);
  if (failed >= items.length && fallback) return h("img", { className: "message-image message-emoji-image", src: fallback, alt: "表情", onClick: () => onOpen?.(fallback, "表情") });
  return h("div", { className: "message-emoji-row-media", role: "img", "aria-label": "表情" }, items.map((emoji, index) => {
    const source = emoji?.thumbUrl || emoji?.url;
    const src = assetRequestUrl(source);
    return h("img", { key: emoji?.id || `${emoji?.name || "emoji"}-${index}`, className: "message-emoji-tile", src, alt: emoji?.name || "表情", loading: "lazy", onError: () => setFailed(value => value + 1), onClick: () => src && onOpen?.(src, emoji?.name || "表情") });
  }));
}

function MediaPlayer({ src, type = "video", className = "", label = "媒体文件" }) {
  const ref = useRef(null);
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const player = new Plyr(media, {
      controls: ["play", "progress", "current-time", "mute", "volume", "settings", "fullscreen"],
      settings: ["speed"],
      speed: { selected: 1, options: [0.75, 1, 1.25, 1.5, 2] },
      tooltips: { controls: true, seek: true },
      keyboard: { focused: true, global: false },
      i18n: { play: "播放", pause: "暂停", seek: "跳转", seekLabel: "跳转 { seektime } 秒", played: "已播放", buffered: "已缓冲", currentTime: "当前时间", duration: "总时长", volume: "音量", mute: "静音", unmute: "取消静音", settings: "设置", speed: "倍速", normal: "正常", enterFullscreen: "全屏", exitFullscreen: "退出全屏", download: "下载" }
    });
    playerRef.current = player;
    const loaded = () => setError(false);
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const failed = () => { setPlaying(false); setError(true); };
    media.addEventListener("loadedmetadata", loaded);
    media.addEventListener("play", play);
    media.addEventListener("pause", pause);
    media.addEventListener("error", failed);
    return () => {
      media.removeEventListener("loadedmetadata", loaded);
      media.removeEventListener("play", play);
      media.removeEventListener("pause", pause);
      media.removeEventListener("error", failed);
      player.destroy();
      playerRef.current = null;
    };
  }, [src]);
  const mediaNode = type === "video"
    ? h("video", { ref, className: `media-native ${className}`, src, preload: "metadata", playsInline: true })
    : h("audio", { ref, className: `media-native ${className}`, src, preload: "metadata" });
  return h("div", { className: `media-player media-player-${type} ${playing ? "is-playing" : ""} ${error ? "has-error" : ""}` },
    h("div", { className: "media-file-label", title: label }, label),
    mediaNode,
    error && h("div", { className: "media-player-error", role: "status" }, "媒体加载失败，请重试或下载原文件")
  );
}

function Message({ item, client, onReply, onReact, onThread, onEdit, onRedact, onJumpTo, onForward, onMention, onTogglePinMessage, pinnedEventIds = [], selecting, selected, onSelect, grouped = item?.grouped || false }) {
  const [contextMenu, setContextMenu] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [documentModal, setDocumentModal] = useState(null);
  const [documentPreview, setDocumentPreview] = useState({ status: "idle", html: "", text: "", url: "", error: "" });
  const [officeDirty, setOfficeDirty] = useState(false);
  const [officeSaving, setOfficeSaving] = useState(false);
  const officeFrameRef = useRef(null);
  const officeRequestIdRef = useRef("");
  const officeSaveIdRef = useRef("");
  const officeDirtyRef = useRef(false);
  const officeSavingRef = useRef(false);
  const closeAfterOfficeSaveRef = useRef(false);
  useEffect(() => { officeDirtyRef.current = officeDirty; }, [officeDirty]);
  useEffect(() => { officeSavingRef.current = officeSaving; }, [officeSaving]);
  const requestOfficeSave = () => {
    const frame = officeFrameRef.current;
    if (!frame?.contentWindow || !officeRequestIdRef.current || officeSavingRef.current || !officeDirtyRef.current) return false;
    const saveId = `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    officeSaveIdRef.current = saveId;
    officeSavingRef.current = true;
    setOfficeSaving(true);
    const message = { type: "xinghuo-office-save", requestId: officeRequestIdRef.current, saveId };
    try { frame.contentWindow.postMessage(message, new URL(orbitOfficeEditorUrl, location.href).origin); } catch { try { frame.contentWindow.postMessage(message, "*"); } catch { setOfficeSaving(false); Toast.error("Office 编辑器连接失败"); } }
    return true;
  };
  const closeDocument = () => {
    if (officeDirtyRef.current) {
      if (window.confirm("文件有未保存的修改。点击“确定”先保存，点击“取消”放弃修改并关闭。")) { closeAfterOfficeSaveRef.current = true; if (!requestOfficeSave()) closeAfterOfficeSaveRef.current = false; return; }
      officeDirtyRef.current = false;
      officeSavingRef.current = false;
      closeAfterOfficeSaveRef.current = false;
      setOfficeDirty(false);
      setOfficeSaving(false);
    }
    setDocumentModal(null);
  };
  useEffect(() => { if (!contextMenu) return; const close = () => setContextMenu(null); document.addEventListener("click", close); return () => document.removeEventListener("click", close); }, [contextMenu]);
  useEffect(() => { if (!item.threadRoot || !item.id) return; const row = document.getElementById(`event-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`); const reference = row?.querySelector(".thread-reference"); if (!reference) return; const open = event => { event.stopPropagation(); onThread?.(item); }; reference.setAttribute("role", "button"); reference.setAttribute("tabindex", "0"); reference.addEventListener("click", open); return () => reference.removeEventListener("click", open); }, [item.id, item.threadRoot, onThread]);
  useEffect(() => {
    if (!item.id || !item.handle) return;
    const row = document.getElementById(`event-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
    const author = row?.querySelector(".message-author-name");
    if (!author) return;
    const rememberMention = () => {
      const roomId = item.roomId || window.orbitActiveRoomId;
      const key = roomId || "*";
      const pending = window.orbitPendingMentions || {};
      const list = pending[key] || [];
      if (!list.some(entry => entry.userId === item.handle)) pending[key] = [...list, { userId: item.handle, name: item.author }];
      window.orbitPendingMentions = pending;
    };
    author.addEventListener("click", rememberMention);
    return () => author.removeEventListener("click", rememberMention);
  }, [item.id, item.handle, item.author, client]);
  // Add the two actions that are not part of the static React toolbar. The
  // remaining controls are identified by semantic classes, never by position.
  useEffect(() => {
    if (!item.id) return;
    const row = document.getElementById(`event-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
    const actions = row?.querySelector(".message-actions");
    if (!actions) return;
    let forward = actions.querySelector(".message-forward-action");
    if (!forward && onForward) {
      forward = document.createElement("button"); forward.type = "button"; forward.className = "message-forward-action"; forward.title = "转发"; forward.setAttribute("aria-label", "转发");
      forward.addEventListener("click", event => { event.stopPropagation(); onForward(item, false); });
    }
    const allButtons = [...actions.querySelectorAll("button")];
    const byText = value => allButtons.find(button => String(button.textContent || "").trim() === value);
    const reaction = actions.querySelector(".message-action-reaction") || allButtons.find(button => /😊|☺/.test(button.textContent || ""));
    const reply = actions.querySelector(".message-reply-action") || byText("回复");
    const thread = actions.querySelector(".message-thread-action") || byText("线程");
    const edit = actions.querySelector(".message-edit-action") || byText("编辑");
    const redact = actions.querySelector(".message-redact-action") || byText("撤回");
    reaction?.classList.add("message-reaction-action"); reaction && (reaction.title = "选择回应");
    reply?.classList.add("message-reply-action"); reply && (reply.title = "回复");
    thread?.classList.add("message-thread-action"); thread && (thread.title = "在线程中回复");
    edit?.classList.add("message-edit-action"); edit && (edit.title = "编辑");
    redact?.classList.add("message-redact-action"); redact && (redact.title = "撤回");
    const iconPaths = {
      // Forward: clean right-pointing arrow.
      forward: "M4 12h16M14 7l5 5-5 5",
      // Reply: line turns downward before the arrowhead.
      reply: "M4 7v6a5 5 0 0 0 5 5h7m-4-4 4 4-4 4",
      thread: "M5 4.5h14A1.5 1.5 0 0 1 20.5 6v10A1.5 1.5 0 0 1 19 17.5H12l-4 3v-3H5A1.5 1.5 0 0 1 3.5 16V6A1.5 1.5 0 0 1 5 4.5ZM12 8v6M9 11h6",
      edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z",
      more: "M12 5v.01M12 12v.01M12 19v.01",
    };
    const applyIcon = (button, name) => {
      if (!button || !iconPaths[name]) return;
      button.classList.add("message-svg-action");
      button.textContent = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", iconPaths[name]); svg.appendChild(path); button.appendChild(svg);
    };
    applyIcon(forward, "forward"); applyIcon(reply, "reply"); applyIcon(thread, "thread"); applyIcon(edit, "edit");
    [reaction, forward, reply, thread].filter(Boolean).forEach(button => actions.appendChild(button));
    if (redact) redact.style.display = "none";
    let more = actions.querySelector(".message-more-action");
    if (!more) {
      more = document.createElement("button");
      more.type = "button";
      more.className = "message-more-action";
      more.title = "更多";
      more.setAttribute("aria-label", "更多");
      more.textContent = "更多";
      more.addEventListener("click", event => { event.stopPropagation(); const rect = more.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom + 4 }); });
    }
    applyIcon(more, "more");
    // The reference layout keeps edit immediately before the overflow menu.
    if (edit) actions.appendChild(edit);
    actions.appendChild(more);
    return () => { more?.remove(); if (redact) redact.style.display = ""; };
  }, [item.id, item.isMe, onForward]);
  const rawUrl = item.attachment?.url || item.attachment?.file?.url;
  // Use the original download endpoint for message media. Thumbnail endpoints
  // can crop large images and make videos appear truncated.
  const asset = useMatrixAsset(client, rawUrl, undefined, undefined, undefined, item.attachment?.file || null);
  if (item.type === "empty") return h("div", { className: "empty-messages" }, "☁", h("div", null, item.label));
  const fileUrl = asset.src;
  const emojiRow = item.emojiItems?.length && fileUrl ? h(EmojiRowMedia, { items: item.emojiItems, client, fallback: fileUrl, onOpen: (src, alt) => setViewer({ src, alt }) }) : null;
  const reactions = Object.entries(item.reactions || {});
  const media = item.attachment && fileUrl && (item.attachment.type === "m.image" ? h("img", { className: `message-image ${item.attachment.emoji ? "message-emoji-image" : ""} ${item.attachment.sticker ? "message-sticker" : ""}`, src: fileUrl, alt: item.attachment.name || "图片", loading: "lazy", onClick: () => setViewer({ src: fileUrl, alt: item.attachment.name || "图片" }) }) : item.attachment.type === "m.video" ? h(MediaPlayer, { type: "video", className: "message-video", src: fileUrl, label: item.attachment.name || "视频" }) : item.attachment.type === "m.audio" ? h(MediaPlayer, { type: "audio", className: "message-audio", src: fileUrl, label: item.attachment.name || "音频" }) : null);
  const fetchAttachmentBlob = async () => { if (!asset.url) throw new Error("附件地址不可用"); const token = client?.getAccessToken?.(); const candidates = mediaRequestCandidates(client, rawUrl, asset.url); let lastError = null; for (const candidate of candidates) { try { const response = await fetch(candidate, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : undefined }); if (response.ok) { const encryptedBuffer = await response.arrayBuffer(); const plainBuffer = await decryptMatrixBuffer(encryptedBuffer, item.attachment?.file); const blob = new Blob([plainBuffer], { type: item.attachment?.file?.mimetype || item.attachment?.info?.mimetype || response.headers.get("content-type") || "application/octet-stream" }); if (blob.size > 0) return blob; } lastError = new Error(`媒体请求失败（${response.status}）`); } catch (error) { lastError = error; } } throw lastError || new Error("媒体请求失败"); };
  const openOriginal = async e => { e?.preventDefault?.(); if (documentAttachment) return setDocumentModal("preview"); try { const blob = await fetchAttachmentBlob(); const opened = URL.createObjectURL(blob); window.open(opened, "_blank", "noopener,noreferrer"); setTimeout(() => URL.revokeObjectURL(opened), 60000); } catch { Toast.error("原文件打开失败，请稍后重试"); } };
  const downloadAttachment = async e => { e?.preventDefault?.(); try { const blob = await fetchAttachmentBlob(); const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = item.attachment?.name || "附件"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 60000); } catch { Toast.error("文件下载失败，请稍后重试"); } };
  const openOfficeEditor = async e => { e?.preventDefault?.(); setDocumentModal("edit"); };
  const documentAttachment = item.attachment?.type === "m.file" && item.attachment?.name;
  const docKind = documentAttachment ? attachmentKind(item.attachment.name) : null;
  const isTextAttachment = Boolean(documentAttachment && ["txt", "log", "md", "json", "xml", "csv"].includes(docKind?.ext));
  const isOfficeAttachment = Boolean(documentAttachment && ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "ods", "csv"].includes(docKind?.ext));
  useEffect(() => {
    if (!documentModal || !documentAttachment || isOfficeAttachment || !asset.url) return;
    let active = true; let objectUrl = "";
    const kind = attachmentKind(item.attachment.name);
    setDocumentPreview({ status: "loading", html: "", text: "", url: "", error: "" });
    (async () => {
      try {
        if (kind.ext === "pdf") {
          const pdfBlob = await fetchAttachmentBlob();
          objectUrl = URL.createObjectURL(new Blob([pdfBlob], { type: "application/pdf" }));
          if (active) setDocumentPreview({ status: "ready", html: "", text: "", url: objectUrl, error: "" });
          return;
        }
        const blob = await fetchAttachmentBlob();
        if (["txt", "log", "md", "json", "xml", "csv"].includes(kind.ext)) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          // Some servers return an Office ZIP with a misleading .txt name.
          // Recognise the ZIP signature before decoding so it does not appear
          // as binary garbage in the text viewer.
          const looksLikeZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
          if (looksLikeZip) {
            const mammothModule = await import("https://esm.sh/mammoth@1.8.0?bundle");
            const mammoth = mammothModule.default || mammothModule;
            const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
            if (active) setDocumentPreview({ status: "ready", html: result.value || "<p>文档没有可显示的文字内容。</p>", text: "", url: "", error: "" });
          } else if (active) {
            if (kind.ext === "json") {
              try { setDocumentPreview({ status: "ready", html: "", text: JSON.stringify(JSON.parse(await decodeTextAttachment(blob)), null, 2), url: "", error: "" }); }
              catch { setDocumentPreview({ status: "ready", html: "", text: await decodeTextAttachment(blob), url: "", error: "" }); }
            } else setDocumentPreview({ status: "ready", html: "", text: await decodeTextAttachment(blob), url: "", error: "" });
          }
          return;
        }
        if (["doc", "docx", "odt", "rtf"].includes(kind.ext)) {
          const mammothModule = await import("https://esm.sh/mammoth@1.8.0?bundle");
          const mammoth = mammothModule.default || mammothModule;
          if (typeof mammoth.convertToHtml !== "function") throw new Error("DOCX 解析模块加载失败");
          const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
          if (active) setDocumentPreview({ status: "ready", html: result.value || "<p>文档没有可显示的文字内容。</p>", text: "", url: "", error: "" });
          return;
        }
        // Browser-native rendering is not available for PPTX/XLSX. Keep the
        // file inside the modal and offer an explicit Office hand-off.
        objectUrl = URL.createObjectURL(blob);
        if (active) setDocumentPreview({ status: "unsupported", html: "", text: "", url: objectUrl, error: "当前浏览器无法直接排版此 Office 格式" });
      } catch (error) { if (active) setDocumentPreview({ status: "error", html: "", text: "", url: "", error: error?.message || "文档解析失败" }); }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [documentModal, documentAttachment, isOfficeAttachment, asset.url]);
  useEffect(() => {
    if (!documentModal || !isOfficeAttachment || !asset.url) return;
    let active = true;
    let removeOfficeListener = () => {};
    const requestId = `orbit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const officeOrigin = new URL(orbitOfficeEditorUrl, location.href).origin;
    const params = new URLSearchParams({ embed: "1", editing: documentModal === "edit" ? "1" : "0", requestId, parentOrigin: location.origin });
    const iframeUrl = `${orbitOfficeEditorUrl}?${params.toString()}`;
    const open = async () => {
      try {
        const blob = await fetchAttachmentBlob();
        // Let the Office bridge handle password-protected documents. It has
        // the same conversion/decryption pipeline as its standalone editor;
        // pre-decrypting here caused valid passwords to be rejected before the
        // bridge ever received the file.
        const buffer = await blob.arrayBuffer();
        if (!active) return;
        const host = document.querySelector(".document-modal");
        const placeholder = host?.querySelector(".document-modal-loading");
        if (!placeholder) return;
        const frame = document.createElement("iframe");
        frame.className = "document-modal-frame office-editor-frame";
        frame.title = item.attachment?.name || "Office 在线编辑器";
        frame.src = iframeUrl;
        officeFrameRef.current = frame;
        officeRequestIdRef.current = requestId;
        officeSaveIdRef.current = "";
        placeholder.replaceWith(frame);
        let sent = false;
        let password = "";
        let passwordAttempts = 0;
        const postOfficeMessage = (payload, transfer) => {
          if (!frame.contentWindow) return false;
          try { frame.contentWindow?.postMessage(payload, officeOrigin, transfer || []); return true; }
          catch (error) { try { frame.contentWindow?.postMessage(payload, "*", transfer || []); return true; } catch (fallbackError) { Toast.error(`Office 编辑器连接失败：${fallbackError?.message || error?.message || "目标窗口来源不匹配"}`); return false; } }
        };
        const toBase64 = bytes => { let binary = ""; const step = 0x8000; for (let offset = 0; offset < bytes.length; offset += step) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length))); return btoa(binary); };
        const send = (nextPassword = password, force = false) => {
          if (sent && !force) return;
          sent = true; password = nextPassword || "";
          const fileName = item.attachment?.name || "document";
          const fileType = docKind?.ext || "";
          const mimeType = item.attachment?.info?.mimetype || blob.type || "application/octet-stream";
          // The Office bridge supports chunked transfer. Use it for larger
          // files so browser structured-clone conversion cannot fail or hit
          // the iframe's memory limit (the direct path remains fastest for
          // normal documents).
          if (buffer.byteLength > 8 * 1024 * 1024) {
            const bytes = new Uint8Array(buffer); const chunkSize = 192 * 1024; const chunkCount = Math.ceil(bytes.byteLength / chunkSize);
            if (!postOfficeMessage({ type: "xinghuo-office-source-begin", requestId, byteLength: bytes.byteLength, chunkCount, chunkSize, password, fileName, fileType, mimeType })) { sent = false; return; }
            for (let index = 0; index < chunkCount; index += 1) { const start = index * chunkSize; const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.byteLength)); if (!postOfficeMessage({ type: "xinghuo-office-source-chunk", requestId, chunkIndex: index, chunkData: toBase64(chunk) })) { sent = false; return; } }
            postOfficeMessage({ type: "xinghuo-office-source-end", requestId });
            return;
          }
          const payload = { type: "xinghuo-office-open", requestId, buffer: buffer.slice(0), password, fileName, fileType, mimeType };
          if (!postOfficeMessage(payload, [payload.buffer])) sent = false;
        };
        const onReady = event => {
          if (event.source !== frame.contentWindow || event.origin !== officeOrigin || event.data?.requestId && event.data.requestId !== requestId) return;
          if (event.data?.type === "xinghuo-office-ready") send();
          if (event.data?.type === "xinghuo-office-password-required") { if (passwordAttempts >= 2) return; passwordAttempts += 1; const next = window.prompt("此 Office 文件需要密码，请输入文件密码：", ""); if (next) send(next, true); }
          if (event.data?.type === "xinghuo-office-dirty") {
            if (!officeSavingRef.current || !event.data.dirty) { officeDirtyRef.current = Boolean(event.data.dirty); setOfficeDirty(Boolean(event.data.dirty)); }
            if (!event.data.dirty) { officeSavingRef.current = false; setOfficeSaving(false); }
          }
          if (event.data?.type === "xinghuo-office-saving") { officeSavingRef.current = true; setOfficeSaving(true); }
          if (event.data?.type === "xinghuo-office-saved") {
            const savedBuffer = event.data.buffer instanceof ArrayBuffer ? event.data.buffer : event.data.buffer?.buffer instanceof ArrayBuffer ? event.data.buffer.buffer : null;
            if (!savedBuffer) { setOfficeSaving(false); Toast.error("Office 编辑器没有返回可保存的数据"); return; }
            officeDirtyRef.current = false;
            setOfficeDirty(false);
            officeSavingRef.current = true;
            setOfficeSaving(true);
            saveEditedAttachment(client, item, savedBuffer, event.data.fileName || item.attachment?.name, event.data.mimeType || item.attachment?.info?.mimetype)
              .then(() => { if (active) { officeDirtyRef.current = false; officeSavingRef.current = false; setOfficeDirty(false); setOfficeSaving(false); Toast.success(item.isMe ? "文件已更新" : "已作为新文件发送"); if (closeAfterOfficeSaveRef.current) { closeAfterOfficeSaveRef.current = false; setDocumentModal(null); } } })
              .catch(error => { if (active) { officeDirtyRef.current = true; officeSavingRef.current = false; setOfficeDirty(true); setOfficeSaving(false); closeAfterOfficeSaveRef.current = false; Toast.error(`文件保存失败：${error?.message || "未知错误"}`); } });
          }
          if (event.data?.type === "xinghuo-office-error") { const errorText = String(event.data.message || ""); if (/(password|encrypted|decrypt|加密|密码|密碼|打开文件时发生错误)/i.test(errorText) && passwordAttempts < 2) { passwordAttempts += 1; const next = window.prompt("此 Office 文件需要密码，请输入文件密码：", ""); if (next) { sent = false; send(next, true); return; } } setOfficeSaving(false); Toast.error(errorText || "Office 操作失败"); }
        };
        window.addEventListener("message", onReady);
        removeOfficeListener = () => window.removeEventListener("message", onReady);
        frame.addEventListener("load", send, { once: true });
        setTimeout(send, 900);
      } catch (error) {
        if (active) setDocumentPreview(current => ({ ...current, status: "error", error: `Office 编辑器加载失败：${error?.message || "无法读取文件"}` }));
      }
    };
    open();
    return () => { active = false; removeOfficeListener(); officeFrameRef.current = null; officeRequestIdRef.current = ""; setOfficeSaving(false); };
  }, [documentModal, isOfficeAttachment, asset.url]);
  useEffect(() => {
    if (!officeDirty || !isOfficeAttachment || !["xls", "xlsx", "ods", "csv"].includes(docKind?.ext) || officeSaving) return;
    const timer = setTimeout(() => requestOfficeSave(), 2500);
    return () => clearTimeout(timer);
  }, [officeDirty, officeSaving, isOfficeAttachment, docKind?.ext]);
  useEffect(() => {
    if (!documentModal || !isOfficeAttachment) return;
    const onShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "s") {
        event.preventDefault();
        requestOfficeSave();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [documentModal, isOfficeAttachment, officeDirty, officeSaving]);
  useEffect(() => {
    if (!documentModal || !isTextAttachment || documentPreview.status !== "ready") return;
    const modal = document.querySelector(".document-modal");
    const headButton = modal?.querySelector(".document-modal-head-actions > .ant-btn");
    const actions = modal?.querySelector(".document-modal-actions");
    if (!actions || actions.querySelector(".document-copy-bottom")) return;
    if (headButton) headButton.style.display = "none";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-copy-bottom";
    button.textContent = "一键复制";
    button.addEventListener("click", () => navigator.clipboard?.writeText(documentPreview.text).then(() => Toast.success("文本已复制")));
    actions.insertBefore(button, actions.firstChild);
    return () => { button.remove(); if (headButton) headButton.style.display = ""; };
  }, [documentModal, isTextAttachment, documentPreview.status, documentPreview.text]);
  useEffect(() => {
    const modal = document.querySelector(".document-modal");
    const backdrop = document.querySelector(".document-modal-backdrop");
    if (!documentModal || !modal || !backdrop) return;
    const closeButton = modal.querySelector(".document-modal-head button[aria-label='关闭']");
    const stopAndClose = event => { event.preventDefault(); event.stopPropagation(); closeDocument(); };
    closeButton?.addEventListener("click", stopAndClose, true);
    const onBackdrop = event => { if (event.target === backdrop) stopAndClose(event); };
    backdrop.addEventListener("mousedown", onBackdrop, true);
    const actions = modal.querySelector(".document-modal-actions");
    const completeButton = actions?.querySelector("button:last-child");
    completeButton?.addEventListener("click", stopAndClose, true);
    let saveButton = null;
    if (isOfficeAttachment && actions && !actions.querySelector(".office-save-button")) {
      saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "office-save-button";
      actions.insertBefore(saveButton, actions.lastElementChild);
    }
    if (saveButton) {
      saveButton.textContent = officeSaving ? "保存中…" : "保存";
      saveButton.disabled = !officeDirty || officeSaving;
      saveButton.addEventListener("click", requestOfficeSave);
    }
    return () => { closeButton?.removeEventListener("click", stopAndClose, true); completeButton?.removeEventListener("click", stopAndClose, true); backdrop.removeEventListener("mousedown", onBackdrop, true); saveButton?.removeEventListener("click", requestOfficeSave); saveButton?.remove(); };
  }, [documentModal, isOfficeAttachment, officeDirty, officeSaving, documentPreview.status]);
  const displayName = shortenAttachmentName(item.attachment?.name || "附件");
  const updatedHint = item.updatedAt ? h("div", { className: "document-update-hint" }, `由 ${item.updatedBy || "用户"} 更新于 ${new Date(item.updatedAt).toLocaleString("zh-CN")}`) : null;
  const documentCard = documentAttachment ? h("div", { className: "document-card" }, h("div", { className: `document-icon document-icon-${docKind.className}` }, docKind.icon), h("div", { className: "document-main" }, h("div", { className: "document-name", title: item.attachment.name }, displayName), h("div", { className: "document-meta" }, formatAttachmentSize(item.attachment.info?.size || item.attachment.file?.size) || "文档", " · ", docKind.label), updatedHint), h("div", { className: "document-actions" }, isTextAttachment ? h("button", { type: "button", disabled: !asset.url, onClick: openOriginal }, "打开") : h("button", { type: "button", disabled: !asset.url, onClick: openOriginal }, "在线预览"), !isTextAttachment && h("button", { type: "button", disabled: !asset.url, onClick: openOfficeEditor }, "在线编辑"), h("button", { type: "button", disabled: !asset.url, onClick: downloadAttachment }, "下载"))) : null;
  const attachmentFallback = item.attachment && !media && !documentCard ? h("div", { className: "attachment-unavailable" }, asset.failed ? "媒体加载失败" : "正在加载媒体…", asset.url && h("a", { href: asset.url, onClick: openOriginal }, "打开原文件")) : null;
  const relation = (item.replyTo || item.threadRoot) && h(RelationContext, { item, client, onJumpTo, onThread });
  const payload = item.attachment ? h("div", { className: "attachment-wrap" }, documentCard || emojiRow || media || attachmentFallback || h("div", { className: "attachment-unavailable" }, "附件地址不可用"), media && item.attachment.type === "m.image" && !item.attachment.emoji && !item.attachment.sticker && h("div", { className: "attachment-caption", title: item.attachment.name }, displayName)) : item.formattedBody ? h("div", { className: "message-bubble formatted-message" }, h(FormattedMessage, { html: item.formattedBody, client, emojiFiles: item.emojiFiles, onImage: (src, alt) => setViewer({ src, alt }) })) : h("div", { className: "message-bubble" }, item.decryptFailed ? `🔒 ${item.text}` : h(MessageText, { text: item.text }));
  const documentContent = documentPreview.status === "loading" ? h("div", { className: "document-modal-loading" }, "正在解析文档…") : documentPreview.status === "error" ? h("div", { className: "document-modal-loading" }, documentPreview.error) : isTextAttachment && documentPreview.status === "ready" ? h("pre", { className: "document-modal-text" }, documentPreview.text) : docKind?.ext === "pdf" && documentPreview.url ? h("iframe", { className: "document-modal-frame", src: documentPreview.url, title: item.attachment?.name || "PDF 预览" }) : documentPreview.status === "ready" && documentPreview.html ? h("div", { className: `document-modal-html ${documentModal === "edit" ? "is-editable" : ""}`, contentEditable: documentModal === "edit", suppressContentEditableWarning: true, dangerouslySetInnerHTML: { __html: documentPreview.html } }) : h("div", { className: "document-modal-loading" }, documentPreview.error || "此格式暂不支持浏览器内排版，请使用下载后的 Office 应用打开");
  return h(React.Fragment, null, h("div", { className: `message-row ${item.isMe ? "me" : ""} ${item.attachment?.emoji ? "emoji-message-row" : ""} ${grouped ? "message-grouped" : ""} ${item.decryptFailed ? "encrypted-message" : ""} ${selecting ? "message-selecting" : ""} ${selected ? "message-selected" : ""}`, id: item.id ? `event-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined, onClick: selecting ? () => onSelect?.(item) : undefined, onContextMenu: event => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }); } }, h(MatrixAvatar, { client, mxcUrl: item.avatarMxc, size: 34, className: "message-avatar", style: { background: item.color }, fallback: item.avatar, alt: item.author }), h("div", { className: "message-body" }, !grouped && h("div", { className: "message-author" }, h("button", { type: "button", className: "message-author-name", onClick: event => { event.stopPropagation(); onMention?.({ userId: item.handle, name: item.author }); } }, item.author), h("span", { className: "message-time" }, item.time), item.edited && h("span", { className: "message-time" }, "已编辑")), h("div", { className: `message-content-stack ${relation ? "has-relation" : ""}` }, relation, payload, item.decryptFailed && h("div", { className: "decrypt-hint" }, "请在“我的设置 → 设备与安全”中恢复密钥"), reactions.length > 0 && h("div", { className: "reaction-row" }, reactions.map(([key, count]) => h("button", { className: "reaction", key, onClick: event => { event.stopPropagation(); onReact(item, key); } }, reactionLabel(key), h("span", { className: "reaction-count" }, count)))), item.readBy?.length > 0 && h(ReadReceipt, { readBy: item.readBy || [], client })), h("div", { className: "message-actions" }, h("button", { onClick: event => { event.stopPropagation(); onReply(item); } }, "回复"), h(ReactionPicker, { client, onSelect: key => onReact(item, key) }), h("button", { onClick: event => { event.stopPropagation(); onThread(item); } }, "线程"), item.isMe && h("button", { onClick: event => { event.stopPropagation(); onEdit(item); } }, "编辑"), item.isMe && h("button", { onClick: event => { event.stopPropagation(); onRedact(item); } }, "撤回")), contextMenu && h("div", { className: "message-context-menu", style: { left: contextMenu.x, top: contextMenu.y }, onClick: event => event.stopPropagation() }, h("button", { onClick: () => { setContextMenu(null); onReply(item); } }, "回复"), h("button", { onClick: () => { setContextMenu(null); onThread(item); } }, "在线程中回复"), h("button", { onClick: () => { navigator.clipboard?.writeText(item.text || ""); setContextMenu(null); } }, "复制消息"), h("button", { onClick: () => { setContextMenu(null); onForward?.(item, false); } }, "转发"), h("button", { onClick: () => { setContextMenu(null); onTogglePinMessage?.(item); } }, pinnedEventIds.includes(item.id) ? "取消置顶消息" : "置顶消息"), reactions.length > 0 && h("button", { onClick: () => { setContextMenu(null); Toast.info(`该消息有 ${reactions.reduce((sum, entry) => sum + entry[1], 0)} 个回应`); } }, "查看回应详情"), item.isMe && h("button", { onClick: () => { setContextMenu(null); onEdit(item); } }, "编辑"), item.isMe && h("button", { className: "danger", onClick: () => { setContextMenu(null); onRedact(item); } }, "撤回")))), documentModal && h("div", { className: "document-modal-backdrop", onMouseDown: event => event.target === event.currentTarget && setDocumentModal(null) }, h("div", { className: "document-modal" }, h("div", { className: "document-modal-head" }, h("div", null, h("strong", null, documentModal === "edit" ? "在线编辑文档" : "在线预览文档"), h("span", null, item.attachment?.name)), h("div", { className: "document-modal-head-actions" }, isTextAttachment && documentPreview.status === "ready" && h(UiButton, { size: "small", onClick: () => navigator.clipboard?.writeText(documentPreview.text).then(() => Toast.success("文本已复制")) }, "一键复制"), h("button", { type: "button", onClick: () => setDocumentModal(null), "aria-label": "关闭" }, "×"))), documentContent, documentModal === "edit" && h("div", { className: "document-modal-hint" }, docKind?.ext === "docx" || docKind?.ext === "doc" ? "当前为可编辑文本预览，修改内容后请复制保存；如需保留原始 DOCX 排版，请下载后使用 Office。" : "此格式暂不支持浏览器内编辑，建议下载后使用 Office。"), h("div", { className: "document-modal-actions" }, h(UiButton, { className: "ghost-btn", onClick: downloadAttachment }, "下载文件"), h(UiButton, { variant: "primary", onClick: () => setDocumentModal(null) }, "完成")))), h(MediaLightbox, { viewer, onClose: () => setViewer(null) }));
}

function ThreadPanel({ root, replies = [], client, onClose, onJumpTo }) {
  if (!root) return null;
  const renderEntry = (item, isRoot = false) => h("div", { className: `thread-entry ${isRoot ? "thread-entry-root" : ""}`, key: item.id || `${item.author}-${item.time}` },
    h(MatrixAvatar, { client, mxcUrl: item.avatarMxc, size: isRoot ? 34 : 30, className: "thread-avatar", style: { background: item.color }, fallback: item.avatar, alt: item.author }),
    h("div", { className: "thread-entry-copy" }, h("div", { className: "thread-entry-meta" }, h("strong", null, item.author), h("time", null, item.time)), item.attachment ? h("div", { className: "thread-entry-attachment" }, item.attachment.name || "附件") : h("div", { className: "thread-entry-text" }, item.formattedBody ? h(FormattedMessage, { html: item.formattedBody, client, emojiFiles: item.emojiFiles }) : h(MessageText, { text: item.text })))
  );
  return h("aside", { className: "thread-panel", "aria-label": "线程" },
    h("div", { className: "thread-panel-head" }, h("div", null, h("strong", null, "线程"), h("span", null, `${replies.length} 条回复`)), h(UiButton, { className: "icon-button", type: "text", title: "关闭线程", onClick: onClose }, "×")),
    h("div", { className: "thread-panel-body" }, h("div", { className: "thread-origin-label" }, "讨论串", h("button", { type: "button", className: "thread-root-jump", onClick: () => onJumpTo?.(root.id) }, "查看原消息 ↗")), h("div", { className: "thread-origin-card" }, renderEntry(root, true)), replies.length ? h("div", { className: "thread-replies" }, h("div", { className: "thread-replies-label" }, `${replies.length} 条回复`), replies.map(item => renderEntry(item))) : h("div", { className: "thread-empty" }, "还没有回复，在下方输入框开始讨论")),
    h("div", { className: "thread-panel-footer" }, "下方编辑框会发送到此线程")
  );
}

function Chat({ room, messages, client, typingUsers = [], onLoadMore, onSearch, onSend, onTyping, onReply, onReact, onThread, onEdit, onRedact, onJumpTo, onForward, onEmojiSelect, replyTo, threadRoot, editing, onCancelReply, onCancelThread, onCancelEdit, onUpload, detailsCollapsed, onToggleDetails, selecting, forwardItems, onSelectForward, onStartSelecting, pinnedEventIds, onTogglePinMessage, onOpenDetails, onStartCall }) {
  const [draft, setDraft] = useState(""); const [draftHtml, setDraftHtml] = useState(""); const [remoteTyping, setRemoteTyping] = useState([]); const inputRef = useRef(null); const fileRef = useRef(null); const scrollRef = useRef(null); const forceScrollRef = useRef(false); const pendingRoomScrollRef = useRef(null); const loadingEarlierRef = useRef(false); const [showJump, setShowJump] = useState(false); const [loadingEarlier, setLoadingEarlier] = useState(false); const [historyExhausted, setHistoryExhausted] = useState(false);
  React.useEffect(() => {
    if (!client || !room?.id) { setRemoteTyping([]); return; }
    const update = (_event, member) => {
      const roomId = member?.roomId || member?.room?.roomId;
      if (roomId && roomId !== room.id) return;
      const matrixRoom = client.getRoom?.(room.id) || member?.room;
      const ownId = client.getUserId?.();
      const names = (matrixRoom?.getTypingMembers?.() || []).filter(entry => entry?.userId !== ownId).map(entry => entry?.name || entry?.rawDisplayName || entry?.userId).filter(Boolean);
      setRemoteTyping(names);
    };
    client.on?.("RoomMember.typing", update);
    update();
    return () => client.off?.("RoomMember.typing", update);
  }, [client, room?.id]);
  typingUsers = remoteTyping;
  const [emojiSuggestions, setEmojiSuggestions] = useState([]);
  const updateEmojiSuggestions = value => {
    const match = String(value || "").match(/:([^:\s]*)$/);
    if (!match) { setEmojiSuggestions([]); return; }
    const q = match[1].toLowerCase();
    ensureEmojiCatalog().then(items => setEmojiSuggestions((items || []).filter(item => `${item.name} ${(item.keywords || []).join(" ")}`.toLowerCase().includes(q)).slice(0, 8)));
  };
  React.useEffect(() => { updateEmojiSuggestions(draft); }, [draft]);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !room?.id || !messages.length) return;
    const events = room.matrixRoom?.getLiveTimeline?.().getEvents?.() || [];
    const readUpTo = room.matrixRoom?.getEventReadUpTo?.(client?.getUserId?.(), true);
    const readIndex = readUpTo ? events.findIndex(event => event.getId?.() === readUpTo) : -1;
    const unreadId = readIndex >= 0 ? [...events.slice(readIndex + 1)].reverse().find(event => event.getId?.())?.getId?.() : null;
    if (!unreadId) return;
    setTimeout(() => { const target = document.getElementById(`event-${String(unreadId).replace(/[^a-zA-Z0-9_-]/g, "_")}`); if (target) { el.scrollTop = Math.max(0, target.offsetTop - 54); setShowJump(true); } }, 40);
  }, [room?.id, messages.length]);
  const [mentionTargets, setMentionTargets] = useState([]);
  React.useEffect(() => { setDraft(editing?.text || ""); setDraftHtml(""); setMentionTargets([]); setHistoryExhausted(false); if (room?.id) pendingRoomScrollRef.current = room.id; }, [room?.id, editing?.id]);
  React.useEffect(() => { const el = scrollRef.current; if (!el || !room?.id || pendingRoomScrollRef.current !== room.id) return; requestAnimationFrame(() => { if (!scrollRef.current || pendingRoomScrollRef.current !== room.id) return; scrollRef.current.scrollTop = scrollRef.current.scrollHeight; pendingRoomScrollRef.current = null; setShowJump(false); }); }, [room?.id, messages.length]);
  React.useEffect(() => { const el = scrollRef.current; if (!el || !forceScrollRef.current) return; requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; forceScrollRef.current = false; }); }, [messages.length]);
  const send = async () => { const text = draft.trim(); if (!text) return; const pending = (window.orbitPendingMentions || {})[room?.id] || []; const mentions = [...mentionTargets, ...pending].filter((entry, index, list) => entry?.userId && text.includes(`@${String(entry.name || "").replace(/^@/, "")}`) && list.findIndex(other => other.userId === entry.userId) === index); setDraft(""); setDraftHtml(""); setMentionTargets([]); forceScrollRef.current = true; await onSend(text, draftHtml, mentions); setTimeout(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); setShowJump(false); }, 350); };
  React.useEffect(() => { window.orbitActiveRoomId = room?.id || null; }, [room?.id]);
  const keyDown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const loadEarlier = async () => { if (loadingEarlierRef.current || historyExhausted) return; const el = scrollRef.current; loadingEarlierRef.current = true; setLoadingEarlier(true); const beforeHeight = el?.scrollHeight || 0; try { const loaded = await onLoadMore?.(); if (loaded === false) setHistoryExhausted(true); requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - beforeHeight; }); } finally { loadingEarlierRef.current = false; setLoadingEarlier(false); } };
  const jumpBottom = () => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); };
  if (!room) return h("main", { className: "main-panel" }, h("div", { className: "empty-messages" }, "登录后选择一个房间开始聊天"));
  const insertEmoji = item => { const token = `:${item.name}:`; setDraft(value => `${value}${value && !value.endsWith(" ") ? " " : ""}${token} `); requestAnimationFrame(() => inputRef.current?.focus?.()); };
  const insertMention = mention => { const userId = mention?.userId; const name = String(mention?.name || userId || "").replace(/^@/, "").trim(); if (!userId || !name) return; setMentionTargets(current => current.some(entry => entry.userId === userId) ? current : [...current, { userId, name }]); const current = String(draft || ""); const prefix = current && !/[\s\n]$/.test(current) ? " " : ""; inputRef.current?.insertText?.(`${prefix}@${name} `); };
  const handleFiles = files => { const list = [...(files || [])].filter(file => file && file.size >= 0); if (!list.length || !onUpload) return; list.reduce((chain, file) => chain.then(() => onUpload(file)), Promise.resolve()).catch(() => {}); };
  const threadReplies = threadRoot ? messages.filter(item => item.type !== "empty" && item.threadRoot === threadRoot.id) : [];
  messages.forEach((item, index) => { const previous = messages[index - 1]; const sameSender = previous && item.type !== "empty" && previous.type !== "empty" && item.handle && item.handle === previous.handle; const sameMinute = sameSender && item.time && item.time === previous.time; item.grouped = Boolean(sameMinute); });
  return h("main", { className: `main-panel ${threadRoot ? "thread-open" : ""}` },
    h("header", { className: "chat-header" }, h("div", { className: "chat-heading" }, h(MatrixAvatar, { client, mxcUrl: room.avatarMxc, httpUrl: room.avatarUrl, size: 40, style: { background: room.color, width: 40, height: 40 }, fallback: room.initials, alt: room.name }), h("div", null, h("div", { className: "chat-title" }, room.name), h("div", { className: room.directUserId ? (client?.getUser?.(room.directUserId)?.presence === "online" ? "chat-subtitle direct-presence" : "chat-subtitle direct-offline") : "chat-subtitle" }, room.directUserId ? `${client?.getUser?.(room.directUserId)?.presence === "online" ? "在线" : "离线"} · ${client?.getUser?.(room.directUserId)?.displayName || room.directUserId}` : `${room.members} 位成员 · ${room.desc}`))), h("div", { className: "header-actions" }, h("button", { className: "icon-button", title: "搜索消息", onClick: onSearch }, h(Icon, { name: "search" })), h("button", { className: "icon-button", title: "发起语音通话", onClick: () => onStartCall?.("voice") }, h(Icon, { name: "phone" })), h("button", { className: "icon-button", title: "发起视频通话", onClick: () => onStartCall?.("video") }, h(Icon, { name: "video" })), h("button", { className: `icon-button header-selection-toggle ${selecting ? "is-active" : ""}`, title: selecting ? "退出多选" : "多选消息", onClick: () => selecting ? onStartSelecting?.(false) : onStartSelecting?.(true) }, h(Icon, { name: "list" })), h("button", { className: "icon-button", title: "查看置顶消息", onClick: () => Toast.info(pinnedEventIds?.length ? `本房间有 ${pinnedEventIds.length} 条置顶消息，请从消息菜单管理` : "暂无置顶消息") }, h(Icon, { name: "pin" })), h("button", { className: "icon-button room-details-toggle", title: "房间详情（点击展开/收起）", onClick: onOpenDetails }, h(Icon, { name: "room", size: 18 })))),
    h("div", { className: "message-scroll", ref: scrollRef, onScroll: e => { const current = e.currentTarget; setShowJump(current.scrollHeight - current.scrollTop - current.clientHeight > 260); if (current.scrollTop <= 72 && !loadingEarlierRef.current && !historyExhausted) loadEarlier(); } }, h(UiButton, { className: "load-more", disabled: loadingEarlier || historyExhausted, onClick: loadEarlier }, loadingEarlier ? "正在加载更早的消息…" : historyExhausted ? "没有更早的消息了" : "加载更早的消息"), messages.map((item, i) => h(Message, { key: item.id || `empty-${i}`, item, client, onReply, onReact, onThread, onEdit, onRedact, onJumpTo, onForward, onMention: mention => { const user = mention?.userId ? client?.getUser?.(mention.userId) : null; const raw = mention?.name === "你" ? (user?.displayName || mention?.userId || "") : (mention?.name || mention?.userId || ""); const name = String(raw).replace(/^@/, "").trim(); if (!name) return; const current = String(draft || ""); const prefix = current && !/[\\s\\n]$/.test(current) ? " " : ""; inputRef.current?.insertText?.(`${prefix}@${name} `); } , onTogglePinMessage, pinnedEventIds, selecting, selected: forwardItems?.some?.(entry => entry.id === item.id), onSelect: onSelectForward })), showJump && h(UiButton, { className: "jump-bottom", onClick: jumpBottom }, "↓ 回到最新消息")),
    h("div", { className: "composer-wrap" }, typingUsers.length > 0 && h("div", { className: "typing-indicator", role: "status" }, h("span", { className: "typing-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), h("span", null, typingUsers.length === 1 ? `${typingUsers[0]} 正在输入…` : `${typingUsers.slice(0, 2).join("、")} 正在输入…`)), (replyTo || threadRoot || editing) && h("div", { className: "reply-bar" }, h("span", null, editing ? "✎ 正在编辑消息" : threadRoot ? `⌁ 正在线程中回复：${String(threadRoot.text || threadRoot.attachment?.name || "消息").slice(0, 60)}` : `↩ 正在回复：${String(replyTo.text || replyTo.attachment?.name || "消息").slice(0, 60)}`), h("button", { onClick: editing ? onCancelEdit : threadRoot ? onCancelThread : onCancelReply }, "×")), emojiSuggestions.length > 0 && h("div", { className: "emoji-inline-suggestions", role: "listbox" }, emojiSuggestions.map(item => h("button", { type: "button", key: item.id, onMouseDown: event => { event.preventDefault(); const token = `:${item.name}:`; setDraft(value => `${value.replace(/:[^:\\s]*$/, "")}${token} `); setEmojiSuggestions([]); requestAnimationFrame(() => inputRef.current?.focus?.()); } }, h("img", { src: assetRequestUrl(item.thumbUrl || item.url), alt: item.name }), h("span", null, `:${item.name}:`)))), h("div", { className: "composer" }, h(RichEditor, { ref: inputRef, value: draft, onChange: value => { setDraft(value); onTyping(true); }, onBlur: () => onTyping(false), onKeyDown: keyDown, onFiles: handleFiles, placeholder: `发送消息到 ${room.name}` }), h("div", { className: "composer-tools" }, h("div", { className: "tool-group" }, ["B", "I", "↗"].map((x, i) => h("button", { className: "tool-button", key: i, title: i === 0 ? "加粗" : i === 1 ? "斜体" : "插入链接", onClick: () => i < 2 ? inputRef.current?.format(i === 0 ? "bold" : "italic") : document.execCommand("createLink", false, prompt("输入链接地址")) }, x)), h(EmojiPicker, { onSelect: onEmojiSelect, onInsert: insertEmoji }), h("button", { className: "tool-button", title: "上传文件", onClick: () => fileRef.current?.click() }, "⊕"), h("input", { ref: fileRef, type: "file", hidden: true, multiple: true, onChange: e => { handleFiles(e.target.files); e.target.value = ""; } })), h(UiButton, { variant: "primary", className: "send-button", onClick: send }, editing ? "保存　↵" : "发送　↵"))), h("div", { className: "composer-hint" }, "Enter 发送 · Shift + Enter 换行")),
    h(ThreadPanel, { root: threadRoot, replies: threadReplies, client, onClose: onCancelThread, onJumpTo })
  );
}

function Details({ room, client, onInvite, onLeave, collapsed, onToggle, onRoomUpdated }) {
  const [nameDraft, setNameDraft] = useState(room?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [muted, setMuted] = useState(false);
  const avatarRef = useRef(null);
  useEffect(() => { if (room) setNameDraft(room.name || ""); }, [room?.id, room?.name]);
  useEffect(() => {
    if (!room || !client?.getRoomPushRule) { setMuted(false); return; }
    try {
      const rule = client.getRoomPushRule("global", room.id);
      setMuted(Boolean(rule?.actions?.includes?.("dont_notify")));
    } catch { setMuted(false); }
  }, [room?.id, client]);
  if (!room) return null;
  const members = room.matrixRoom?.getJoinedMembers?.() || [];
  const saveRoomName = async () => { const value = nameDraft.trim(); if (!value || value === room.name) return; setSavingName(true); try { await client.sendStateEvent(room.id, "m.room.name", { name: value }, ""); Toast.success("房间名称已更新"); await onRoomUpdated?.(); } catch (error) { Toast.error(`房间名称更新失败：${error?.message || "请检查房间权限"}`); } finally { setSavingName(false); } };
  const saveRoomAvatar = async file => { if (!file) return; setSavingAvatar(true); try { const uploaded = await client.uploadContent(file, { name: file.name, type: file.type }); await client.sendStateEvent(room.id, "m.room.avatar", { url: uploaded.content_uri }, ""); Toast.success("房间头像已更新"); await onRoomUpdated?.(); } catch (error) { Toast.error(`房间头像更新失败：${error?.message || "请检查房间权限"}`); } finally { setSavingAvatar(false); } };
  const toggleRoomMute = async () => {
    const next = !muted;
    try {
      if (typeof client.setRoomMutePushRule !== "function") throw new Error("当前 homeserver 不支持房间通知设置");
      await client.setRoomMutePushRule("global", room.id, next);
      setMuted(next);
      Toast.success(next ? "已关闭该房间通知" : "已开启该房间通知");
    } catch (error) { Toast.error(`房间通知设置失败：${error?.message || "请稍后重试"}`); }
  };
  const roomLink = room.matrixRoom?.getCanonicalAlias?.() || room.id;
  const copyRoomLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(roomLink);
      Toast.success("房间链接已复制");
    } catch { Toast.error("房间链接复制失败，请手动复制"); }
  };
  if (collapsed) return null;
  const memberData = members.map(member => {
    const user = client?.getUser?.(member.userId);
    const presence = user?.presence || "unknown";
    const displayName = member.name || user?.displayName || member.userId;
    return { member, user, presence, displayName };
  });
  const presenceRank = { online: 0, busy: 1, unavailable: 2, unknown: 3, offline: 4 };
  const sortedMemberData = [...memberData].sort((a, b) => (presenceRank[a.presence] ?? 3) - (presenceRank[b.presence] ?? 3) || a.displayName.localeCompare(b.displayName, "zh-CN"));
  const onlineCount = memberData.filter(item => item.presence === "online").length;
  const offlineCount = memberData.filter(item => item.presence === "offline").length;
  const memberRows = sortedMemberData.map(({ member, presence, displayName }) => {
    const profile = h("div", { className: "member-popover" },
      h("div", { className: "member-popover-name" }, displayName),
      h("div", { className: "member-popover-id" }, member.userId),
      h("div", { className: `member-popover-presence ${presence === "online" ? "presence-online" : presence === "offline" ? "presence-offline" : ""}` }, presence === "online" ? "在线" : presence === "offline" ? "离线" : "状态未知"));
    return h(AntPopover, { content: profile, trigger: "click", placement: "left", key: member.userId },
      h("div", { className: "member-row", title: "点击查看用户资料" },
        h(MatrixAvatar, { client, mxcUrl: memberAvatarMxc(member), size: 34, className: "member-avatar", style: { background: colorFor(member.userId) }, fallback: initials(displayName), alt: displayName }),
        h("div", { className: "member-copy" }, h("div", { className: "member-name", title: displayName }, displayName), h("div", { className: "member-id", title: member.userId }, member.userId)),
        h("span", { className: `member-presence-badge ${presence === "online" ? "online" : presence === "offline" ? "offline" : "unknown"}` }, h("i", null), presence === "online" ? "在线" : presence === "offline" ? "离线" : "未知")));
  });
  return h("aside", { className: "details-panel" },
    h("div", { className: "details-title" }, "房间详情", h("div", { className: "details-title-actions" }, h(UiButton, { size: "small", title: "收起房间详情", onClick: onToggle }, "收起"), h(UiButton, { size: "small", danger: true, title: "退出房间", onClick: onLeave }, "退出"))),
    h("div", { className: "details-room" }, h("button", { type: "button", className: "details-room-avatar-button", title: "更换房间头像", onClick: () => avatarRef.current?.click?.() }, h(MatrixAvatar, { client, mxcUrl: room.avatarMxc, httpUrl: room.avatarUrl, size: 56, style: { background: room.color, width: 56, height: 56 }, fallback: room.initials, alt: room.name }), h("span", { className: "details-room-avatar-edit" }, savingAvatar ? "…" : "✎")), h("input", { ref: avatarRef, type: "file", accept: "image/*", hidden: true, onChange: e => { const file = e.target.files?.[0]; e.target.value = ""; saveRoomAvatar(file); } }), h("div", { className: "details-room-name" }, h(Input, { value: nameDraft, onChange: setNameDraft, onPressEnter: saveRoomName, suffix: h(UiButton, { size: "small", type: "text", loading: savingName, disabled: !nameDraft.trim() || nameDraft.trim() === room.name, onClick: saveRoomName }, "保存"), "aria-label": "房间名称" })), h("div", { className: "details-room-edit-hint" }, "点击头像更换 · Enter 保存名称"), h("div", { className: "details-room-desc" }, room.desc)),
    h("div", { className: "details-section details-room-options" },
      h("div", { className: "details-section-head" }, h("span", null, "房间设置")),
      h("div", { className: "room-setting-row" }, h("div", { className: "room-setting-copy" }, h("strong", null, "房间通知"), h("span", null, muted ? "已静音，不接收此房间提醒" : "接收此房间的新消息提醒")), h(UiButton, { size: "small", className: muted ? "room-setting-muted" : "", onClick: toggleRoomMute }, muted ? "已静音" : "已开启")),
      h("div", { className: "room-setting-row room-link-row" }, h("div", { className: "room-setting-copy" }, h("strong", null, "房间链接"), h("span", { title: roomLink }, roomLink)), h(UiButton, { size: "small", onClick: copyRoomLink }, "复制"))
    ),
    h("div", { className: "details-section" },
      h("div", { className: "details-section-head" }, h("span", null, "成员", h("span", { className: "member-count" }, room.members)), h("button", { className: "detail-link", onClick: onInvite }, "邀请成员")),
      h("div", { className: "member-summary" }, h("span", { className: "member-summary-total" }, `${room.members} 位成员`), h("span", { className: "member-summary-online" }, `● ${onlineCount} 在线`), h("span", { className: "member-summary-offline" }, `○ ${offlineCount} 离线`)),
      h("div", { className: "member-stack" }, sortedMemberData.slice(0, 5).map(({ member, displayName }) => h("div", { className: "member-avatar-wrap", key: member.userId, title: `${displayName} · ${member.userId}` }, h(MatrixAvatar, { client, mxcUrl: memberAvatarMxc(member), size: 32, className: "member-avatar", style: { background: colorFor(member.userId) }, fallback: initials(displayName), alt: displayName }))), members.length > 5 && h("span", { className: "member-count" }, `+${members.length - 5}`)),
      h("div", { className: "member-list" }, memberRows)),
    h("div", { className: "privacy-note" }, "🔒 房间事件和消息通过 Matrix Client-Server API 同步。加密状态由该房间的 Matrix 状态事件决定."));
}

function installEmojiSendInterceptor(client) {
  if (!client || client.__orbitEmojiSendWrapped) return;
  const original = client.sendMessage?.bind(client);
  if (!original) return;
  client.__orbitOriginalSendMessage = original;
  client.sendMessage = async (roomId, content, ...rest) => {
    const body = content?.body || "";
    const tokens = [...String(body).matchAll(/:([^:\s]+):/g)];
    const catalog = window.orbitEmojiItems?.length ? window.orbitEmojiItems : await ensureEmojiCatalog();
    const emojiOnly = content?.msgtype === "m.text" && tokens.length > 0 && tokens.map(match => match[0]).join(" ").trim() === String(body).trim();
    if (!emojiOnly || !tokens.every(match => catalog.some(item => item.name === match[1]))) return original(roomId, content, ...rest);
    const selectedItems = tokens.map(match => catalog.find(item => item.name === match[1]));
    if (selectedItems.some(item => !item)) return original(roomId, content, ...rest);
    const encryptedRoom = Boolean(client.getRoom?.(roomId)?.hasEncryptionStateEvent?.());
    await sendEmojiImageEvents(client, roomId, selectedItems, encryptedRoom, (targetRoomId, nextContent) => original(targetRoomId, nextContent, ...rest));
    return { event_id: null };
  };
  client.__orbitEmojiSendWrapped = true;
}

function App() {
  const [connected, setConnected] = useState(null); const [rooms, setRooms] = useState([]); const [invites, setInvites] = useState([]); const [messages, setMessages] = useState({}); const [typingByRoom, setTypingByRoom] = useState({}); const [selectedId, setSelectedId] = useState(null); const [showLogin, setShowLogin] = useState(false); const [showRoom, setShowRoom] = useState(false); const [showSpace, setShowSpace] = useState(false); const [showSpaceRooms, setShowSpaceRooms] = useState(false); const [showAccount, setShowAccount] = useState(false); const [showInvite, setShowInvite] = useState(false); const [showSearch, setShowSearch] = useState(false); const [replyTo, setReplyTo] = useState(null); const [threadRoot, setThreadRoot] = useState(null); const [editing, setEditing] = useState(null); const [syncing, setSyncing] = useState(false); const [presence, setPresence] = useState("online"); const [viewMode, setViewMode] = useState("messages"); const [activeSpaceId, setActiveSpaceId] = useState(null);
  const excludedRoomIdsRef = useRef(new Set()); const pendingJoinRoomIdsRef = useRef(new Set()); const optimisticJoinedRoomsRef = useRef(new Map()); const refreshTimer = useRef(null); const selectedIdRef = useRef(null); const [detailsCollapsed, setDetailsCollapsed] = useState(false); const [forwardItems, setForwardItems] = useState([]); const [selecting, setSelecting] = useState(false); const [showForward, setShowForward] = useState(false); const [, setEmojiCatalogReady] = useState(0);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    const client = connected?.client;
    const room = selectedId ? client?.getRoom?.(selectedId) : null;
    if (!client || !room || document.hidden) return;
    const events = room.getLiveTimeline?.().getEvents?.() || [];
    const readUpTo = room.getEventReadUpTo?.(client.getUserId?.(), true); const readIndex = readUpTo ? events.findIndex(event => event.getId?.() === readUpTo) : -1; const target = readIndex >= 0 ? [...events.slice(readIndex + 1)].reverse().find(event => event?.getId?.() && !room.hasPendingEvent?.(event.getId())) : [...events].reverse().find(event => event?.getId?.() && !room.hasPendingEvent?.(event.getId()));
    if (!target) return;
    markRoomRead(client, selectedId, target).then(() => queueRefresh(client)).catch(() => {});
  }, [connected?.client, selectedId, messages[selectedId]?.length]);
  useEffect(() => { const client = connected?.client; const crypto = client?.getCrypto?.(); if (!client) return; const eventName = MatrixSDK.CryptoEvent?.VerificationRequestReceived || "crypto.verificationRequestReceived"; const onRequest = request => { if (request && !request.initiatedByMe) Toast.info(`收到设备验证请求：${request.otherDeviceId || "其他设备"}，请打开“我的设置 → 设备与安全”`); }; client.on?.(eventName, onRequest); crypto?.on?.(eventName, onRequest); return () => { client.off?.(eventName, onRequest); crypto?.off?.(eventName, onRequest); }; }, [connected?.client]);
  useEffect(() => { ensureEmojiCatalog().then(() => setEmojiCatalogReady(value => value + 1)); }, []);
  const onForward = (item, append = false) => {
    // Right-click → 转发 enters the same batch-selection flow as the header
    // button, with the originating message selected automatically.
    setSelecting(true);
    setForwardItems(current => append
      ? (current.some(entry => entry.id === item.id) ? current : [...current, item])
      : [item]);
  };
  const toggleForwardItem = item => setForwardItems(current => current.some(entry => entry.id === item.id) ? current.filter(entry => entry.id !== item.id) : [...current, item]);
  const redactSelected = async () => {
    const selected = [...forwardItems];
    if (!selected.length) return;
    const own = selected.filter(item => item.isMe && item.id);
    const skipped = selected.length - own.length;
    if (!own.length) return Toast.warning("只能撤回自己发送的消息");
    if (!confirm(`确定撤回已选的 ${own.length} 条消息吗？`)) return;
    try {
      for (const item of own) await connected.client.redactEvent(room.id, item.id);
      Toast.success(`已撤回 ${own.length} 条消息${skipped ? `，跳过 ${skipped} 条无权限消息` : ""}`);
      setForwardItems([]); setSelecting(false); await refresh(connected.client);
    } catch (error) { Toast.error(`批量撤回失败：${error?.message || "未知错误"}`); }
  };
  const leaveSpace = async () => {
    const space = spaces.find(item => item.id === activeSpaceId);
    if (!space) return;
    if (!confirm(`确定退出空间「${space.name}」吗？空间内房间不会被删除。`)) return;
    try { excludedRoomIdsRef.current.add(space.id); window.orbitExcludedRooms = excludedRoomIdsRef.current; await connected.client.leave(space.id); setRooms(current => current.filter(item => item.id !== space.id)); setActiveSpaceId(null); setSelectedId(null); setViewMode("messages"); await refresh(connected.client); Toast.success("已退出空间"); } catch (error) { Toast.error(`退出空间失败：${error?.message || "请确认空间权限"}`); }
  };
  window.orbitLeaveSpace = leaveSpace;
  window.orbitAllRooms = rooms;
  React.useEffect(() => {
    window.orbitBatchRedact = redactSelected;
    const bar = document.querySelector(".forward-bar:not(.forward-bar-empty)");
    if (!bar || bar.querySelector(".batch-redact-dom")) return;
    const button = document.createElement("button");
    button.type = "button"; button.className = "batch-redact-dom"; button.textContent = "批量撤回";
    button.addEventListener("click", () => window.orbitBatchRedact?.());
    bar.insertBefore(button, bar.lastElementChild);
    return () => button.remove();
  }, [forwardItems.length]);
  const [cryptoState, setCryptoState] = useState({ available: false, backupInfo: null, activeVersion: null, verified: false, localTrusted: false, keyRestored: false, restoring: false, restoreProgress: 0, error: null });
  const refreshCrypto = async client => { const crypto = client?.getCrypto?.(); if (!crypto) return setCryptoState(s => ({ ...s, available: false, error: s.error || "加密模块尚未就绪，请重新登录或刷新页面" })); try { const backupInfo = await crypto.getKeyBackupInfo?.(); const activeVersion = await crypto.getActiveSessionBackupVersion?.(); const currentStatus = await Promise.resolve(crypto.getDeviceVerificationStatus?.(client.getUserId?.(), client.getDeviceId?.())).catch(() => null); const deviceVerified = Boolean(currentStatus?.crossSigningVerified); const localTrusted = Boolean(currentStatus?.localVerified); setCryptoState(s => ({ ...s, available: true, verified: deviceVerified, localTrusted, backupInfo: backupInfo || null, activeVersion: activeVersion || backupInfo?.version || null, error: null })); } catch (error) { setCryptoState(s => ({ ...s, available: true, error: error?.message || "无法读取密钥备份状态" })); } };
  const refresh = async client => {
    const allRooms = client.getRooms();
    const pendingJoinIds = pendingJoinRoomIdsRef.current;
    const optimisticJoined = optimisticJoinedRoomsRef.current;
    // Once the sync loop reflects the join, the temporary optimistic entry is
    // no longer needed. Until then, keep the room out of the invite section.
    allRooms.forEach(room => {
      if (room.getMyMembership?.() === "join") {
        pendingJoinIds.delete(room.roomId);
        optimisticJoined.delete(room.roomId);
      }
    });
    const pending = allRooms.filter(room => room.getMyMembership?.() === "invite" && !pendingJoinIds.has(room.roomId)).map(room => roomToView(room, client));
    setInvites(pending);
    const joinedViews = allRooms.filter(room => room.getMyMembership?.() === "join" || pendingJoinIds.has(room.roomId)).map(room => roomToView(room, client));
    const joinedIds = new Set(joinedViews.map(room => room.id));
    const fallbackViews = [...optimisticJoined.values()].filter(room => !joinedIds.has(room.id));
    const next = [...joinedViews, ...fallbackViews].sort((a, b) => { if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; return (b.matrixRoom.getLastLiveEvent?.()?.getTs?.() || b.lastTs || 0) - (a.matrixRoom.getLastLiveEvent?.()?.getTs?.() || a.lastTs || 0); });
    setRooms(next); setSelectedId(id => id || next[0]?.id || null);
    const nextMessages = {}; await Promise.all(next.map(async room => { nextMessages[room.id] = await roomMessages(room.matrixRoom, client.getUserId(), client); })); setMessages(current => ({ ...current, ...nextMessages }));
    // Presence returned by Matrix is often `offline` when a client has not
    // explicitly published presence.  The connection indicator should reflect
    // the sync session, not that optional presence hint.
    if (client.isRunning?.() !== false) setPresence("online");
  };
  const acceptInvite = async invite => { try {
    // matrix-js-sdk exposes room joins as joinRoom(); older Orbit builds used
    // client.join(), which is not present in the current SDK and caused the
    // invite action to fail before any request was sent.
    const join = connected.client?.joinRoom || connected.client?.join;
    if (typeof join !== "function") throw new Error("当前 Matrix SDK 不支持加入房间");
    pendingJoinRoomIdsRef.current.add(invite.id);
    // Keep a renderable copy in case the SDK waits for the next sync response
    // before exposing the newly joined room through getRooms().
    optimisticJoinedRoomsRef.current.set(invite.id, { ...invite, unread: 0, hasUnread: false, lastTs: Date.now(), time: "刚刚" });
    const inviteMember = invite.matrixRoom?.getMember?.(connected.userId);
    const inviterId = inviteMember?.events?.member?.getSender?.() || inviteMember?.events?.member?.getContent?.()?.sender;
    const crypto = connected.client.getCrypto?.();
    if (inviterId) { try { await crypto?.markRoomAsPendingKeyBundle?.(invite.id, inviterId); } catch (error) { console.warn("Unable to mark pending history bundle", error); } }
    await join.call(connected.client, invite.id);
    if (inviterId) { try { await crypto?.maybeAcceptKeyBundle?.(invite.id, inviterId); } catch (error) { console.warn("Unable to import encrypted history bundle", error); } }
    Toast.success(`已加入「${invite.name}」`);
    setInvites(current => current.filter(item => item.id !== invite.id));
    setRooms(current => [optimisticJoinedRoomsRef.current.get(invite.id), ...current.filter(item => item.id !== invite.id)]);
    setViewMode(invite.isSpace ? "spaces" : invite.isGroup ? "groups" : "messages");
    if (invite.isSpace) setActiveSpaceId(invite.id);
    setSelectedId(invite.id);
    await refresh(connected.client);
  } catch (error) {
    pendingJoinRoomIdsRef.current.delete(invite.id);
    optimisticJoinedRoomsRef.current.delete(invite.id);
    await refresh(connected.client).catch(() => {});
    Toast.error(`接受邀请失败：${error?.message || "请稍后重试"}`);
  } };
  const declineInvite = async invite => { try { await connected.client.leave(invite.id); Toast.success("已忽略房间邀请"); await refresh(connected.client); } catch (error) { Toast.error(`忽略邀请失败：${error?.message || "请稍后重试"}`); } };
  const queueRefresh = client => { if (refreshTimer.current) return; refreshTimer.current = setTimeout(() => { refreshTimer.current = null; refresh(client).catch(error => console.warn("刷新房间失败", error)); }, 250); };
  const restoreKeys = async ({ type, key, passphrase, version }) => { const crypto = connected?.client?.getCrypto?.(); if (!crypto || !version) return; setCryptoState(s => ({ ...s, restoring: true, restoreProgress: 0, error: null })); try {
    if (type === "key") {
      // Element's recovery key is the Secret Storage key. It must first
      // unwrap m.megolm_backup.v1; it is not necessarily the room-backup key.
      window.orbitRecoveryKeyBytes = key;
      if (typeof crypto.loadSessionBackupPrivateKeyFromSecretStorage === "function") {
        try {
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
        } catch (error) {
          // Keep compatibility with legacy backups that stored the backup key
          // directly rather than in Secret Storage.
          if (typeof crypto.storeSessionBackupPrivateKey !== "function") throw error;
          await crypto.storeSessionBackupPrivateKey(key, version);
        }
      } else if (typeof crypto.storeSessionBackupPrivateKey === "function") {
        await crypto.storeSessionBackupPrivateKey(key, version);
      } else {
        throw new Error("当前加密模块不支持恢复密钥");
      }
    }
    if (type === "secret") { if (typeof crypto.loadSessionBackupPrivateKeyFromSecretStorage === "function") { try { await crypto.loadSessionBackupPrivateKeyFromSecretStorage(); } catch (error) { const stored = await crypto.isKeyBackupKeyStored?.(version); if (!stored) throw error; } } }
    const result = type === "passphrase" ? await crypto.restoreKeyBackupWithPassphrase(passphrase, { progressCallback: p => setCryptoState(s => ({ ...s, restoreProgress: p?.total ? Math.round(((p.successes || 0) / p.total) * 100) : s.restoreProgress })) }) : await crypto.restoreKeyBackup({ progressCallback: p => setCryptoState(s => ({ ...s, restoreProgress: p?.total ? Math.round(((p.successes || 0) / p.total) * 100) : s.restoreProgress })) }); try { await crypto.bootstrapCrossSigning?.({ authUploadDeviceSigningKeys: async () => ({}) }); } catch {} const retried = await retryLoadedRoomDecryption(connected.client); await refresh(connected.client); setCryptoState(s => ({ ...s, restoring: false, restoreProgress: 100, keyRestored: true })); Toast.success(`密钥恢复完成，导入 ${result?.imported ?? 0} 个会话，已重试解密 ${retried} 条已加载消息。`); } catch (error) { const raw = error?.message || "密钥恢复失败"; const mismatch = /does not match|mismatch|match.*decryption key/i.test(raw); const message = mismatch ? `恢复密钥与服务器备份版本 ${version} 不匹配。请确认这是该账号当前 Secret Storage 的恢复密钥；如果备份曾重置，请从 Element“设置 → 安全与隐私”获取最新密钥。` : raw; setCryptoState(s => ({ ...s, restoring: false, error: message })); Toast.error(message); } };
  const connectedHandler = ({ client, userId, homeserver }) => { setConnected({ client, userId, homeserver }); setSyncing(true); setTimeout(() => setSyncing(false), 15000); refreshCrypto(client); let prepared = false; let lastSyncError = ""; const sync = (state, _prevState, data) => { if (["PREPARED", "SYNCING"].includes(state)) { prepared = true; setSyncing(false); lastSyncError = ""; queueRefresh(client); refreshCrypto(client); return; } if (state !== "ERROR") return; setPresence("offline"); setSyncing(false); const syncData = data || client.getSyncStateData?.() || {}; const errorObject = syncData?.error; const raw = errorObject?.message || errorObject?.errcode || syncData?.errorCode || syncData?.errcode || (typeof errorObject === "string" ? errorObject : "同步请求失败"); const text = String(raw); const authExpired = /unknown token|M_UNKNOWN_TOKEN|401/i.test(text); const message = authExpired ? "Matrix 登录状态已失效，请重新登录" : /forbidden|M_FORBIDDEN|403/i.test(text) ? "Matrix 账户没有权限访问该房间" : /5\d{2}|network|timeout|请求失败/i.test(text) ? "Matrix 服务器暂时不可用，正在重试" : `Matrix 同步失败：${text}`; if (message !== lastSyncError) { lastSyncError = message; Toast.error(message); } if (authExpired) { client.stopClient?.(); window.orbitMatrixClient = null; localStorage.removeItem("orbit.matrix.session"); setConnected(null); setRooms([]); setInvites([]); setMessages({}); setSelectedId(null); } }; client.on("sync", sync); client.on("Room", room => { if (prepared && room?.getMyMembership?.() === "invite") Toast.info(`收到房间邀请：${room.name || room.roomId}`); queueRefresh(client); }); client.on("Room.timeline", (event, room) => { if (room) queueRefresh(client); if (!isNotifiableMessage(event) || event?.getSender?.() === userId) return; const eventId = event?.getId?.(); const selectedRoom = room?.roomId === selectedIdRef.current; if (selectedRoom && !document.hidden) { Promise.resolve(client.sendReadReceipt?.(event)).then(() => queueRefresh(client)).catch(() => {}); } const shouldNotify = prepared && eventId && (room?.roomId !== selectedIdRef.current || document.hidden || !document.hasFocus?.()); if (shouldNotify && !orbitNotifiedEvents.has(eventId)) { orbitNotifiedEvents.add(eventId); if (orbitNotifiedEvents.size > 500) orbitNotifiedEvents.delete(orbitNotifiedEvents.values().next().value); const title = room?.name || "Matrix 新消息"; const body = notificationBody(event); let desktopShown = false; if (typeof Notification !== "undefined" && Notification.permission === "granted") { try { new Notification(title, { body, tag: `orbit-${room?.roomId || "room"}` }); desktopShown = true; } catch {} } if (!desktopShown || !document.hidden) Toast.info(`${title}：${body}`); } }); client.on("RoomMember.membership", (_event, member) => { if (prepared && member?.membership === "invite" && member?.userId === userId) Toast.info(`收到房间邀请：${member?.roomId || "新房间"}`); queueRefresh(client); }); client.on("RoomState.events", () => queueRefresh(client)); client.on("User.presence", (_event, user) => { if (user?.userId === userId) setPresence(user?.presence === "offline" ? "online" : (user?.presence || "online")); queueRefresh(client); }); client.on("Event.decrypted", () => queueRefresh(client)); queueRefresh(client); setShowLogin(false); };
  React.useEffect(() => { const saved = localStorage.getItem("orbit.matrix.session"); if (!saved) return; (async () => { try { const session = JSON.parse(saved); const resolved = await resolveHomeserver(session.homeserver); const client = MatrixSDK.createClient({ baseUrl: resolved.clientBaseUrl, userId: session.userId, accessToken: session.accessToken, deviceId: session.deviceId, cryptoCallbacks: orbitCryptoCallbacks }); await initCryptoSafely(client); window.orbitMatrixClient = client; connectedHandler({ client, userId: session.userId, homeserver: resolved.homeserver }); startOrbitSync(client, resolved); } catch { localStorage.removeItem("orbit.matrix.session"); } })(); }, []);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const loginToken = url.searchParams.get("loginToken");
    if (!loginToken) return;
    const pendingRaw = localStorage.getItem("orbit.matrix.sso.pending");
    url.searchParams.delete("loginToken"); url.searchParams.delete("matrix_sso");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    if (!pendingRaw) return Toast.error("SSO 登录信息已过期，请重新开始登录");
    (async () => {
      try {
        const pending = JSON.parse(pendingRaw);
        const { resolved, result, client } = await loginWithMatrixToken(pending.homeserver, loginToken);
        localStorage.removeItem("orbit.matrix.sso.pending");
        localStorage.setItem("orbit.matrix.session", JSON.stringify({ homeserver: resolved.homeserver, userId: result.user_id, accessToken: result.access_token, deviceId: result.device_id }));
        window.orbitMatrixClient = client;
        connectedHandler({ client, userId: result.user_id, homeserver: resolved.homeserver });
        startOrbitSync(client, resolved);
        Toast.success("SSO 登录成功，正在同步房间");
      } catch (error) { localStorage.removeItem("orbit.matrix.sso.pending"); Toast.error(`SSO 登录失败：${error?.message || "请重新尝试"}`); }
    })();
  }, []);
  React.useEffect(() => { installEmojiSendInterceptor(connected?.client); }, [connected?.client]);
  React.useEffect(() => {
    const client = connected?.client; const userId = connected?.userId;
    if (!client) return;
    const onTyping = (_event, member) => {
      const roomId = member?.roomId || member?.room?.roomId;
      if (!roomId) return;
      const matrixRoom = client.getRoom?.(roomId) || member?.room;
      const names = (matrixRoom?.getTypingMembers?.() || []).filter(entry => entry?.userId !== userId).map(entry => entry?.name || entry?.rawDisplayName || entry?.userId).filter(Boolean);
      setTypingByRoom(current => ({ ...current, [roomId]: names }));
    };
    client.on?.("RoomMember.typing", onTyping);
    return () => client.off?.("RoomMember.typing", onTyping);
  }, [connected?.client, connected?.userId]);
  React.useEffect(() => {
    const client = connected?.client;
    if (!client?.sendMessage) return;
    const original = client.sendMessage.bind(client);
    client.sendMessage = (roomId, content, ...rest) => {
      const room = client.getRoom?.(roomId);
      const inferred = [...String(content?.body || "").matchAll(/@([^\s@<>,，。！？!?]+)/g)].map(match => {
        const label = match[1];
        const member = (room?.getJoinedMembers?.() || []).find(entry => String(entry?.name || entry?.rawDisplayName || "").replace(/^@/, "") === label);
        return member ? { userId: member.userId, name: label } : null;
      }).filter(Boolean);
      const pending = [...(window.orbitPendingMentions?.[roomId] || []), ...inferred];
      if (content?.msgtype === "m.text" && pending.length) {
        const valid = pending.filter(entry => entry?.userId && String(content.body || "").includes(`@${String(entry.name || "").replace(/^@/, "")}`));
        if (valid.length) {
          content = { ...content, "m.mentions": { user_ids: [...new Set(valid.map(entry => entry.userId))] }, format: "org.matrix.custom.html", formatted_body: mentionHtml(content.body, valid) };
        }
        const next = { ...(window.orbitPendingMentions || {}) }; delete next[roomId]; window.orbitPendingMentions = next;
      }
      return original(roomId, content, ...rest);
    };
    return () => { client.sendMessage = original; };
  }, [connected?.client]);
  const spaces = useMemo(() => rooms.filter(item => item.isSpace), [rooms]);
  const visibleRooms = useMemo(() => { if (viewMode === "spaces") { const space = spaces.find(item => item.id === activeSpaceId); if (!space) return []; const childIds = new Set(spaceChildIds(space.matrixRoom)); return rooms.filter(item => !item.isSpace && (childIds.has(item.id) || roomParentSpaceIds(item.matrixRoom).includes(space.id))); } if (viewMode === "groups") return rooms.filter(item => item.isGroup); return rooms.filter(item => !item.isSpace && item.isDirect); }, [rooms, spaces, viewMode, activeSpaceId]);
  const room = useMemo(() => visibleRooms.find(item => item.id === selectedId) || null, [visibleRooms, selectedId]);
  const loadMore = async () => { if (!connected || !room) return false; try { const before = (messages[room.id] || []).filter(item => item.type !== "empty").length; await connected.client.scrollback(room.matrixRoom, 40); const loaded = await roomMessages(room.matrixRoom, connected.userId, connected.client); setMessages(current => ({ ...current, [room.id]: loaded })); return loaded.filter(item => item.type !== "empty").length > before; } catch (error) { Toast.error(`历史消息加载失败：${error?.message || "未知错误"}`); return false; } };
  const send = async (text, _html, mentions = []) => { if (!connected || !room) return; try { if (!editing && !replyTo && !threadRoot) { const catalog = window.orbitEmojiItems?.length ? window.orbitEmojiItems : await ensureEmojiCatalog(); const tokens = [...String(text).matchAll(/:([^:\s]+):/g)]; const emojiOnly = tokens.length > 0 && tokens.map(match => match[0]).join(" ").trim() === String(text).trim(); const emojiItems = emojiOnly ? tokens.map(match => catalog.find(item => item.name === match[1])).filter(Boolean) : []; if (emojiOnly && emojiItems.length === tokens.length) { await sendEmojiImageEvents(connected.client, room.id, emojiItems, Boolean(room.matrixRoom.hasEncryptionStateEvent?.())); refresh(connected.client); return; } } if (editing) { await connected.client.sendMessage(room.id, { msgtype: "m.text", body: `* ${text}`, "m.new_content": { msgtype: "m.text", body: text }, "m.relates_to": { rel_type: "m.replace", event_id: editing.id } }); setEditing(null); } else { const content = { msgtype: "m.text", body: text }; const validMentions = (mentions || []).filter(entry => entry?.userId && String(text).includes(`@${String(entry.name || "").replace(/^@/, "")}`)); if (validMentions.length) { content["m.mentions"] = { user_ids: [...new Set(validMentions.map(entry => entry.userId))] }; content.format = "org.matrix.custom.html"; content.formatted_body = mentionHtml(text, validMentions); } if (threadRoot) content["m.relates_to"] = { rel_type: "m.thread", event_id: threadRoot.id, "m.in_reply_to": { event_id: threadRoot.id } }; else if (replyTo) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo.id } }; await connected.client.sendMessage(room.id, content); setReplyTo(null); setThreadRoot(null); } refresh(connected.client); } catch (error) { Toast.error(`消息发送失败：${error?.message || "未知错误"}`); throw error; } };
  const react = async (item, key = "👍") => { try { const matrixRoom = room?.matrixRoom; const timelineEvents = matrixRoom?.getLiveTimeline?.().getEvents?.() || []; let candidates = timelineEvents; try { const relations = matrixRoom?.getRelationsForEvent?.(item.id, "m.annotation", "m.reaction"); const relatedEvents = relations?.getRelations?.() || relations?.events || []; if (relatedEvents.length) candidates = [...candidates, ...relatedEvents]; } catch {} const mine = candidates.find(event => event.getType?.() === "m.reaction" && event.getSender?.() === connected.userId && event.getContent?.()?.["m.relates_to"]?.event_id === item.id && event.getContent?.()?.["m.relates_to"]?.key === key); if (mine) await connected.client.redactEvent(room.id, mine.getId?.()); else await connected.client.sendEvent(room.id, "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: item.id, key } }); refresh(connected.client); } catch (error) { Toast.error(`回应操作失败：${error?.message || "未知错误"}`); } };
  const redact = async item => { if (!confirm("确定撤回这条消息吗？")) return; try { await connected.client.redactEvent(room.id, item.id); refresh(connected.client); } catch (error) { Toast.error(`撤回失败：${error?.message || "未知错误"}`); } };
  const upload = async file => { try { const encryptedRoom = Boolean(room.matrixRoom.hasEncryptionStateEvent?.()); const { uploaded, fileInfo } = await uploadMatrixMedia(connected.client, file, encryptedRoom); const type = file.type.startsWith("image/") ? "m.image" : file.type.startsWith("video/") ? "m.video" : file.type.startsWith("audio/") ? "m.audio" : "m.file"; const content = applyUploadedMedia({ msgtype: type, body: file.name, info: { mimetype: file.type, size: file.size } }, uploaded, fileInfo); await connected.client.sendMessage(room.id, content); Toast.success(encryptedRoom ? "加密文件已发送" : "文件已发送"); refresh(connected.client); } catch (error) { Toast.error(`文件发送失败：${error?.message || "未知错误"}`); } };
  const sendEmoji = async item => { try { const response = await fetch(assetRequestUrl(item.url)); if (!response.ok) throw new Error(`表情包下载失败（${response.status}）`); const blob = await normalizeImageBlob(await response.blob()); const file = new File([blob], item.fileName || `${item.name}.gif`, { type: item.mimeType || blob.type || "image/gif" }); const { uploaded, fileInfo } = await uploadMatrixMedia(connected.client, file, Boolean(room.matrixRoom.hasEncryptionStateEvent?.()));
    // Stickers are their own Matrix event type (m.sticker), as used by
    // Cinny/Element. Sending this standard event lets other clients render
    // the image instead of receiving an app-specific text token.
    const info = { mimetype: file.type, size: file.size };
    try { const bitmap = await createImageBitmap(blob); info.w = bitmap.width; info.h = bitmap.height; bitmap.close?.(); } catch {}
    const content = applyUploadedMedia({ msgtype: "m.image", body: item.fileName || item.name, info, "org.orbit.sticker": true }, uploaded, fileInfo);
    // Use the standard m.room.message/m.image shape for interoperability.
    // Some clients do not render m.sticker reliably, especially when the
    // media is encrypted and carries the v2 file descriptor.
    await connected.client.sendMessage(room.id, content);
    Toast.success("贴纸已发送"); refresh(connected.client); } catch (error) { Toast.error(`贴纸发送失败：${error?.message || "网络错误"}`); } };
  const typing = value => { if (connected && room) connected.client.sendTyping(room.id, value, 5000).catch(() => {}); };
  const markRead = id => { const targetRoom = connected?.client.getRoom(id); const target = targetRoom?.getLiveTimeline?.().getEvents?.().slice(-1)[0]; if (target) Promise.resolve(markRoomRead(connected.client, id, target)).then(() => queueRefresh(connected.client)).catch(() => {}); else if (connected?.client) queueRefresh(connected.client); };
  const togglePinMessage = async item => { if (!room || !item?.id) return; try { const state = room.matrixRoom.currentState?.getStateEvents?.("m.room.pinned_events", ""); const current = Array.isArray(state) ? state[0]?.getContent?.()?.pinned : state?.getContent?.()?.pinned; const pinnedIds = Array.isArray(current) ? current : []; const next = pinnedIds.includes(item.id) ? pinnedIds.filter(id => id !== item.id) : [...pinnedIds, item.id].slice(-50); await connected.client.sendStateEvent(room.id, "m.room.pinned_events", { pinned: next }, ""); await refresh(connected.client); Toast.success(next.includes(item.id) ? "消息已置顶" : "已取消消息置顶"); } catch (error) { Toast.error(`消息置顶失败：${error?.message || "当前 homeserver 不支持置顶消息"}`); } };
  const startCall = async kind => { if (!room || !connected?.client) return; try { const call = connected.client.createCall?.(room.id); if (!call) throw new Error("当前 Matrix SDK 未提供通话能力"); const method = kind === "video" ? (call.placeVideoCall || call.placeCall) : (call.placeVoiceCall || call.placeCall); if (typeof method !== "function") throw new Error("当前 homeserver 未启用 Matrix 通话"); await method.call(call, kind === "video"); Toast.success(kind === "video" ? "视频通话请求已发出" : "语音通话请求已发出"); } catch (error) { Toast.error(`通话发起失败：${error?.message || "请确认 TURN 与 VoIP 配置"}`); } };
  const jumpTo = async eventId => { if (!eventId) return; const safe = String(eventId).replace(/[^a-zA-Z0-9_-]/g, "_"); let node = document.getElementById(`event-${safe}`); if (!node && room) { try { await connected.client.scrollback(room.matrixRoom, 100); await refresh(connected.client); await new Promise(resolve => setTimeout(resolve, 80)); node = document.getElementById(`event-${safe}`); } catch {} } if (node) { node.scrollIntoView({ behavior: "smooth", block: "center" }); node.classList.add("message-highlight"); setTimeout(() => node.classList.remove("message-highlight"), 1600); } else Toast.info("原消息不在当前服务器返回的历史范围内"); };
  const leaveRoom = async () => { if (!room || !confirm(`确定离开「${room.name}」吗？`)) return; try { await connected.client.leave(room.id); setSelectedId(null); refresh(connected.client); Toast.success("已离开房间"); } catch (error) { Toast.error(`离开房间失败：${error?.message || "未知错误"}`); } };
  const logout = async () => { try { await connected.client.logout(); } catch {} connected.client.stopClient(); pendingJoinRoomIdsRef.current.clear(); optimisticJoinedRoomsRef.current.clear(); window.orbitMatrixClient = null; localStorage.removeItem("orbit.matrix.session"); setConnected(null); setRooms([]); setInvites([]); setMessages({}); setSelectedId(null); Toast.success("已退出 Matrix"); };
  if (!connected) return h("div", { className: "app-shell" }, h("div", { className: "sidebar landing-sidebar" }, h("div", { className: "brand-row" }, h("div", { className: "brand" }, h("div", { className: "brand-mark" }, "O"), h("div", null, "Orbit", h("div", { className: "workspace-pill" }, "Matrix 工作台")))), h("div", { className: "sidebar-footer" }, h("div", { className: "connection-state" }, h("span", { className: "offline-dot" }), "未连接"))), h("main", { className: "main-panel" }, h("div", { className: "login-landing" }, h("div", { className: "landing-mark" }, "O"), h("div", { className: "landing-title" }, "连接你的 Matrix 世界"), h("div", { className: "landing-copy" }, "登录后同步真实房间、消息和成员。"), h("button", { className: "primary-btn landing-button", onClick: () => setShowLogin(true) }, "连接 Matrix 账户"))), showLogin && h(LoginDialog, { onConnected: connectedHandler, onClose: () => setShowLogin(false) }));
  const setSelectingState = active => {
    if (active === false) {
      setSelecting(false);
      setForwardItems([]);
      return;
    }
    setSelecting(true);
  };
  const onReact = react;
  return h("div", { className: "app-shell" }, h(Sidebar, { rooms: visibleRooms, allRooms: rooms, invites, spaces, selectedId, connected, presence, viewMode, activeSpaceId, onViewMode: mode => { setViewMode(mode); const first = mode === "spaces" ? null : rooms.find(item => mode === "groups" ? item.isGroup : item.isDirect); if (first) setSelectedId(first.id); }, onSpaceSelect: id => { setActiveSpaceId(id); const child = spaceChildIds(spaces.find(item => item.id === id)?.matrixRoom)[0]; setSelectedId(child || null); }, onSelect: id => { setSelectedId(id); markRead(id); }, onAcceptInvite: acceptInvite, onDeclineInvite: declineInvite, onCreate: () => setShowRoom(true), onCreateSpace: () => setShowSpace(true), onManageSpace: () => activeSpaceId && setShowSpaceRooms(true), onAccount: () => setShowAccount(true), onLogout: logout }), syncing && h("div", { className: "sync-indicator" }, "正在同步 Matrix…"), h(Chat, { room, messages: selectedId ? (messages[selectedId] || []) : [], client: connected.client, detailsCollapsed, onLoadMore: loadMore, onSearch: () => setShowSearch(true), onSend: send, onTyping: typing, onReply: item => { setReplyTo(item); setThreadRoot(null); setEditing(null); }, onReact, onThread: item => { const loaded = messages[selectedId] || []; let root = item; const seen = new Set(); while (root && (root.threadRoot || root.replyTo) && !seen.has(root.id)) { seen.add(root.id); const parentId = root.threadRoot || root.replyTo; root = loaded.find(entry => entry.id === parentId) || root; if (root.id === item.id) break; } setThreadRoot(root); setReplyTo(null); setEditing(null); }, onEdit: item => { setEditing(item); setReplyTo(null); setThreadRoot(null); }, onRedact: redact, onJumpTo: jumpTo, onForward, onEmojiSelect: sendEmoji, replyTo, threadRoot, editing, onCancelReply: () => setReplyTo(null), onCancelThread: () => setThreadRoot(null), onCancelEdit: () => setEditing(null), onUpload: upload, selecting, forwardItems, onSelectForward: toggleForwardItem, onStartSelecting: setSelectingState, pinnedEventIds: room?.pinnedEventIds || [], onTogglePinMessage: togglePinMessage, onStartCall: startCall, onOpenDetails: () => setDetailsCollapsed(value => !value) }), h(Details, { room, client: connected.client, onInvite: () => setShowInvite(true), onLeave: leaveRoom, collapsed: detailsCollapsed, onToggle: () => setDetailsCollapsed(value => !value), onRoomUpdated: () => refresh(connected.client) }), forwardItems.length > 0 && h("div", { className: "forward-bar" }, h("span", null, `已选择 ${forwardItems.length} 条消息`), h(UiButton, { size: "small", variant: "primary", onClick: () => setShowForward(true) }, "打开转发"), h(UiButton, { size: "small", className: "ghost-btn", onClick: () => setSelectingState(false) }, "清除")), selecting && forwardItems.length === 0 && h("div", { className: "forward-bar forward-bar-empty" }, h("span", null, "已进入多选模式，点击消息进行选择"), h(UiButton, { size: "small", className: "ghost-btn", onClick: () => setSelectingState(false) }, "取消多选")), showForward && h(ForwardDialog, { client: connected.client, rooms, items: forwardItems, onClose: () => { setShowForward(false); setSelectingState(false); } }), showRoom && h(RoomDialog, { client: connected.client, space: viewMode === "spaces" ? spaces.find(item => item.id === activeSpaceId) : null, onClose: () => setShowRoom(false), onCreated: roomId => { setSelectedId(roomId); refresh(connected.client); } }), showSpace && h(SpaceDialog, { client: connected.client, onClose: () => setShowSpace(false), onCreated: roomId => { setActiveSpaceId(roomId); refresh(connected.client); } }), showSpaceRooms && activeSpaceId && h(SpaceRoomsDialog, { client: connected.client, space: spaces.find(item => item.id === activeSpaceId), rooms, onClose: () => setShowSpaceRooms(false), onChanged: () => refresh(connected.client) }), showInvite && room && h(InviteDialog, { client: connected.client, room, onClose: () => setShowInvite(false) }), showSearch && room && h(SearchDialog, { client: connected.client, room, onClose: () => setShowSearch(false) }), showAccount && h(AccountDialog, { client: connected.client, cryptoState, onRestore: restoreKeys, onClose: () => setShowAccount(false) }));
}

function AccountDialog({ client, onClose, cryptoState, onRestore }) {
  const [active, setActive] = useState("general");
  const [displayName, setDisplayName] = useState(() => client.getUser?.(client.getUserId?.())?.displayName || "");
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const saveName = async () => { const value = displayName.trim(); if (!value) return; try { await client.setDisplayName?.(value); Toast.success("昵称已更新"); } catch (error) { Toast.error(`昵称更新失败：${error?.message || "请检查账户权限"}`); } };
  const enableNotifications = async () => { if (typeof Notification === "undefined") return Toast.error("当前浏览器不支持桌面通知"); const result = await Notification.requestPermission(); setNotificationPermission(result); Toast[result === "granted" ? "success" : "warning"](result === "granted" ? "桌面通知已开启" : "桌面通知未授权"); };
  if (active === "security") return h(LegacyAccountDialog, { client, onClose, onBack: () => setActive("general"), cryptoState, onRestore });
  const nav = [{ id: "general", label: "常规", hint: "界面与消息" }, { id: "account", label: "账号", hint: "资料与身份" }, { id: "notifications", label: "通知", hint: "提醒方式" }, { id: "security", label: "设备与安全", hint: "加密与设备" }, { id: "emoji", label: "表情与分类", hint: "云端目录" }, { id: "ai", label: "AI 助手", hint: "可选能力" }, { id: "developer", label: "开发工具", hint: "连接信息" }, { id: "about", label: "关于", hint: "版本信息" }];
  const panel = active === "general" ? h("div", { className: "settings-panel-content" }, h("h3", null, "常规"), h("p", null, "保持清晰、克制的企业工作台体验。"), h("div", { className: "settings-option-row" }, h("div", null, h("strong", null, "外观主题"), h("span", null, "浅色 · 企业蓝")), h("span", { className: "settings-value-chip" }, "当前")), h("div", { className: "settings-option-row" }, h("div", null, h("strong", null, "消息排版"), h("span", null, "紧凑布局，长文本保留原始换行")), h("span", { className: "settings-value-chip" }, "紧凑")), h("div", { className: "settings-option-row" }, h("div", null, h("strong", null, "发送方式"), h("span", null, "Enter 发送 · Shift + Enter 换行")), h("span", { className: "settings-value-chip" }, "默认"))) : active === "account" ? h("div", { className: "settings-panel-content" }, h("h3", null, "账号"), h("p", null, "你的资料会通过 Matrix 账户接口同步到其他客户端。"), h("label", { className: "settings-field-label" }, "显示昵称", h(Input, { value: displayName, onChange: setDisplayName, placeholder: "输入显示昵称" })), h(UiButton, { variant: "primary", onClick: saveName }, "保存昵称"), h("div", { className: "settings-account-id" }, h("span", null, "Matrix ID"), h("code", null, client.getUserId?.() || "未知"))) : active === "notifications" ? h("div", { className: "settings-panel-content" }, h("h3", null, "通知"), h("p", null, "只在后台或当前房间之外提醒新消息。"), h("div", { className: "settings-option-row" }, h("div", null, h("strong", null, "桌面通知"), h("span", null, notificationPermission === "granted" ? "浏览器通知已授权" : "需要授权后接收提醒")), h(UiButton, { size: "small", onClick: enableNotifications }, notificationPermission === "granted" ? "已开启" : "开启")), h("div", { className: "settings-option-row" }, h("div", null, h("strong", null, "未读红点"), h("span", null, "房间列表会显示未读数量")), h("span", { className: "settings-value-chip" }, "已启用"))) : active === "emoji" ? h("div", { className: "settings-panel-content" }, h("h3", null, "表情与分类"), h("p", null, "从云端目录加载分类，发送时使用标准 Matrix 图片事件，GIF 保留动画。"), h("div", { className: "settings-account-id" }, h("span", null, "目录地址"), h("code", null, "image.527012.xyz/index.json")), h("div", { className: "settings-option-row" }, h("div", null, h("strong", null, "已加载分类"), h("span", null, "QQ、钉钉、月薪喵、B 站等")), h("span", { className: "settings-value-chip" }, "云端"))) : active === "ai" ? h("div", { className: "settings-panel-content" }, h("h3", null, "AI 助手"), h("p", null, "当前未配置 AI 服务。配置后可在不影响 Matrix 数据的前提下启用辅助能力。"), h("div", { className: "settings-empty-state" }, "未配置")) : active === "developer" ? h("div", { className: "settings-panel-content" }, h("h3", null, "开发工具"), h("div", { className: "settings-account-id" }, h("span", null, "Homeserver"), h("code", null, client.getHomeserverUrl?.() || "未知")), h("div", { className: "settings-account-id" }, h("span", null, "设备 ID"), h("code", null, client.getDeviceId?.() || "未知")), h("div", { className: "settings-account-id" }, h("span", null, "Matrix SDK"), h("code", null, "matrix-js-sdk 42.3.0"))) : h("div", { className: "settings-panel-content" }, h("h3", null, "关于"), h("p", null, "Orbit 是基于 Matrix 的企业级聊天工作台。"), h("div", { className: "settings-about-version" }, "Orbit Web · Matrix Client-Server API · E2EE Rust Crypto"));
  return h("div", { className: "modal-backdrop", onMouseDown: e => e.target === e.currentTarget && onClose() }, h("div", { className: "modal-card settings-card" }, h("div", { className: "modal-head settings-card-head" }, h("div", null, h("div", { className: "modal-title" }, "我的设置"), h("div", { className: "modal-copy" }, "按分类管理账户、通知和设备安全。")), h(UiButton, { className: "icon-button", type: "text", onClick: onClose, "aria-label": "关闭" }, "×")), h("div", { className: "settings-layout" }, h("nav", { className: "settings-sidebar", "aria-label": "设置分类" }, nav.map(item => h("button", { type: "button", key: item.id, className: `settings-nav-item ${active === item.id ? "active" : ""}`, onClick: () => setActive(item.id) }, h("span", null, item.label), h("small", null, item.hint)))), h("section", { className: "settings-panel" }, panel))));
}

createRoot(document.getElementById("root")).render(h(App));
