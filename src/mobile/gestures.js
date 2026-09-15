import { isOrbitMobile } from "./detect.js?v=315";

export function longPressHandlers(callback, options = {}) {
  const delay = options.delay ?? 430;
  const threshold = options.moveThreshold ?? 12;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  const clear = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    pointerId = null;
  };
  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target?.closest?.("button, a, input, textarea, .message-actions, .reaction-row")) return;
      startX = event.clientX;
      startY = event.clientY;
      pointerId = event.pointerId;
      timer = window.setTimeout(() => {
        timer = 0;
        try { navigator.vibrate?.(10); } catch {}
        callback({ x: startX, y: startY, event });
      }, delay);
    },
    onPointerMove(event) {
      if (pointerId !== event.pointerId || !timer) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > threshold) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu(event) {
      event.preventDefault();
      if (!isOrbitMobile()) callback({ x: event.clientX, y: event.clientY, event });
    },
  };
}

function applyMessageSwipe(el, dx) {
  if (!el) return 0;
  const raw = Math.min(0, dx);
  const limited = raw < -76 ? -76 + (raw + 76) * 0.2 : raw;
  const x = Math.max(-92, limited);
  el.style.setProperty("--orbit-msg-x", `${x}px`);
  el.classList.toggle("is-swiping-select", x < -8);
  el.classList.toggle("is-swiping-left", x < -8);
  el.classList.remove("is-swiping-right");
  return x;
}

function clearMessageSwipe(el, animate) {
  if (!el) return;
  if (animate) el.classList.add("is-swiping-snap");
  el.style.setProperty("--orbit-msg-x", "0px");
  el.classList.remove("is-swiping-select", "is-swiping-right", "is-swiping-left");
  if (animate) window.setTimeout(() => el.classList.remove("is-swiping-snap"), 240);
}

export function mobileMessageGestures({ onTap, onLongPress, onSwipeSelect, onSwipeLeft } = {}) {
  const delay = 430;
  const tapSlop = 12;
  const swipeThreshold = 56;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let pointerId = null;
  let longFired = false;
  let row = null;
  let axis = null;
  let swiping = false;
  let bound = null;
  const selectHandler = onSwipeSelect || onSwipeLeft;
  const clearTimer = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
  };
  const unbind = () => {
    if (!bound) return;
    window.removeEventListener("pointermove", bound.onMove);
    window.removeEventListener("pointerup", bound.onUp);
    window.removeEventListener("pointercancel", bound.onUp);
    bound = null;
  };
  const reset = () => {
    clearTimer();
    unbind();
    pointerId = null;
    longFired = false;
    axis = null;
    swiping = false;
    row = null;
  };
  const finish = event => {
    if (pointerId == null) return;
    const dx = lastX - startX;
    const dy = lastY - startY;
    const fired = longFired;
    const didSwipe = swiping;
    const lockedAxis = axis;
    const target = row;
    reset();
    if (fired) {
      clearMessageSwipe(target, false);
      return;
    }
    if (didSwipe) {
      if (dx <= -swipeThreshold && Math.abs(dx) > Math.abs(dy) * 1.2) {
        try { navigator.vibrate?.(8); } catch {}
        if (target) target.classList.add("is-swiping-commit");
        window.setTimeout(() => {
          clearMessageSwipe(target, false);
          target?.classList.remove("is-swiping-commit");
        }, 180);
        selectHandler?.({ event, dx });
        return;
      }
      clearMessageSwipe(target, true);
      return;
    }
    if (lockedAxis === "h") return;
    if (Math.hypot(dx, dy) <= tapSlop) onTap?.({ event });
  };
  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target?.closest?.("button, a, input, textarea, .message-actions, .reaction-row, .ant-btn, .message-swipe-hint")) return;
      unbind();
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
      pointerId = event.pointerId;
      longFired = false;
      axis = null;
      swiping = false;
      row = event.currentTarget;
      row?.classList.remove("is-swiping-snap");
      timer = window.setTimeout(() => {
        timer = 0;
        longFired = true;
        try { navigator.vibrate?.(10); } catch {}
        onLongPress?.({ x: startX, y: startY, event });
      }, delay);
      const onMove = moveEvent => {
        if (pointerId !== moveEvent.pointerId) return;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (longFired) return;
        const dx = lastX - startX;
        const dy = lastY - startY;
        if (!axis) {
          if (Math.hypot(dx, dy) < tapSlop) return;
          axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? "h" : "v";
          if (axis === "h") clearTimer();
          else clearTimer();
        }
        if (axis !== "h") return;
        const selecting = row?.classList.contains("message-selecting");
        if (!selecting && dx < -8) {
          if (!swiping) {
            swiping = true;
            try { row?.setPointerCapture?.(moveEvent.pointerId); } catch {}
          }
          applyMessageSwipe(row, dx);
        } else if (swiping) applyMessageSwipe(row, dx);
      };
      const onUp = upEvent => {
        if (pointerId !== upEvent.pointerId) return;
        finish(upEvent);
      };
      bound = { onMove, onUp };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    onContextMenu(event) {
      event.preventDefault();
    },
  };
}

export function installHorizontalDragScroll(node) {
  if (!node) return () => {};
  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let moved = false;
  const onDown = event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startScroll = node.scrollLeft;
    moved = false;
  };
  const onMove = event => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    if (!moved && Math.abs(dx) < 6) return;
    moved = true;
    node.scrollLeft = startScroll - dx;
  };
  const onUp = event => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    pointerId = null;
    if (moved) node.dataset.orbitSkipClick = "1";
  };
  const onClick = event => {
    if (node.dataset.orbitSkipClick !== "1") return;
    event.preventDefault();
    event.stopPropagation();
    delete node.dataset.orbitSkipClick;
  };
  node.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });
  node.addEventListener("click", onClick, true);
  return () => {
    node.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    node.removeEventListener("click", onClick, true);
  };
}
