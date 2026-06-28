// Pure formatting helpers: the no-innerHTML DOM builder, the defensive value
// formatters (unknown shapes collapse to null), the small inline render
// primitives (chips/rows/copy/collapsible/section), and the enum field maps.
// Nothing here touches module state or the rail.

import { THEIR_VOTE } from "./constants";

// Bumble payloads are large and loosely typed; model only what we read.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type Attrs = Record<string, any> | null | undefined;
type Kid = Node | string | null | undefined | false;

// ── DOM helper (no innerHTML with remote strings; text via textContent) ──
export const h = (tag: string, attrs?: Attrs, ...kids: Kid[]): HTMLElement => {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") (el as HTMLElement).style.cssText = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return el;
};

export const isEditable = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!(el as HTMLElement).isContentEditable;
};

// ── Value formatters (defensive: unknown shapes collapse to null) ────
export const strOf = (x: any): string | null => {
  if (x == null) return null;
  if (typeof x === "string") return x.trim() || null;
  if (typeof x === "number") return String(x);
  return x.text || x.value || x.display_value || x.name || x.phrase || null;
};
export const numOr = (v: any): any => (v == null ? null : v);
export const arrStrings = (x: any): string[] => {
  if (!x) return [];
  return (Array.isArray(x) ? x : [x]).map((i) => strOf(i)).filter(Boolean) as string[];
};
export const midEllipsis = (s: any, max?: number): string => {
  s = String(s);
  max = max || 22;
  if (s.length <= max) return s;
  const keep = Math.floor((max - 1) / 2);
  return s.slice(0, keep) + "…" + s.slice(s.length - keep);
};
export const relTime = (ts: any): string | null => {
  if (ts == null) return null;
  let n = Number(ts);
  if (!isFinite(n) || n <= 0) return null;
  if (n < 1e12) n *= 1000; // seconds -> ms
  const diff = n - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const hrs = Math.round(Math.abs(diff) / 3600000);
  const days = Math.round(Math.abs(diff) / 86400000);
  if (mins < 1) return "just now";
  const s = mins < 60 ? mins + "m" : hrs < 24 ? hrs + "h" : days + "d";
  return diff < 0 ? s + " ago" : "in " + s;
};
export const fmtDob = (dob: any): string | null => {
  if (!dob) return null;
  if (typeof dob === "string") return dob;
  const y = dob.year, m = dob.month, d = dob.day;
  if (y && m && d) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return null;
};
export const photoUrl = (p: any, prefer?: string): string | null => {
  if (!p) return null;
  if (typeof p === "string") return p;
  const keys = prefer === "large"
    ? ["large_url", "large_photo_url", "url", "preview_url", "preview_photo_url"]
    : ["preview_url", "preview_photo_url", "url", "large_url", "large_photo_url"];
  for (const k of keys) if (p[k]) return p[k];
  if (p.photo) return photoUrl(p.photo, prefer);
  return null;
};
export const flattenPhotos = (albums: any): any[] => {
  const out: any[] = [];
  if (!Array.isArray(albums)) return out;
  for (const al of albums) {
    const photos = (al && (al.photos || al.photo)) || [];
    if (Array.isArray(photos)) for (const ph of photos) out.push(ph);
  }
  return out;
};
export const locStr = (x: any): string | null => {
  if (!x) return null;
  if (typeof x === "string") return x;
  return x.name || x.display_value || (x.city && (x.city.name || x.city)) || x.text || null;
};
export const residenceStr = (r: any): string | null => {
  if (!r) return null;
  if (typeof r === "string") return r;
  const get = (o: any) => (o && (typeof o === "string" ? o : o.name)) || null;
  const parts = [get(r.country), get(r.region), get(r.city)].filter((p) => p && typeof p === "string");
  return parts.length ? parts.join(" · ") : (r.name || null);
};

// ── Verdict ──────────────────────────────────────────────────────────
export const verdictInfo = (rec: Rec): { text: string; cls: string; emoji: string } => {
  rec = rec || {};
  if (rec.is_match) return { text: "MATCH", cls: "match", emoji: "" };
  const tv = rec.their_vote;
  if (tv === THEIR_VOTE.LIKED_YOU) return { text: "LIKED YOU", cls: "liked", emoji: "❤️" };
  if (tv === THEIR_VOTE.REJECTED_YOU) return { text: "PASSED", cls: "passed", emoji: "💔" };
  if (tv === THEIR_VOTE.NOT_VOTED) return { text: "NEW", cls: "new", emoji: "" };
  return { text: "UNKNOWN", cls: "new", emoji: "" };
};
export const myVoteText = (rec: Rec): string => {
  const mv = rec && rec.my_vote;
  if (mv === 2) return "liked";
  if (mv === 3) return "passed";
  return "-";
};

// ── Small render primitives ──────────────────────────────────────────
export const section = (title: string, ...kids: Kid[]): HTMLElement =>
  h("div", { class: "be-section" }, h("div", { class: "be-sec-head", text: title }), ...kids.filter(Boolean));

export const row = (label: string, value?: any, opts?: any): HTMLElement => {
  opts = opts || {};
  const provided = value != null && value !== "";
  if (opts.flag) {
    const wrap = h("span", { class: "be-val be-mono" },
      h("span", { class: "be-sens", title: "de-anonymizing: omitted in public build", "aria-label": "de-anonymizing: omitted in public build", text: "⚑ " }),
      document.createTextNode(provided ? String(value) : "not provided"));
    return h("div", { class: "be-row" }, h("span", { class: "be-label", text: label }), wrap);
  }
  const valEl = h("span", {
    class: "be-val" + (opts.mono ? " be-mono" : "") + (provided ? "" : " be-faint"),
    text: provided ? String(value) : "not provided",
  });
  return h("div", { class: "be-row" }, h("span", { class: "be-label", text: label }), valEl);
};

export const chip = (text: string, kind?: string): HTMLElement => h("span", {
  class: "be-chip " + (kind === "seal" ? "be-chip-seal" : kind === "honey" ? "be-chip-honey" : "be-chip-outline"),
  text: text,
});
export const chipRow = (...chips: Kid[]): HTMLElement | null => {
  const real = chips.filter(Boolean);
  return real.length ? h("div", { class: "be-chip-row" }, ...real) : null;
};

export const copyRow = (label: string, value: any): HTMLElement => {
  const valEl = h("button", { class: "be-copy be-mono", type: "button", title: "Click to copy", text: midEllipsis(value) });
  valEl.addEventListener("click", () => {
    try {
      navigator.clipboard.writeText(String(value));
      const prev = midEllipsis(value);
      valEl.textContent = "✓ copied";
      valEl.classList.add("be-copied");
      setTimeout(() => { valEl.textContent = prev; valEl.classList.remove("be-copied"); }, 1100);
    } catch { /* clipboard blocked */ }
  });
  return h("div", { class: "be-row" }, h("span", { class: "be-label", text: label }), valEl);
};

export const collapsible = (title: string, content: any, opts?: any): HTMLElement => {
  opts = opts || {};
  const expanded = !!opts.expanded;
  const head = h("button", { class: "be-acc-head" + (expanded ? " be-open" : ""), type: "button", "aria-expanded": String(expanded) },
    h("span", { class: "be-acc-title", text: title }),
    opts.summary ? h("span", { class: "be-acc-summary", text: opts.summary }) : null,
    h("span", { class: "be-chev", "aria-hidden": "true", text: "›" }));
  const wrap = h("div", { class: "be-acc-body" + (expanded ? " be-open" : "") }, content);
  head.addEventListener("click", () => {
    const now = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!now));
    head.classList.toggle("be-open", !now);
    wrap.classList.toggle("be-open", !now);
  });
  return h("div", { class: "be-acc" }, head, wrap);
};

// ── Enum field maps ──────────────────────────────────────────────────
export const GENDER: Record<number, string> = { 1: "Male", 2: "Female", 3: "Non-binary" };
export const GAME_MODE: Record<number, string> = { 0: "Dating", 1: "BFF", 5: "Bizz" };
export const PERM_FLAGS: Array<[string, string]> = [
  ["allow_chat", "chat"], ["allow_spark", "spark"], ["allow_crush", "crush"],
  ["allow_voting", "voting"], ["allow_add_to_favourites", "add fav"],
  ["is_locked", "locked"], ["is_favourite", "favourite"], ["is_conversation", "conversation"],
  ["is_friend", "friend"], ["is_blocked", "blocked"], ["blocked_you", "blocked you"],
  ["is_unread", "unread"], ["has_finished_onboarding", "onboarded"],
];
