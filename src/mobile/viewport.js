import { isOrbitMobile } from "./detect.js";

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

export function installSwipeBack() {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  const onStart = event => {
    if (!isOrbitMobile()) return;
    const touch = event.touches?.[0];
    if (!touch || touch.clientX > 28) return;
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  };
  const onMove = event => {
    if (!tracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dy) > 36) {
      tracking = false;
      return;
    }
    if (dx > 76) {
      tracking = false;
      if (history.state?.orbit) history.back();
      else window.dispatchEvent(new CustomEvent("orbit:mobile-back"));
    }
  };
  const onEnd = () => { tracking = false; };
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", onEnd, { passive: true });
}
