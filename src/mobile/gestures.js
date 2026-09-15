import { isOrbitMobile } from "./detect.js";

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

export function mobileMessageGestures({ onTap, onLongPress, onSwipeLeft } = {}) {
  const delay = 430;
  const tapSlop = 12;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let pointerId = null;
  let longFired = false;
  const clearTimer = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
  };
  const reset = () => {
    clearTimer();
    pointerId = null;
    longFired = false;
  };
  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target?.closest?.("button, a, input, textarea, .message-actions, .reaction-row, .ant-btn")) return;
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
      pointerId = event.pointerId;
      longFired = false;
      timer = window.setTimeout(() => {
        timer = 0;
        longFired = true;
        try { navigator.vibrate?.(10); } catch {}
        onLongPress?.({ x: startX, y: startY, event });
      }, delay);
    },
    onPointerMove(event) {
      if (pointerId !== event.pointerId) return;
      lastX = event.clientX;
      lastY = event.clientY;
      if (timer && Math.hypot(lastX - startX, lastY - startY) > tapSlop) clearTimer();
    },
    onPointerUp(event) {
      if (pointerId !== event.pointerId) return;
      const dx = lastX - startX;
      const dy = lastY - startY;
      const fired = longFired;
      reset();
      if (fired) return;
      if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        try { navigator.vibrate?.(8); } catch {}
        onSwipeLeft?.({ event });
        return;
      }
      if (Math.hypot(dx, dy) <= tapSlop) onTap?.({ event });
    },
    onPointerCancel: reset,
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

