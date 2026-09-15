import { isOrbitMobile } from "./detect.js?v=315";

function applyInsets() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keyboard = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    : 0;
  root.style.setProperty("--orbit-keyboard", `${keyboard}px`);
  const composer = document.querySelector(".composer-wrap");
  root.style.setProperty("--orbit-composer", composer ? `${Math.round(composer.getBoundingClientRect().height)}px` : "0px");
}

export function installViewportInsets() {
  applyInsets();
  window.visualViewport?.addEventListener("resize", applyInsets);
  window.visualViewport?.addEventListener("scroll", applyInsets);
  window.addEventListener("resize", applyInsets);
  window.addEventListener("orientationchange", applyInsets);
  window.addEventListener("focusin", applyInsets);
  window.addEventListener("focusout", applyInsets);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(applyInsets);
    const watch = () => {
      const composer = document.querySelector(".composer-wrap");
      if (composer) observer.observe(composer);
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.documentElement, { childList: true, subtree: true });
  }
}

export function seedOrbitHistory(view = "rooms") {
  try {
    const current = history.state && typeof history.state === "object" ? history.state : null;
    if (!current?.orbit) {
      history.replaceState({ orbit: true, view, root: true }, "");
      history.pushState({ orbit: true, view, root: true }, "");
      return;
    }
    if (current.root === false) {
      history.replaceState({ orbit: true, view: "rooms", root: true }, "");
      history.pushState({ orbit: true, view: "rooms", root: true }, "");
      return;
    }
    history.pushState({ orbit: true, view: current.view || view, root: true }, "");
  } catch {}
}

export function pushOrbitHistory(view, overlay = false) {
  try {
    if (!history.state?.orbit) history.replaceState({ orbit: true, view: "rooms", root: true }, "");
    history.pushState({ orbit: true, view, overlay: Boolean(overlay), root: false }, "");
  } catch {}
}

export function goOrbitBack() {
  try {
    if (history.state?.orbit && history.state.root === false) {
      history.back();
      return true;
    }
  } catch {}
  window.dispatchEvent(new CustomEvent("orbit:mobile-back"));
  return false;
}

function currentBackPanel() {
  const view = document.documentElement.dataset.orbitView;
  if (view === "details") return document.querySelector(".details-panel");
  if (view === "chat") return document.querySelector(".main-panel");
  return null;
}

function resetBackSwipe() {
  const root = document.documentElement;
  root.classList.remove("is-orbit-swiping-back", "is-orbit-swiping-back-snap", "is-orbit-swiping-back-commit");
  root.style.setProperty("--orbit-back-x", "0px");
}

function isMessageContent(target) {
  return Boolean(target?.closest?.(".message-body, .message-avatar, .message-bubble, .attachment-wrap, .formatted-message, .voice-message, .message-content-stack, .message-author"));
}

function isBlankBackTarget(target) {
  if (!target?.closest) return false;
  if (target.closest("button, a, input, textarea, select, [contenteditable='true'], .composer-wrap, .orbit-hold-talk, .orbit-voice-overlay, .orbit-sheet-backdrop, .orbit-sheet, .modal-backdrop, .call-overlay, .forward-bar, .message-context-menu, .orbit-message-menu-backdrop, .ant-btn, .emoji-popover, .plyr, .media-lightbox")) return false;
  if (isMessageContent(target)) return false;
  return Boolean(target.closest(".message-scroll, .empty-messages, .chat-header, .chat-heading, .main-panel, .details-panel, .message-row"));
}

export function installSwipeBack() {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = false;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let commitTimer = 0;
  let pointerId = null;
  let clickGuard = false;
  let axis = null;

  const canSwipe = () => {
    if (!isOrbitMobile()) return false;
    const view = document.documentElement.dataset.orbitView;
    if (view !== "chat" && view !== "details") return false;
    if (document.querySelector(".orbit-voice-overlay, .orbit-sheet-backdrop, .modal-backdrop, .call-overlay")) return false;
    return true;
  };

  const point = event => event.touches?.[0] || event.changedTouches?.[0] || event;
  const ignore = event => event.type.startsWith("touch") && "PointerEvent" in window;

  const swallowClick = event => {
    event.preventDefault();
    event.stopPropagation();
  };

  const armClickGuard = () => {
    if (clickGuard) return;
    clickGuard = true;
    document.addEventListener("click", swallowClick, true);
    window.setTimeout(() => {
      document.removeEventListener("click", swallowClick, true);
      clickGuard = false;
    }, 420);
  };

  const onStart = event => {
    if (ignore(event)) return;
    if (commitTimer) return;
    if (!canSwipe()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const p = point(event);
    if (!p) return;
    if (!isBlankBackTarget(event.target)) return;
    startX = lastX = p.clientX;
    startY = p.clientY;
    lastT = event.timeStamp || Date.now();
    velocity = 0;
    tracking = true;
    locked = false;
    axis = null;
    pointerId = event.pointerId ?? null;
  };

  const onMove = event => {
    if (ignore(event)) return;
    if (!tracking) return;
    if (pointerId != null && event.pointerId != null && event.pointerId !== pointerId) return;
    const p = point(event);
    if (!p) return;
    const dx = p.clientX - startX;
    const dy = p.clientY - startY;
    const now = event.timeStamp || Date.now();
    const dt = Math.max(1, now - lastT);
    velocity = (p.clientX - lastX) / dt;
    lastX = p.clientX;
    lastT = now;
    if (!locked) {
      if (!axis) {
        if (Math.hypot(dx, dy) < 12) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? "h" : "v";
        if (axis === "v") {
          tracking = false;
          return;
        }
      }
      if (axis === "h" && dx > 16 && currentBackPanel()) {
        locked = true;
        armClickGuard();
        document.documentElement.classList.add("is-orbit-swiping-back");
        document.documentElement.classList.remove("is-orbit-swiping-back-snap", "is-orbit-swiping-back-commit");
        try { event.target?.setPointerCapture?.(event.pointerId); } catch {}
      } else return;
    }
    event.preventDefault();
    const x = Math.max(0, dx);
    document.documentElement.style.setProperty("--orbit-back-x", `${x}px`);
  };

  const finish = commit => {
    tracking = false;
    locked = false;
    axis = null;
    pointerId = null;
    const root = document.documentElement;
    if (!commit) {
      root.classList.remove("is-orbit-swiping-back");
      root.classList.add("is-orbit-swiping-back-snap");
      root.style.setProperty("--orbit-back-x", "0px");
      window.setTimeout(resetBackSwipe, 220);
      return;
    }
    armClickGuard();
    root.classList.remove("is-orbit-swiping-back");
    root.classList.add("is-orbit-swiping-back-commit");
    root.style.setProperty("--orbit-back-x", `${window.innerWidth}px`);
    commitTimer = window.setTimeout(() => {
      commitTimer = 0;
      resetBackSwipe();
      goOrbitBack();
    }, 200);
  };

  const onEnd = event => {
    if (event && ignore(event)) return;
    if (!tracking) return;
    if (pointerId != null && event?.pointerId != null && event.pointerId !== pointerId) return;
    if (!locked) {
      tracking = false;
      pointerId = null;
      return;
    }
    const p = event ? point(event) : null;
    if (p) lastX = p.clientX;
    const x = Math.max(0, lastX - startX);
    const threshold = Math.min(96, window.innerWidth * 0.2);
    finish(x > threshold || (x > 40 && velocity > 0.28));
  };

  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", onEnd, { passive: true });
  document.addEventListener("pointerdown", onStart, true);
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  window.addEventListener("popstate", () => window.setTimeout(resetBackSwipe, 0));
  window.addEventListener("orbit:mobile-back", () => window.setTimeout(resetBackSwipe, 0));
}
