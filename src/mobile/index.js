import { applyOrbitMobileFlag, isOrbitMobile, setOrbitMobileView, useOrbitMobile } from "./detect.js";
import { longPressHandlers, mobileMessageGestures, installHorizontalDragScroll } from "./gestures.js";
import { installSwipeBack, installViewportInsets } from "./viewport.js";

export { isOrbitMobile, useOrbitMobile, setOrbitMobileView, longPressHandlers, mobileMessageGestures, installHorizontalDragScroll };

export function pushOrbitHistory(view, overlay = false) {
  try { history.pushState({ orbit: true, view, overlay }, ""); } catch {}
}

export function installOrbitMobile() {
  applyOrbitMobileFlag();
  installViewportInsets();
  installSwipeBack();
}
