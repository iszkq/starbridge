import React, { useEffect, useState } from "https://esm.sh/react@18.3.1";

const MOBILE_QUERY = "(max-width: 880px), ((pointer: coarse) and (max-width: 1100px))";

function forcedMobileFlag() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mobile") === "1") return true;
    if (params.get("mobile") === "0") return false;
  } catch {}
  return null;
}

export function isOrbitMobile() {
  if (typeof window === "undefined") return false;
  const forced = forcedMobileFlag();
  if (forced !== null) return forced;
  return window.matchMedia?.(MOBILE_QUERY)?.matches === true;
}

export function applyOrbitMobileFlag(mobile = isOrbitMobile()) {
  const root = document.documentElement;
  if (mobile) {
    root.dataset.orbitMobile = "1";
    root.classList.add("orbit-mobile");
  } else {
    root.dataset.orbitMobile = "0";
    root.classList.remove("orbit-mobile");
    delete root.dataset.orbitView;
  }
  return mobile;
}

export function setOrbitMobileView(view) {
  const root = document.documentElement;
  if (!view || root.dataset.orbitMobile !== "1") {
    delete root.dataset.orbitView;
    return;
  }
  root.dataset.orbitView = view;
}

export function useOrbitMobile() {
  const [mobile, setMobile] = useState(() => isOrbitMobile());
  useEffect(() => {
    const update = () => setMobile(applyOrbitMobileFlag());
    update();
    const media = window.matchMedia?.(MOBILE_QUERY);
    media?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    return () => {
      media?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return mobile;
}
