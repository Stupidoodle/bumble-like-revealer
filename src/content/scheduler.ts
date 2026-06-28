// One coalesced read per DOM burst (a settle-timer + a single rAF), and the
// MutationObserver over the deck. Mutations that originate inside our own
// overlays are ignored so opening or scrolling the dossier never re-triggers
// a deck pass.

import { DOM_SETTLE_MS } from "./constants";
import { makeLog } from "../shared/log";
import { processEncounter } from "./badge";

const log = makeLog("[BE]");

// ── Scheduler (one coalesced pass per burst) ─────────────────
let scheduled = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
export const schedule = (): void => {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; processEncounter(); });
  }, DOM_SETTLE_MS);
};

// ── Observe the deck ─────────────────────────────────────────
export const startObserver = (): void => {
  const root =
    document.querySelector(".encounters-album") ||
    document.querySelector("main") ||
    document.body;
  // Ignore mutations that originate inside our own overlays (rail, lightbox,
  // scrim) so opening or scrolling the dossier never re-triggers a deck pass.
  const fromOurUi = (n: Node | null): boolean => {
    const el = n && n.nodeType === 1 ? (n as Element) : (n && (n as Node).parentElement);
    return !!(el && el.closest && el.closest("#be-dossier,#be-lightbox,#be-dossier-scrim"));
  };
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (!fromOurUi(m.target)) { schedule(); return; }
    }
  }).observe(root, { childList: true, subtree: true });
  log("observing", root === document.body ? "body" : "encounters root");
};
