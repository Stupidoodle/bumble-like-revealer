// Content-script ENTRY (isolated world, document_idle). Wires the page<->content
// encounters channel to the cache + badge, registers the global dossier controls
// (Esc / Cmd-Ctrl+D / outside-click), and kicks off hydration, the deck observer,
// the buffered-batch pull, and the broken-state fallback. Read-only: it never
// votes. Importing ./bridge registers the signed GET_USER reply listener.

import { ENCOUNTERS_CHANNEL, ENCOUNTERS_PULL } from "../shared/constants";
import { makeLog, makeErr } from "../shared/log";
import { BADGE_ID, BROKEN_AFTER_MS } from "./constants";
import {
  byId, remember, persist, hydrate, hydrateFull,
  setLiveReceived, isLiveReceived, setSuspectBroken,
} from "./cache";
import { schedule, startObserver } from "./scheduler";
import { isEditable } from "./format";
import {
  prefersReduced, closeRail, closeLightbox, toggleDossier, updateResponsive,
  isRailOpen, isLightboxOpen, getRailEl, getLightboxEl,
} from "./dossier";
import "./bridge"; // registers the USER_CHANNEL reply listener at module-eval

(() => {
  "use strict";
  const log = makeLog("[BE]");
  const err = makeErr("[BE]");

  // ── Data bridge: slim encounters batches from page.js ──────────────
  // Registered before the pull dispatch below so the synchronous buffer
  // replay (page.js emits on the same tick) is never missed.
  window.addEventListener(ENCOUNTERS_CHANNEL, (event) => {
    const results = (event as CustomEvent).detail;
    if (!Array.isArray(results)) return;
    setLiveReceived();
    results.forEach((rec) => {
      try { remember(rec); } catch (e) { err("bad record", e); }
    });
    log("cached batch", results.length, "total", byId.size);
    persist();
    schedule();
  });

  // ── Global controls: hotkey, Esc, outside-click ────────────────────
  document.addEventListener("keydown", (e) => {
    try {
      if (e.key === "Escape") {
        if (isLightboxOpen()) { closeLightbox(); e.stopPropagation(); return; }
        if (isRailOpen()) { closeRail(); e.stopPropagation(); }
        return;
      }
      if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
        if (isEditable(document.activeElement)) return;
        e.preventDefault();
        toggleDossier();
      }
    } catch (ex) { err("keydown", ex); }
  }, true);

  document.addEventListener("mousedown", (e) => {
    try {
      if (!isRailOpen()) return;
      const t = e.target as Node | null;
      const rail = getRailEl();
      if (rail && rail.contains(t)) return;
      const lb = getLightboxEl();
      if (lb && lb.contains(t)) return;
      if (t && (t as any).id === BADGE_ID) return; // badge has its own toggle path
      closeRail();
    } catch { /* never throw into Bumble */ }
  }, true);

  window.addEventListener("resize", () => { try { updateResponsive(); } catch {} });
  try {
    prefersReduced.addEventListener("change", () => {
      const rail = getRailEl();
      if (rail) rail.classList.toggle("be-rm", prefersReduced.matches);
    });
  } catch { /* older Safari */ }

  // Hydrate persisted full records so an in-session reopen is instant.
  hydrateFull();

  hydrate();
  startObserver();
  // Pull any batch page.js buffered before we were listening.
  window.dispatchEvent(new CustomEvent(ENCOUNTERS_PULL));
  // If no data ever arrives, surface a broken state instead of lying.
  setTimeout(() => { if (!isLiveReceived()) { setSuspectBroken(); schedule(); } }, BROKEN_AFTER_MS);
  log("content script ready");
})();
