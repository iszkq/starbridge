import { applyOrbitMobileFlag, isOrbitMobile, setOrbitMobileView, useOrbitMobile } from "./detect.js?v=315";
import { longPressHandlers, mobileMessageGestures, installHorizontalDragScroll } from "./gestures.js?v=315";
import { installSwipeBack, installViewportInsets, seedOrbitHistory, pushOrbitHistory, goOrbitBack } from "./viewport.js?v=316";

export { isOrbitMobile, useOrbitMobile, setOrbitMobileView, longPressHandlers, mobileMessageGestures, installHorizontalDragScroll, seedOrbitHistory, pushOrbitHistory, goOrbitBack };

export function installOrbitMobile() {
  applyOrbitMobileFlag();
  seedOrbitHistory(document.documentElement.dataset.orbitView || "rooms");
  try { history.scrollRestoration = "manual"; } catch {}
  installViewportInsets();
  installSwipeBack();
}
