/**
 * Hosted Element Call widget driver for MatrixRTC / Element X compatibility.
 * Legacy 1:1 m.call.* remains in app.js as a fallback for older clients.
 */
import widgetApiModule from "https://esm.sh/matrix-widget-api@1.19.0?bundle";
const {
  WidgetDriver,
  ClientWidgetApi,
  Widget,
  OpenIDRequestState,
} = widgetApiModule?.ClientWidgetApi ? widgetApiModule : (widgetApiModule?.default || widgetApiModule);

export const ELEMENT_CALL_DEFAULT_URL = "https://call.element.io/room";
export const RTC_NOTIFICATION = "org.matrix.msc4075.rtc.notification";
export const RTC_NOTIFICATION_STABLE = "m.rtc.notification";
export const CALL_NOTIFY = "org.matrix.msc4075.call.notify";
export const CALL_NOTIFY_STABLE = "m.call.notify";
export const RTC_INVITE = "org.matrix.msc4075.rtc.invite";
export const RTC_INVITE_STABLE = "m.rtc.invite";
export const RTC_DECLINE = "org.matrix.msc4310.rtc.decline";
export const RTC_DECLINE_STABLE = "m.rtc.decline";
export const RTC_DECLINE_MSC4075 = "org.matrix.msc4075.rtc.decline";
export const ELEMENT_WIDGET_ACTIONS = {
  join: "io.element.join",
  hangup: "im.vector.hangup",
  close: "io.element.close",
  mute: "io.element.device_mute",
};

const CLIENT_EVENT = "event";
const EVENT_DECRYPTED = "Event.decrypted";
const ROOM_STATE_EVENTS = "RoomState.events";
const TO_DEVICE_EVENT = "toDeviceEvent";
const TURN_SERVERS = "TurnServers";
const RTC_LIFETIME_CAP_MS = 90000;
const HOST_ID = "orbit-element-call-host";

function asEventType(event) {
  return event?.getType?.() || event?.type || "";
}

function asContent(event) {
  return event?.getEffectiveEvent?.()?.content || event?.getContent?.() || event?.content || {};
}

function asEventId(event) {
  return event?.getId?.() || event?.event_id || "";
}

function asRoomId(event) {
  return event?.getRoomId?.() || event?.room_id || "";
}

function asSender(event) {
  return event?.getSender?.() || event?.sender || "";
}

function asTimestamp(event) {
  return Number(event?.getTs?.() || event?.origin_server_ts || Date.now());
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function ensureCallRoomPath(raw) {
  const text = String(raw || "").trim();
  if (!text) return ELEMENT_CALL_DEFAULT_URL;
  try {
    const url = new URL(text);
    if (/\/room\/?$/.test(url.pathname) || /index\.html$/i.test(url.pathname)) return trimSlash(url.toString());
    return trimSlash(new URL("./room", `${trimSlash(url.toString())}/`).toString());
  } catch {
    return ELEMENT_CALL_DEFAULT_URL;
  }
}

function pickWellKnownUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.url || value.widget_url || value.call_url || "";
}

export function getElementCallIntent({ isDm = false, video = false, joining = false } = {}) {
  if (isDm && joining) return video ? "join_existing_dm" : "join_existing_dm_voice";
  if (isDm) return video ? "start_call_dm" : "start_call_dm_voice";
  if (joining) return video ? "join_existing" : "join_existing_voice";
  return video ? "start_call" : "start_call_voice";
}

export function hasActiveMatrixRtcSession(client, roomOrId) {
  try {
    const room = typeof roomOrId === "string" ? client?.getRoom?.(roomOrId) : roomOrId;
    if (!room) return false;
    const session = client?.matrixRTC?.getRoomSession?.(room);
    return Boolean(session?.memberships?.length);
  } catch {
    return false;
  }
}

const RTC_NOTIFICATION_TYPES = new Set([
  RTC_NOTIFICATION,
  RTC_NOTIFICATION_STABLE,
  CALL_NOTIFY,
  CALL_NOTIFY_STABLE,
  RTC_INVITE,
  RTC_INVITE_STABLE,
]);
const RTC_INVITE_TYPES = new Set([RTC_INVITE, RTC_INVITE_STABLE]);
const RTC_DECLINE_TYPES = new Set([RTC_DECLINE, RTC_DECLINE_STABLE, RTC_DECLINE_MSC4075]);
const RTC_TRANSPORT_PREFIXES = [
  "/_matrix/client/v1",
  "/_matrix/client/unstable/org.matrix.msc4143",
];
const LIVEKIT_PREFIXES = [
  "/_matrix/client/v1",
  "/_matrix/client/unstable/io.element.msc4195",
  "/_matrix/client/unstable/org.matrix.msc4195",
];

function isAnyRoomToken(value) {
  return value === "*" || typeof value === "symbol";
}

function resolveWidgetRoomIds(client, currentRoomId, roomIds) {
  if (roomIds == null) return currentRoomId ? [currentRoomId] : [];
  const list = Array.from(roomIds);
  if (list.some(isAnyRoomToken)) {
    const rooms = client?.getVisibleRooms?.() || client?.getRooms?.() || [];
    return rooms.map(room => room.roomId).filter(Boolean);
  }
  return list.filter(item => typeof item === "string" && item);
}

function asRtcTransports(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.rtc_transports)) return value.rtc_transports.filter(Boolean);
  return [];
}

async function authedRtcRequest(client, method, path, body, prefixes) {
  let lastError = null;
  for (const prefix of prefixes) {
    try {
      return await client.http.authedRequest(method, path, undefined, body, { prefix });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("homeserver 未提供 MatrixRTC 接口");
}

export function parseRtcNotification(event, { now = Date.now() } = {}) {
  if (!event) return null;
  if (event.isRedacted?.()) return null;
  if (event.isBeingDecrypted?.()) return null;
  if (event.isDecryptionFailure?.()) return null;
  if (event.isEncrypted?.() && !event.getClearContent?.() && !event.getEffectiveEvent?.()?.content) return null;
  const type = asEventType(event);
  if (!RTC_NOTIFICATION_TYPES.has(type)) return null;
  const content = asContent(event);
  const notificationType = content.notification_type || content.notify_type || "";
  const isRing = RTC_INVITE_TYPES.has(type) || notificationType === "ring";
  const intent = String(content["m.call.intent"] || content.call_intent || "").toLowerCase();
  const kind = intent === "audio" || intent === "voice" ? "voice" : "video";
  const senderTs = Number(content.sender_ts || asTimestamp(event) || now);
  const rawLifetime = Number(content.lifetime || RTC_LIFETIME_CAP_MS);
  const lifetime = Math.min(Math.max(rawLifetime, 0) || RTC_LIFETIME_CAP_MS, RTC_LIFETIME_CAP_MS);
  const expiresAt = senderTs + lifetime;
  return {
    type,
    isRing,
    kind,
    roomId: asRoomId(event),
    eventId: asEventId(event),
    sender: asSender(event),
    notificationType,
    senderTs,
    lifetime,
    expiresAt,
    expired: expiresAt <= now,
  };
}

export function parseRtcDecline(event) {
  if (!event || !RTC_DECLINE_TYPES.has(asEventType(event))) return null;
  if (event.isBeingDecrypted?.() || event.isDecryptionFailure?.()) return null;
  const content = asContent(event);
  const relates = content["m.relates_to"] || content.m_relates_to || {};
  return {
    roomId: asRoomId(event),
    eventId: asEventId(event),
    sender: asSender(event),
    notificationEventId: relates.event_id || relates.eventId || "",
  };
}

export async function sendRtcDecline(client, roomId, notificationEventId) {
  if (!client || !roomId || !notificationEventId) return;
  const content = {
    "m.relates_to": { rel_type: "m.reference", event_id: notificationEventId },
  };
  await Promise.allSettled([
    RTC_DECLINE,
    RTC_DECLINE_STABLE,
    RTC_DECLINE_MSC4075,
  ].map(type => client.sendEvent(roomId, type, content)));
}

export async function resolveElementCallBaseUrl(client) {
  const wellKnown = client?.getClientWellKnown?.() || {};
  const fromClient = pickWellKnownUrl(wellKnown["io.element.element_call"])
    || pickWellKnownUrl(wellKnown["im.vector.riot.e_call"])
    || pickWellKnownUrl(wellKnown["im.vector.riot.e_call"]);
  if (fromClient) return ensureCallRoomPath(fromClient);
  const homeserver = trimSlash(client?.getHomeserverUrl?.() || "");
  const domain = client?.getDomain?.() || (() => {
    try { return new URL(homeserver).hostname; } catch { return ""; }
  })();
  if (domain) {
    try {
      const response = await fetch(`https://${domain}/.well-known/element/element.json`);
      if (response.ok) {
        const json = await response.json();
        const widgetUrl = json?.call?.widget_url || json?.element_call?.widget_url || json?.element_call?.url;
        if (widgetUrl) return ensureCallRoomPath(widgetUrl);
      }
    } catch {}
  }
  return ELEMENT_CALL_DEFAULT_URL;
}

function getElementCallHost(kind = "voice") {
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
}

function effectiveEvent(event) {
  return event?.getEffectiveEvent?.() || event?.event || event;
}

class OrbitCallWidgetDriver extends WidgetDriver {
  constructor(client, roomId) {
    super();
    this.client = client;
    this.roomId = roomId;
    this.turnHandler = null;
    this.turnWaiters = [];
  }

  dispose() {
    if (this.turnHandler) {
      this.client?.off?.(TURN_SERVERS, this.turnHandler);
      this.turnHandler = null;
    }
    this.turnWaiters.splice(0).forEach(resolve => resolve());
  }

  async validateCapabilities(requested) {
    return new Set(requested || []);
  }

  async sendEvent(eventType, content, stateKey = null, targetRoomId = null) {
    const roomId = targetRoomId || this.roomId;
    let result;
    if (typeof stateKey === "string") result = await this.client.sendStateEvent(roomId, eventType, content, stateKey);
    else if (eventType === "m.room.redaction") result = await this.client.redactEvent(roomId, content?.redacts);
    else result = await this.client.sendEvent(roomId, eventType, content);
    return { roomId, eventId: result.event_id };
  }

  async sendStickyEvent(stickyDurationMs, eventType, content, targetRoomId = null) {
    const roomId = targetRoomId || this.roomId;
    if (typeof this.client._unstable_sendStickyEvent !== "function") throw new Error("当前 homeserver 不支持 sticky events");
    const result = await this.client._unstable_sendStickyEvent(roomId, stickyDurationMs, null, eventType, content);
    return { roomId, eventId: result.event_id };
  }

  async sendDelayedEvent(delay, eventType, content, stateKey = null, targetRoomId = null) {
    const roomId = targetRoomId || this.roomId;
    const delayOpts = { delay };
    let result;
    if (stateKey !== null && stateKey !== undefined) {
      result = await this.client._unstable_sendDelayedStateEvent(roomId, delayOpts, eventType, content, stateKey);
    } else {
      result = await this.client._unstable_sendDelayedEvent(roomId, delayOpts, null, eventType, content);
    }
    return { roomId, delayId: result.delay_id };
  }

  async sendDelayedStickyEvent(delay, stickyDurationMs, eventType, content, targetRoomId = null) {
    const roomId = targetRoomId || this.roomId;
    if (typeof this.client._unstable_sendStickyDelayedEvent !== "function") throw new Error("当前 homeserver 不支持 delayed sticky events");
    const result = await this.client._unstable_sendStickyDelayedEvent(roomId, stickyDurationMs, { delay }, null, eventType, content);
    return { roomId, delayId: result.delay_id };
  }

  async cancelScheduledDelayedEvent(delayId) {
    await this.client._unstable_cancelScheduledDelayedEvent(delayId);
  }

  async restartScheduledDelayedEvent(delayId) {
    await this.client._unstable_restartScheduledDelayedEvent(delayId);
  }

  async sendScheduledDelayedEvent(delayId) {
    await this.client._unstable_sendScheduledDelayedEvent(delayId);
  }

  async sendToDevice(eventType, encrypted, contentMap) {
    if (encrypted) {
      const crypto = this.client.getCrypto?.();
      if (!crypto) throw new Error("E2EE not enabled");
      const inverted = {};
      for (const userId of Object.keys(contentMap || {})) {
        const userMap = contentMap[userId] || {};
        for (const deviceId of Object.keys(userMap)) {
          const encoded = JSON.stringify(userMap[deviceId]);
          inverted[encoded] = inverted[encoded] || [];
          inverted[encoded].push({ userId, deviceId });
        }
      }
      await Promise.all(Object.entries(inverted).map(async ([encoded, recipients]) => {
        const batch = await crypto.encryptToDeviceMessages(eventType, recipients, JSON.parse(encoded));
        await this.client.queueToDevice(batch);
      }));
      return;
    }
    await this.client.queueToDevice({
      eventType,
      batch: Object.entries(contentMap || {}).flatMap(([userId, userMap]) => Object.entries(userMap || {}).map(([deviceId, content]) => ({
        userId,
        deviceId,
        payload: content,
      }))),
    });
  }

  async readRoomTimeline(roomId, eventType, msgtype, stateKey, limit, since) {
    const safeLimit = limit > 0 ? Math.min(limit, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const room = this.client.getRoom(roomId);
    if (!room) return [];
    const results = [];
    const events = room.getLiveTimeline?.().getEvents?.() || [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (results.length >= safeLimit) break;
      if (since !== undefined && event.getId?.() === since) break;
      if (
        event.getType?.() === eventType
        && !event.isState?.()
        && (eventType !== "m.room.message" || !msgtype || msgtype === event.getContent?.()?.msgtype)
        && (event.getStateKey?.() === undefined || stateKey === undefined || event.getStateKey?.() === stateKey)
      ) results.push(event);
    }
    return results.map(event => event.getEffectiveEvent?.() || event.event);
  }

  async readRoomState(roomId, eventType, stateKey) {
    const room = this.client.getRoom(roomId);
    if (!room) return [];
    const state = room.currentState || room.getLiveTimeline?.().getState?.("f");
    if (!state) return [];
    if (stateKey === undefined) {
      return (state.getStateEvents?.(eventType) || []).map(event => event.getEffectiveEvent?.() || event.event);
    }
    const event = state.getStateEvents?.(eventType, stateKey);
    return event ? [event.getEffectiveEvent?.() || event.event] : [];
  }

  askOpenID(observer) {
    this.client.getOpenIdToken().then(token => {
      observer.update({ state: OpenIDRequestState.Allowed, token });
    }).catch(() => {
      observer.update({ state: OpenIDRequestState.Blocked });
    });
  }

  async readEventRelations(eventId, roomId, relationType, eventType, from, to, limit, direction) {
    const targetRoomId = roomId || this.roomId;
    if (!targetRoomId) throw new Error("Error while reading the current room");
    const { events, nextBatch, prevBatch } = await this.client.relations(
      targetRoomId,
      eventId,
      relationType ?? null,
      eventType ?? null,
      { from, to, limit, dir: direction }
    );
    return {
      chunk: (events || []).map(event => event.getEffectiveEvent?.() || event.event),
      nextBatch: nextBatch ?? undefined,
      prevBatch: prevBatch ?? undefined,
    };
  }

  async searchUserDirectory(searchTerm, limit) {
    const { limited, results } = await this.client.searchUserDirectory({ term: searchTerm, limit });
    return {
      limited,
      results: (results || []).map(item => ({
        userId: item.user_id,
        displayName: item.display_name,
        avatarUrl: item.avatar_url,
      })),
    };
  }

  async getMediaConfig() {
    if (typeof this.client.getMediaConfig === "function") return this.client.getMediaConfig();
    return {};
  }

  async uploadFile(file) {
    const uploaded = await this.client.uploadContent(file);
    return { contentUri: uploaded.content_uri };
  }

  async downloadFile(contentUri) {
    const httpUrl = this.client.mxcUrlToHttp?.(contentUri, undefined, undefined, undefined, false, true, true);
    if (!httpUrl) throw new Error("Call widget failed to download file! No http url!");
    const token = this.client.getAccessToken?.();
    const response = await fetch(httpUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (!response.ok) throw new Error(`Call widget failed to download file: ${response.status}`);
    return { file: await response.blob() };
  }

  getKnownRooms() {
    const rooms = this.client.getVisibleRooms?.() || this.client.getRooms?.() || [];
    return rooms.map(room => room.roomId);
  }

  processError(error) {
    return error?.asWidgetApiErrorData ? { matrix_api_error: error.asWidgetApiErrorData() } : undefined;
  }

  async *getTurnServers() {
    const map = servers => {
      const first = servers?.[0];
      if (!first) return null;
      const uris = first.uris || first.urls || [];
      if (!uris.length) return null;
      return { uris, username: first.username || "", password: first.credential || first.password || "" };
    };
    let current = map(this.client.getTurnServers?.() || []);
    if (!current) {
      try { await this.client.checkTurnServers?.(); } catch {}
      current = map(this.client.getTurnServers?.() || []);
    }
    if (current) yield current;
    const queue = [];
    this.turnHandler = servers => {
      const next = map(servers);
      if (!next) return;
      queue.push(next);
      this.turnWaiters.splice(0).forEach(resolve => resolve());
    };
    this.client.on?.(TURN_SERVERS, this.turnHandler);
    try {
      while (true) {
        if (!queue.length) await new Promise(resolve => this.turnWaiters.push(resolve));
        if (queue.length) yield queue.shift();
        else return;
      }
    } finally {
      if (this.turnHandler) this.client.off?.(TURN_SERVERS, this.turnHandler);
      this.turnHandler = null;
    }
  }

  async getRtcTransports() {
    const collected = [];
    try {
      if (typeof this.client._unstable_getRTCTransports === "function") {
        collected.push(...asRtcTransports(await this.client._unstable_getRTCTransports()));
      }
    } catch {}
    if (!collected.length) {
      try {
        collected.push(...asRtcTransports(await authedRtcRequest(this.client, "GET", "/rtc/transports", undefined, RTC_TRANSPORT_PREFIXES)));
      } catch {}
    }
    if (!collected.length) {
      const wellKnown = this.client.getClientWellKnown?.() || {};
      collected.push(...asRtcTransports(wellKnown["org.matrix.msc4143.rtc_foci"] || wellKnown["org.matrix.msc4143.rtc_transports"] || []));
    }
    return { rtc_transports: collected };
  }

  async getRtcLivekitToken(data) {
    if (typeof this.client._unstable_getLivekitToken === "function") {
      try { return await this.client._unstable_getLivekitToken(data); } catch {}
    }
    return authedRtcRequest(this.client, "POST", "/rtc/livekit/get_token", data, LIVEKIT_PREFIXES);
  }

  async delegateRtcLivekitDelayedLeave(data) {
    if (typeof this.client._unstable_delegateDelayedLeave === "function") {
      try { return await this.client._unstable_delegateDelayedLeave(data); } catch {}
    }
    return authedRtcRequest(this.client, "POST", "/rtc/livekit/delegate_delayed_leave", data, LIVEKIT_PREFIXES);
  }

  async readStickyEvents(roomId) {
    const room = this.client.getRoom(roomId || this.roomId);
    if (!room || typeof room._unstable_getStickyEvents !== "function") return [];
    return [...(room._unstable_getStickyEvents() || [])]
      .map(event => event.getEffectiveEvent?.() || event.event)
      .filter(Boolean);
  }

  async readRoomEvents(eventType, msgtype, limit, roomIds, since) {
    const rooms = resolveWidgetRoomIds(this.client, this.roomId, roomIds);
    const events = [];
    for (const roomId of rooms) {
      events.push(...await this.readRoomTimeline(roomId, eventType, msgtype, undefined, limit, since));
    }
    return events;
  }

  async readStateEvents(eventType, stateKey, limit, roomIds) {
    const rooms = resolveWidgetRoomIds(this.client, this.roomId, roomIds);
    const events = [];
    for (const roomId of rooms) {
      events.push(...await this.readRoomState(roomId, eventType, stateKey));
    }
    if (limit > 0) return events.slice(0, limit);
    return events;
  }

  async navigate(uri) {
    return undefined;
  }
}

function buildElementCallWidgetUrl({
  widgetUrl,
  widgetId,
  parentUrl,
  homeserverUrl,
  roomId,
  userId,
  deviceId,
  displayName,
  clientId,
  intent,
  encrypted,
  starting,
  isDm,
}) {
  const url = new URL(widgetUrl);
  const params = new URLSearchParams({
    widgetId,
    parentUrl,
    baseUrl: homeserverUrl,
    roomId,
    userId,
    deviceId,
    displayName: displayName || userId,
    clientId: clientId || "io.element.orbit",
    intent,
    skipLobby: "true",
    confineToRoom: "true",
    appPrompt: "false",
    perParticipantE2EE: String(Boolean(encrypted)),
    lang: "zh-CN",
    theme: "light",
    header: "none",
    controlledAudioDevices: "false",
    allowIceFallback: "true",
  });
  if (starting) {
    params.set("sendNotificationType", isDm ? "ring" : "notification");
    if (isDm) {
      params.set("waitForCallPickup", "true");
      params.set("autoLeave", "true");
    }
  }
  url.hash = `?${params.toString()}`;
  return url.toString();
}

function createCallIframe(src) {
  const iframe = document.createElement("iframe");
  iframe.title = "Element Call";
  iframe.allowFullscreen = true;
  iframe.sandbox = "allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads";
  iframe.allow = "microphone; camera; display-capture; autoplay; clipboard-write; fullscreen;";
  iframe.src = src;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  return iframe;
}

function listenWidgetAction(api, action, handler) {
  const type = `action:${action}`;
  const wrapped = event => {
    try { event.preventDefault?.(); } catch {}
    Promise.resolve(handler(event)).then(reply => {
      api.transport.reply(event.detail, reply && typeof reply === "object" ? reply : {});
    }).catch(() => {
      try { api.transport.reply(event.detail, {}); } catch {}
    });
  };
  api.on(type, wrapped);
  return () => api.off(type, wrapped);
}

export async function createElementCallEmbed({
  client,
  room,
  orbitRoom,
  kind = "voice",
  joining = false,
  isDm = false,
  notify = true,
  homeserverUrl,
  onHangup,
  onJoin,
  onMute,
} = {}) {
  const matrixRoom = room || client?.getRoom?.(orbitRoom?.id);
  if (!client || !matrixRoom) throw new Error("无法启动 Element Call：房间不可用");
  const userId = client.getUserId?.();
  const deviceId = client.getDeviceId?.();
  if (!userId || !deviceId) throw new Error("无法启动 Element Call：缺少用户或设备信息");
  const widgetId = `orbit-element-call-${Date.now()}`;
  const widgetUrl = await resolveElementCallBaseUrl(client);
  const intent = getElementCallIntent({ isDm, video: kind === "video", joining });
  const starting = Boolean(notify) && !joining;
  const encrypted = Boolean(matrixRoom.hasEncryptionStateEvent?.());
  const href = buildElementCallWidgetUrl({
    widgetUrl,
    widgetId,
    parentUrl: window.location.href,
    homeserverUrl: trimSlash(homeserverUrl || ""),
    roomId: matrixRoom.roomId,
    userId,
    deviceId,
    displayName: client.getUser?.(userId)?.displayName || userId,
    clientId: "io.element.orbit",
    intent,
    encrypted,
    starting,
    isDm,
  });
  const widget = new Widget({
    id: widgetId,
    creatorUserId: userId,
    name: "Call",
    type: "m.call",
    url: href,
    waitForIframeLoad: false,
    data: {},
  });
  const host = getElementCallHost(kind);
  host.classList.add("is-active");
  const iframe = createCallIframe(widget.getCompleteUrl({ currentUserId: userId }) || href);
  host.append(iframe);
  const driver = new OrbitCallWidgetDriver(client, matrixRoom.roomId);
  const api = new ClientWidgetApi(widget, iframe, driver);
  api.setViewedRoomId(matrixRoom.roomId);
  const onReady = () => { api.updateVisibility(true).catch(() => {}); };
  api.on("ready", onReady);

  const readUpToMap = {};
  const eventsToFeed = new WeakSet();
  (client.getRooms?.() || []).forEach(item => {
    const events = item.getLiveTimeline?.()?.getEvents?.() || [];
    const last = events[events.length - 1];
    if (last?.getId?.()) readUpToMap[item.roomId] = last.getId();
  });

  const relatesToUnknown = event => {
    if (!event.relationEventId || event.replyEventId) return false;
    const sourceRoom = client.getRoom(event.getRoomId?.());
    return !sourceRoom || !sourceRoom.findEventById?.(event.relationEventId);
  };
  const isFromInvite = event => client.getRoom(event.getRoomId?.())?.getMyMembership?.() === "invite";
  const advanceReadUpToMarker = event => {
    const eventId = event.getId?.();
    const roomId = event.getRoomId?.();
    const sourceRoom = client.getRoom(roomId);
    if (!eventId || !roomId || !sourceRoom) return false;
    const upToEventId = readUpToMap[roomId];
    if (!upToEventId) {
      readUpToMap[roomId] = eventId;
      return true;
    }
    if (upToEventId === eventId) return false;
    const events = [...(sourceRoom.getLiveTimeline?.().getEvents?.() || [])].reverse().slice(0, 100);
    const marker = events.find(item => item.getId?.() === upToEventId || item.getId?.() === eventId);
    if (marker?.getId?.() === upToEventId) return false;
    if (marker?.getId?.() === eventId) {
      readUpToMap[roomId] = eventId;
      return true;
    }
    return false;
  };
  const feedEvent = event => {
    if (
      eventsToFeed.delete(event)
      || relatesToUnknown(event)
      || isFromInvite(event)
      || advanceReadUpToMarker(event)
    ) {
      if (event.isBeingDecrypted?.() || event.isDecryptionFailure?.()) {
        eventsToFeed.add(event);
        return;
      }
      api.feedEvent(effectiveEvent(event)).catch(error => console.error("Error sending event to widget: ", error));
    }
  };
  const onClientEvent = event => {
    client.decryptEventIfNeeded?.(event);
    feedEvent(event);
  };
  const onEventDecrypted = event => feedEvent(event);
  const onStateUpdate = event => {
    api.feedStateUpdate(effectiveEvent(event)).catch(error => console.error("Error sending state update to widget: ", error));
  };
  const onToDeviceEvent = async event => {
    await client.decryptEventIfNeeded?.(event);
    if (event.isDecryptionFailure?.()) return;
    await api.feedToDevice(effectiveEvent(event), event.isEncrypted?.());
  };

  client.on(CLIENT_EVENT, onClientEvent);
  client.on(EVENT_DECRYPTED, onEventDecrypted);
  client.on(ROOM_STATE_EVENTS, onStateUpdate);
  client.on(TO_DEVICE_EVENT, onToDeviceEvent);

  const actionOff = [
    listenWidgetAction(api, ELEMENT_WIDGET_ACTIONS.join, () => { onJoin?.(); }),
    listenWidgetAction(api, ELEMENT_WIDGET_ACTIONS.hangup, () => { onHangup?.(); }),
    listenWidgetAction(api, ELEMENT_WIDGET_ACTIONS.close, () => { onHangup?.(); }),
    listenWidgetAction(api, ELEMENT_WIDGET_ACTIONS.mute, event => {
      const data = event?.detail?.data || {};
      onMute?.(data);
      return data;
    }),
  ];

  const embed = {
    api,
    iframe,
    driver,
    widget,
    host,
    roomId: matrixRoom.roomId,
    disposed: false,
    dispose() {
      disposeElementCallEmbed(embed);
    },
    _cleanup() {
      actionOff.forEach(stop => { try { stop(); } catch {} });
      try { api.off("ready", onReady); } catch {}
      client.off(CLIENT_EVENT, onClientEvent);
      client.off(EVENT_DECRYPTED, onEventDecrypted);
      client.off(ROOM_STATE_EVENTS, onStateUpdate);
      client.off(TO_DEVICE_EVENT, onToDeviceEvent);
      driver.dispose();
    },
  };
  return embed;
}

export function disposeElementCallEmbed(embed) {
  if (!embed || embed.disposed) return;
  embed.disposed = true;
  try { embed._cleanup?.(); } catch {}
  try { embed.api?.stop?.(); } catch {}
  try { embed.iframe?.remove?.(); } catch {}
  hideElementCallHostIfEmpty();
}

export async function setElementCallMute(embed, { muted, videoMuted } = {}) {
  if (!embed?.api?.transport?.send) return;
  await embed.api.transport.send(ELEMENT_WIDGET_ACTIONS.mute, {
    audio_enabled: !muted,
    video_enabled: !videoMuted,
  });
}

export async function hangupElementCall(embed) {
  if (!embed?.api?.transport?.send) return;
  try { await embed.api.transport.send(ELEMENT_WIDGET_ACTIONS.hangup, {}); } catch {}
}
