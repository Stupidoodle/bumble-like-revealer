// The encounters badge: find the card the owner is actually looking at, resolve
// it against the cache, and stamp a like/pass token on it. When a cached record
// backs the badge it is also armed as the lazy trigger for the dossier.

import {
  BADGE_ID, NAME_SELECTORS, AGE_SELECTORS, CARD_SELECTOR,
  VOTE_BADGE, NEUTRAL, BADGE_MUTE,
} from "./constants";
import { ensureStyle } from "./styles";
import { resolve, haveData, isSuspectBroken } from "./cache";
import { openDossier, syncRailToActive, isRailOpen } from "./dossier";
import { makeErr } from "../shared/log";

const err = makeErr("[BE]");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

// ── State ────────────────────────────────────────────────────
let lastBadgeKey: string | null = null;

// ── DOM lookup ───────────────────────────────────────────────
const queryFirst = (selectors: string[], root?: Element | null): Element | null => {
  const scope: ParentNode = root || document;
  for (const sel of selectors) {
    const el = scope.querySelector(sel);
    if (el) return el;
  }
  return null;
};
const queryAll = (selectors: string[]): Element[] => {
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length) return Array.from(els);
  }
  return [];
};

const isVisible = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
};

// Pick the name element on the card the user is actually looking at, not a
// transient outgoing/incoming card sharing the DOM mid-swipe.
export const getActiveProfile = () => {
  const names = queryAll(NAME_SELECTORS).filter(isVisible);
  if (!names.length) return null;
  // Largest visible area ≈ the front card.
  names.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.width * rb.height - ra.width * ra.height;
  });
  const nameEl = names[0];
  const cardEl = nameEl.closest(CARD_SELECTOR) || nameEl.parentElement;
  const ageEl = queryFirst(AGE_SELECTORS, cardEl) || queryFirst(AGE_SELECTORS);
  return { nameEl, ageEl, cardEl };
};

export const parseAge = (ageEl: Element | null): number => {
  if (!ageEl) return NaN;
  const m = String(ageEl.textContent).match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
};

// ── Badge ────────────────────────────────────────────────────
const enrichmentChips = (rec: Rec): string => {
  const chips: string[] = [];
  if (rec.is_crush) chips.push("⭐ SUPERSWIPED");
  if (rec.online_status === 1) chips.push("🟢");
  if (rec.is_verified) chips.push("✓");
  return chips.length ? " · " + chips.join(" ") : "";
};

const clearBadge = (): void => {
  document.querySelectorAll("#" + BADGE_ID).forEach((b) => b.remove());
  lastBadgeKey = null;
};

const render = (cardEl: Element | null, nameEl: Element, key: string, text: string, color: string, rec?: Rec): void => {
  if (key === lastBadgeKey && document.getElementById(BADGE_ID)) return; // no churn
  document.querySelectorAll("#" + BADGE_ID).forEach((b) => b.remove());
  const badge = document.createElement("span");
  badge.id = BADGE_ID;
  badge.style.cssText = `margin-left:8px;font-weight:700;font-size:15px;color:${color};text-shadow:0 1px 3px rgba(0,0,0,0.85);`;
  badge.textContent = text;
  // Phase 2 (additive): when a cached record backs this badge, arm it as the
  // sole, lazy trigger for the profile dossier. Existing text/color/churn-guard
  // logic above is untouched.
  if (rec && rec.user_id != null && typeof openDossier === "function") {
    ensureStyle();
    badge.style.cursor = "pointer";
    badge.title = "Open dossier (Cmd/Ctrl+D)";
    badge.classList.add("be-badge--armed");
    // Bumble's card name container is pointer-events:none (click-through), which
    // the badge inherits, so real mouse clicks pass straight through it to
    // Bumble's nav overlay behind. Force the armed badge clickable and above the
    // card overlays so its open-dossier click actually lands. (Synthetic .click()
    // skips hit-testing, which is why this was invisible until a real click.)
    badge.style.pointerEvents = "auto";
    badge.style.position = "relative";
    badge.style.zIndex = "2147483000";
    (badge as any)._rec = rec;
    // Open on pointerdown (the FIRST event of the gesture) and stop it there,
    // so Bumble's own card handlers never fire on mousedown and re-render/move
    // the badge mid-gesture (which swallows a plain click, so the dossier never
    // opened on a real mouse click). Swallow the trailing mousedown/click too.
    const openFromBadge = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      try { openDossier(rec.user_id); }
      catch (e2) { err("open dossier", e2); }
    };
    badge.addEventListener("pointerdown", openFromBadge);
    const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    badge.addEventListener("mousedown", swallow);
    badge.addEventListener("click", swallow);
  }
  ((nameEl.parentElement || cardEl) as Element).appendChild(badge);
  lastBadgeKey = key;
};

export const processEncounter = (): void => {
  try {
    // If the deck advanced while the rail is open, resync (or close) it so the
    // footer never refetches/retries a profile the owner swiped past.
    if (isRailOpen()) syncRailToActive();
    const active = getActiveProfile();
    if (!active || !active.nameEl) return;
    const name = active.nameEl.textContent!.trim();
    const age = parseAge(active.ageEl);
    if (!name || Number.isNaN(age)) return; // wait for a real render

    const r = resolve(name, age);
    const { cardEl, nameEl } = active;

    if (r.status === "hit") {
      const cfg = VOTE_BADGE[r.rec.their_vote];
      if (cfg) {
        render(cardEl, nameEl, "id:" + r.rec.user_id,
          `[${cfg.text}]${enrichmentChips(r.rec)}`, cfg.color, r.rec);
      } else {
        render(cardEl, nameEl, "unk:" + r.rec.user_id, "[UNKNOWN]", NEUTRAL, r.rec);
      }
    } else if (r.status === "ambiguous") {
      render(cardEl, nameEl, "amb:" + name + age, "[UNCERTAIN · duplicate name]", NEUTRAL);
    } else if (haveData()) {
      render(cardEl, nameEl, "new:" + name + age, "[NEW PROFILE]", BADGE_MUTE);
    } else if (isSuspectBroken()) {
      render(cardEl, nameEl, "nodata", "[NO DATA · extension may be broken]", NEUTRAL);
    } else {
      clearBadge(); // still loading: assert nothing
    }
  } catch (e) {
    err("process failed", e);
  }
};
