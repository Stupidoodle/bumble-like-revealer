// Phase 2 - PROFILE DOSSIER (premium right-rail HUD).
//
// A lazy, on-demand readout of EVERYTHING SERVER_GET_USER returns for the
// profile the owner is already viewing. Mounted on document.body (never inside
// Bumble's recycled card subtree). One signed GET_USER per explicit open, never
// per card. Owns the rail/lightbox state; the actual signed fetch lives in
// bridge.ts (imported as requestUser), and the GET_USER reply is merged in
// cache.ts (mergeFull) before renderFull is called.

import { RAIL_ID, LIGHTBOX_ID, SCRIM_ID } from "./constants";
import {
  h, section, row, chip, chipRow, copyRow, collapsible,
  strOf, numOr, arrStrings, relTime, fmtDob, photoUrl, flattenPhotos,
  locStr, residenceStr, verdictInfo, myVoteText, GENDER, GAME_MODE, PERM_FLAGS,
} from "./format";
import { byId, fullById, resolve } from "./cache";
import { ensureStyle } from "./styles";
import { getActiveProfile, parseAge } from "./badge";
import { requestUser } from "./bridge";
import { makeErr } from "../shared/log";

const err = makeErr("[BE]");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

const NARROW = 1180; // px: below this the rail overlays + scrims

// ── Rail / lightbox state ────────────────────────────────────────────
let railOpen = false;
let currentUserId: string | null = null;
let currentReqId: string | null = null;
let fetchTimer: ReturnType<typeof setTimeout> | null = null;
let railEl!: HTMLElement;
let statusEl!: HTMLElement;
let heroEl!: HTMLElement;
let bodyEl!: HTMLElement;
let footerEl!: HTMLElement;
let footerCacheEl!: HTMLElement;
let scrimEl!: HTMLElement;
let lightboxEl: HTMLElement | null = null;
let lightboxImg!: HTMLImageElement;
let lightboxPhotos: any[] = [];
let lightboxIndex = 0;
let lightboxReturnFocus: HTMLElement | null = null;
let lastFocus: any = null;
export const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)");

// ── Accessors (rail state shared with bridge + the global handlers) ──
export const isRailOpen = (): boolean => railOpen;
export const isLightboxOpen = (): boolean => !!(lightboxEl && lightboxEl.classList.contains("be-open"));
export const getRailEl = (): HTMLElement | null => railEl || null;
export const getLightboxEl = (): HTMLElement | null => lightboxEl;
export const getCurrentUserId = (): string | null => currentUserId;
export const getCurrentReqId = (): string | null => currentReqId;
export const setCurrentReqId = (v: string | null): void => { currentReqId = v; };
export const getFetchTimer = (): ReturnType<typeof setTimeout> | null => fetchTimer;
export const setFetchTimer = (v: ReturnType<typeof setTimeout> | null): void => { fetchTimer = v; };

// ── Hero (shared across loading / error / full) ──────────────────────
const animateCount = (el: HTMLElement, to: any): void => {
  to = Number(to) || 0;
  if (prefersReduced.matches || to <= 0) { el.textContent = String(to); return; }
  const dur = 900, t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const renderHero = (rec: Rec): void => {
  rec = rec || {};
  heroEl.textContent = "";
  const v = verdictInfo(rec);

  const purl = photoUrl(rec.profile_photo, "preview");
  const thumb = h("div", { class: "be-hero-photo" },
    purl ? h("img", { src: purl, alt: "", loading: "lazy" }) : h("div", { class: "be-hero-photo-empty", "aria-hidden": "true" }));

  const tag = h("span", { class: "be-verdict be-v-" + v.cls },
    h("span", { class: "be-verdict-txt", text: v.text }),
    v.emoji ? h("span", { class: "be-verdict-emoji", "aria-hidden": "true", text: " " + v.emoji }) : null);
  const underline = h("span", { class: "be-verdict-underline", "aria-hidden": "true" });

  const heroChips: any[] = [];
  if (rec.is_crush) heroChips.push(chip("⭐ SUPERSWIPED YOU", "honey"));
  if (rec.is_verified) heroChips.push(chip("VERIFIED ✓", "seal"));
  if (rec.is_locked) heroChips.push(chip("LOCKED", "honey"));

  const verdictCol = h("div", { class: "be-hero-verdict" },
    h("div", { class: "be-verdict-wrap" }, tag, underline),
    h("div", { class: "be-hero-sub" }, h("span", { class: "be-myvote", text: "you: " + myVoteText(rec) })),
    heroChips.length ? h("div", { class: "be-hero-chips" }, ...heroChips) : null);

  let scoreCol: HTMLElement | null = null;
  const score = Number(rec.profile_score_numeric);
  if (isFinite(score) && score > 0) {
    const fig = h("span", { class: "be-score-fig", text: "0" });
    const fill = h("span", { class: "be-score-fill" });
    scoreCol = h("div", { class: "be-hero-score be-score-" + v.cls },
      h("div", { class: "be-score-row" }, fig, h("span", { class: "be-score-unit", text: "/1000" })),
      h("span", { class: "be-score-meter" }, fill));
    requestAnimationFrame(() => {
      animateCount(fig, score);
      const pct = Math.max(0, Math.min(100, (score / 1000) * 100));
      if (prefersReduced.matches) fill.style.width = pct + "%";
      else requestAnimationFrame(() => { fill.style.width = pct + "%"; });
    });
  }

  heroEl.appendChild(h("div", { class: "be-hero-top" }, thumb, verdictCol, scoreCol));
  if (rec.match_message) heroEl.appendChild(h("div", { class: "be-match-quote", text: "“" + String(rec.match_message) + "”" }));
  if (prefersReduced.matches) underline.classList.add("be-wipe");
  else requestAnimationFrame(() => underline.classList.add("be-wipe"));
};

// ── Body sections ────────────────────────────────────────────────────
const sectionActivity = (rec: Rec): HTMLElement => {
  const kids: any[] = [];
  const onlineRow = h("div", { class: "be-row" }, h("span", { class: "be-label", text: "Online" }));
  if (rec.online_status === 1) {
    onlineRow.appendChild(h("span", { class: "be-val be-online-line" },
      h("span", { class: "be-dot", "aria-hidden": "true" }),
      document.createTextNode(rec.online_status_text || "Online")));
  } else {
    onlineRow.appendChild(h("span", { class: "be-val" + (rec.online_status_text ? "" : " be-faint"), text: rec.online_status_text || "offline" }));
  }
  kids.push(onlineRow);
  const exp = relTime(rec.online_status_expires_at);
  if (exp) kids.push(row("Status expires", exp, { mono: true }));
  const chips: any[] = [];
  if (rec.last_riseup_time_message) chips.push(chip("BOOSTING NOW", "honey"));
  if (rec.is_hot) chips.push(chip("HOT", "outline"));
  if (rec.is_highlighted) chips.push(chip("HIGHLIGHTED", "outline"));
  if (rec.is_newbie) chips.push(chip("NEW HERE", "outline"));
  const cr = chipRow(...chips);
  if (cr) kids.push(cr);
  kids.push(row("Interests", numOr(rec.interests_total), { mono: true }));
  kids.push(row("Photos", numOr(rec.photo_count), { mono: true }));
  kids.push(row("Videos", numOr(rec.video_count), { mono: true }));
  return section("ACTIVITY", ...kids);
};

const sectionIdentity = (rec: Rec): HTMLElement => {
  const kids: any[] = [];
  kids.push(h("div", { class: "be-row be-row-name" },
    h("span", { class: "be-name", text: rec.name || "Unknown" }),
    rec.age != null ? h("span", { class: "be-age be-mono", text: String(rec.age) }) : null));
  if (rec.profile_caption) kids.push(h("div", { class: "be-caption", text: String(rec.profile_caption) }));
  const dob = fmtDob(rec.dob);
  if (dob) kids.push(row("Date of birth", dob, { mono: true }));
  const gchips: any[] = [];
  if (rec.gender != null) gchips.push(chip(GENDER[rec.gender] || ("gender " + rec.gender), "outline"));
  const eg = strOf(rec.extended_gender);
  if (eg) gchips.push(chip(eg, "outline"));
  const cr = chipRow(...gchips);
  if (cr) kids.push(cr);
  if (rec.encrypted_user_id != null) kids.push(copyRow("Encrypted ID", String(rec.encrypted_user_id)));
  if (rec.user_id != null) kids.push(copyRow("User ID", String(rec.user_id)));
  return section("IDENTITY", ...kids);
};

const sectionVerification = (rec: Rec): HTMLElement => {
  const kids: any[] = [];
  const vi = rec.verified_information || {};
  const methods = Array.isArray(vi.methods) ? vi.methods : [];
  const anything = rec.is_verified || rec.verification_status != null || vi.display_message || methods.length || rec.show_verified_student_banner;
  const topChips: any[] = [];
  if (rec.is_verified) topChips.push(chip("VERIFIED ✓", "seal"));
  if (rec.show_verified_student_banner) topChips.push(chip("STUDENT", "outline"));
  const cr = chipRow(...topChips);
  if (cr) kids.push(cr);
  if (rec.verification_status != null) kids.push(row("Verification status", rec.verification_status, { mono: true }));
  if (vi.display_message) kids.push(row("Message", vi.display_message));
  if (methods.length) {
    const mc = chipRow(...methods.map((m: any) => chip(String(strOf(m) || "method"), "outline")));
    if (mc) kids.push(mc);
  }
  if (!anything) kids.push(h("div", { class: "be-row" }, h("span", { class: "be-val be-faint", text: "not verified" })));
  return section("VERIFICATION", ...kids);
};

const sectionLocation = (rec: Rec): HTMLElement => {
  const kids: any[] = [];
  if (rec.distance_short) kids.push(h("div", { class: "be-loc-primary", text: String(rec.distance_short) }));
  if (!__BE_PUBLIC_SAFE__ && rec.distance != null) kids.push(row("Distance", String(rec.distance) + " m", { mono: true, flag: true }));
  const seen = new Set<string>();
  if (rec.distance_short) seen.add(String(rec.distance_short));
  const pushLoc = (label: string, v: any) => { const s = strOf(v); if (s && !seen.has(s)) { seen.add(s); kids.push(row(label, s)); } };
  pushLoc("Area", rec.distance_long);
  pushLoc("Current", rec.current_location_text);
  pushLoc("Location", rec.location_name);
  const city = rec.city && rec.city.name;
  const country = rec.country || {};
  const cparts: any[] = [];
  if (city) cparts.push(city);
  if (country.name) cparts.push(country.name);
  let cstr = cparts.join(", ");
  if (country.flag_symbol && cstr) cstr = country.flag_symbol + " " + cstr;
  if (country.iso_code) cstr = (cstr ? cstr + " " : "") + "(" + country.iso_code + ")";
  if (cstr.trim()) kids.push(row("City / Country", cstr));
  if (rec.hometown) kids.push(row("Hometown", locStr(rec.hometown)));
  if (rec.residence) kids.push(row("Residence", residenceStr(rec.residence)));
  if (rec.travel_location) kids.push(row("Travel", locStr(rec.travel_location)));
  if (!__BE_PUBLIC_SAFE__ && rec.is_teleported) { const tc = chipRow(chip("⚑ TELEPORTED", "honey")); if (tc) kids.push(tc); }
  if (!kids.length) kids.push(h("div", { class: "be-row" }, h("span", { class: "be-val be-faint", text: "not provided" })));
  return section("LOCATION", ...kids);
};

const fieldList = (fields: any): any[] => {
  if (!Array.isArray(fields)) return [];
  return fields.map((f: any) => {
    if (!f) return null;
    const label = f.name || f.display_name || f.title || f.type_name || ("field" + (f.type != null ? " " + f.type : ""));
    const value = f.display_value || f.value || f.text
      || (Array.isArray(f.values) ? f.values.map(strOf).filter(Boolean).join(", ") : null)
      || strOf(f);
    return row(String(label).trim() || "field", value);
  }).filter(Boolean);
};
const sectionsList = (sections: any): any[] => {
  if (!Array.isArray(sections)) return [];
  const out: any[] = [];
  sections.forEach((s: any) => {
    if (!s) return;
    const name = s.name || s.title || s.header || null;
    const val = s.display_value || s.value || s.text
      || (Array.isArray(s.items) ? s.items.map(strOf).filter(Boolean).join(", ") : null);
    if (name && val) out.push(row(String(name), val));
    else if (name) out.push(h("div", { class: "be-sub-head", text: String(name).toUpperCase() }));
    else if (val) out.push(h("div", { class: "be-row" }, h("span", { class: "be-val", text: val })));
  });
  return out;
};
const expList = (items: any): any[] => {
  if (!Array.isArray(items)) return [];
  return items.map((it: any) => {
    if (!it) return null;
    const title = it.name || it.title || it.degree || it.position || it.role || strOf(it);
    const place = it.place || it.school || it.company || it.organisation || it.organization || it.subtitle || it.location;
    const txt = place ? (title ? title + " @ " + place : place) : title;
    return txt ? h("div", { class: "be-exp", text: String(txt) }) : null;
  }).filter(Boolean);
};
const trackRow = (title: any, artist: any, preview: any): HTMLElement => {
  const txt = [title, artist].filter(Boolean).join(" · ") || "track";
  const kids: any[] = [];
  if (preview) {
    const btn = h("button", { class: "be-play", type: "button", title: "Preview", "aria-label": "Play preview", text: "▸" });
    let audio: HTMLAudioElement | null = null;
    btn.addEventListener("click", () => {
      try {
        if (!audio) audio = new Audio(preview);
        if (audio.paused) { audio.play(); btn.textContent = "❚❚"; audio.onended = () => { btn.textContent = "▸"; }; }
        else { audio.pause(); btn.textContent = "▸"; }
      } catch { /* media blocked */ }
    });
    kids.push(btn);
  }
  kids.push(h("span", { class: "be-track-txt", text: txt }));
  return h("div", { class: "be-track" }, ...kids);
};
const musicRow = (rec: Rec): HTMLElement | null => {
  const out: any[] = [];
  const sp = rec.spotify_mood_song;
  if (sp) {
    const title = sp.name || sp.title || strOf(sp);
    const artist = sp.artist || sp.artist_name || (sp.artists && arrStrings(sp.artists).join(", "));
    const preview = sp.preview_url || sp.preview || (sp.urls && sp.urls.preview);
    out.push(trackRow(title, artist, preview));
  }
  if (Array.isArray(rec.music_services)) rec.music_services.forEach((svc: any) => {
    if (!svc) return;
    const tracks = svc.tracks || svc.top_artists || svc.items;
    if (Array.isArray(tracks)) tracks.forEach((t: any) => out.push(trackRow(t.name || t.title || strOf(t), t.artist || t.subtitle, t.preview_url)));
    else out.push(row(svc.name || "music", strOf(svc) || "connected"));
  });
  return out.length ? h("div", { class: "be-sub" }, h("div", { class: "be-sub-head", text: "MUSIC" }), ...out) : null;
};

const subAccordion = (title: string, nodes: any[], expanded?: boolean): HTMLElement | null => {
  const real = (nodes || []).filter(Boolean);
  if (!real.length) return null;
  return collapsible(title, h("div", { class: "be-acc-inner" }, ...real), { expanded: !!expanded });
};

const sectionProfile = (rec: Rec): HTMLElement => {
  const head: any[] = [];
  const aboutParts: any[] = [];
  if (rec.profile_summary) { const s = strOf(rec.profile_summary); if (s) aboutParts.push(s); }
  arrStrings(rec.displayed_about_me).forEach((a) => aboutParts.push(a));
  if (aboutParts.length) head.push(h("div", { class: "be-pull", text: aboutParts.join("\n\n") }));
  const tiw = rec.tiw_idea && (rec.tiw_idea.tiw_phrase || rec.tiw_idea.phrase);
  if (tiw) head.push(h("div", { class: "be-prompt" },
    h("span", { class: "be-prompt-tag", text: "PROMPT" }),
    h("span", { class: "be-prompt-txt", text: String(tiw) })));

  const accs: any[] = [];
  accs.push(subAccordion("Profile fields", fieldList(rec.profile_fields), true));
  accs.push(subAccordion("Sections", sectionsList(rec.sections), false));
  const langs = arrStrings(rec.spoken_languages);
  if (langs.length) accs.push(subAccordion("Languages", [chipRow(...langs.map((l) => chip(l, "outline")))], false));
  accs.push(subAccordion("Education", expList(rec.educations), false));
  accs.push(subAccordion("Work", expList(rec.jobs), false));
  const music = musicRow(rec);
  if (music) accs.push(subAccordion("Music", [music], false));

  const real = accs.filter(Boolean);
  const kids = head.concat(real);
  if (!kids.length) kids.push(h("div", { class: "be-row" }, h("span", { class: "be-val be-faint", text: "not provided" })));
  return section("PROFILE", ...kids);
};

const sectionMedia = (rec: Rec): HTMLElement => {
  const kids: any[] = [];
  const photos = flattenPhotos(rec.albums);
  if (!photos.length && rec.profile_photo) photos.push(rec.profile_photo);
  const nPhotos = rec.photo_count != null ? rec.photo_count : photos.length;
  const nVideo = rec.video_count != null ? rec.video_count : 0;
  kids.push(h("div", { class: "be-media-cap be-mono", text: nPhotos + " photos · " + nVideo + " video" }));
  const usable = photos.filter((p) => photoUrl(p, "preview") || photoUrl(p, "large"));
  if (usable.length) {
    const strip = h("div", { class: "be-filmstrip" });
    usable.forEach((p, i) => {
      const purl = photoUrl(p, "preview") || photoUrl(p, "large");
      const isVid = !!(p.is_video || p.video || p.video_url);
      const btn = h("button", { class: "be-thumb", type: "button", "aria-label": "Open photo " + (i + 1) });
      btn.appendChild(h("img", { src: purl, alt: "", loading: "lazy", "data-large": photoUrl(p, "large") || purl }));
      if (isVid) btn.appendChild(h("span", { class: "be-thumb-vid", "aria-hidden": "true", text: "▸" }));
      btn.addEventListener("click", () => openLightbox(usable, i, btn));
      strip.appendChild(btn);
    });
    kids.push(strip);
  } else {
    kids.push(h("div", { class: "be-row" }, h("span", { class: "be-val be-faint", text: "no media" })));
  }
  return section("MEDIA", ...kids);
};

const sectionPermissions = (rec: Rec): HTMLElement => {
  const grid = h("div", { class: "be-flag-grid" });
  let lit = 0, total = 0;
  PERM_FLAGS.forEach(([key, label]) => {
    if (key === "blocked_you" && __BE_PUBLIC_SAFE__) return;
    total++;
    const on = !!rec[key];
    if (on) lit++;
    grid.appendChild(h("span", { class: "be-flag" + (on ? " be-flag-on" : "") },
      key === "blocked_you" ? h("span", { class: "be-flag-glyph", title: "de-anonymizing: omitted in public build", "aria-label": "de-anonymizing: omitted in public build", text: "⚑ " }) : null,
      document.createTextNode(label)));
  });
  const extra: any[] = [];
  extra.push(row("Muted until", relTime(rec.muted_until_timestamp) || "not muted", { mono: true }));
  extra.push(row("Unread", rec.unread_messages_count != null ? rec.unread_messages_count : 0, { mono: true }));
  if (rec.game_mode != null) extra.push(row("Game mode", GAME_MODE[rec.game_mode] != null ? GAME_MODE[rec.game_mode] : rec.game_mode, { mono: true }));
  if (rec.access_level != null) extra.push(row("Access level", rec.access_level, { mono: true }));
  const content = h("div", { class: "be-perm-content" }, grid, ...extra);
  return h("div", { class: "be-section" },
    h("div", { class: "be-sec-head", text: "PERMISSIONS & STATE" }),
    collapsible("Flags", content, { expanded: false, summary: lit + "/" + total + " enabled" }));
};

// ── State renderers ──────────────────────────────────────────────────
export const setStatusLine = (txt: string, dim?: boolean): void => {
  if (!statusEl) return;
  statusEl.textContent = txt;
  statusEl.classList.toggle("be-status-dim", !!dim);
};
const setFooterCache = (txt: string): void => { if (footerCacheEl) footerCacheEl.textContent = txt; };

const staggerReveal = (): void => {
  if (prefersReduced.matches) return;
  Array.from(bodyEl.children).slice(0, 8).forEach((k, i) => {
    k.classList.add("be-stagger");
    setTimeout(() => k.classList.add("be-in"), 60 * i);
  });
};

const renderSkeleton = (): void => {
  bodyEl.textContent = "";
  setStatusLine("GET_USER … requesting");
  for (let s = 0; s < 4; s++) {
    const rows: any[] = [h("div", { class: "be-sk be-sk-head" })];
    for (let i = 0; i < 4; i++) rows.push(h("div", { class: "be-sk-row" },
      h("span", { class: "be-sk be-sk-label" }), h("span", { class: "be-sk be-sk-val" })));
    bodyEl.appendChild(h("div", { class: "be-section" }, ...rows));
  }
};

const renderEmptyNoProfile = (): void => {
  currentUserId = null;
  setStatusLine("no active profile", true);
  renderHero({});
  bodyEl.textContent = "";
  bodyEl.appendChild(h("div", { class: "be-empty", text: "No active profile" }));
  setFooterCache("idle");
};

export const renderError = (errMsg: any, rec?: Rec): void => {
  setStatusLine("GET_USER failed", true);
  renderHero(rec || fullById.get(String(currentUserId)) || byId.get(String(currentUserId)) || {});
  bodyEl.textContent = "";
  const retry = h("button", { class: "be-retry", type: "button", text: "✕ GET_USER failed · " + String(errMsg) + " · retry ↻" });
  retry.addEventListener("click", () => { if (currentUserId) { renderSkeleton(); requestUser(currentUserId, true); } });
  bodyEl.appendChild(h("div", { class: "be-error" }, retry));
  setFooterCache("error");
};

export const renderFull = (rec: Rec | null | undefined, meta?: any, cached?: boolean): void => {
  if (!rec) { renderEmptyNoProfile(); return; }
  if (meta) setStatusLine((cached ? "GET_USER cached · " : "GET_USER " + (meta.status || 200) + " · " + (meta.ms || 0) + "ms · ") + (meta.populated || 0) + "/" + (meta.requested || 95));
  else setStatusLine("cached");
  renderHero(rec);
  bodyEl.textContent = "";
  bodyEl.appendChild(sectionActivity(rec));
  bodyEl.appendChild(sectionIdentity(rec));
  bodyEl.appendChild(sectionVerification(rec));
  bodyEl.appendChild(sectionLocation(rec));
  bodyEl.appendChild(sectionProfile(rec));
  bodyEl.appendChild(sectionMedia(rec));
  bodyEl.appendChild(sectionPermissions(rec));
  setFooterCache(cached ? "cached · ↻" : ("live · " + (meta ? (meta.ms || 0) + "ms" : "") + " · ↻"));
  staggerReveal();
};

// ── Rail + lightbox construction (built once, kept in the DOM) ────────
export const updateResponsive = (): void => {
  const narrow = window.innerWidth < NARROW;
  if (scrimEl) scrimEl.classList.toggle("be-show", narrow && railOpen);
  if (railEl) {
    if (narrow && railOpen) railEl.setAttribute("aria-modal", "true");
    else railEl.removeAttribute("aria-modal");
  }
};

const ensureRail = (): void => {
  if (railEl) return;
  scrimEl = h("div", { id: SCRIM_ID, "aria-hidden": "true" });
  scrimEl.addEventListener("click", () => closeRail());
  document.body.appendChild(scrimEl);

  statusEl = h("div", { class: "be-status", text: "GET_USER" });
  const closeBtn = h("button", { class: "be-close", type: "button", title: "Close (Esc)", "aria-label": "Close dossier", text: "✕" });
  closeBtn.addEventListener("click", () => closeRail());
  const header = h("div", { class: "be-header" }, statusEl, closeBtn);

  heroEl = h("div", { class: "be-hero" });
  bodyEl = h("div", { class: "be-body", tabindex: "-1" });

  footerCacheEl = h("div", { class: "be-cache", text: "idle" });
  const refetch = h("button", { class: "be-refetch", type: "button", title: "Refetch", "aria-label": "Refetch profile", text: "↻" });
  refetch.addEventListener("click", () => { if (currentUserId) { renderSkeleton(); requestUser(currentUserId, true); } });
  footerEl = h("div", { class: "be-footer" }, footerCacheEl, refetch);
  if (__BE_PUBLIC_SAFE__) footerEl.appendChild(h("div", { class: "be-safe-note", text: "public-safe build" }));

  const safe = h("div", { class: "be-safe", "aria-hidden": "true" });

  railEl = h("div", { id: RAIL_ID, role: "dialog", "aria-label": "Profile dossier" }, header, heroEl, bodyEl, footerEl, safe);
  if (prefersReduced.matches) railEl.classList.add("be-rm");
  document.body.appendChild(railEl);
};

const showRail = (): void => {
  railOpen = true;
  railEl.style.display = "flex";
  if (prefersReduced.matches) railEl.classList.add("be-open");
  else requestAnimationFrame(() => requestAnimationFrame(() => railEl.classList.add("be-open")));
  updateResponsive();
  const closeBtn = railEl.querySelector(".be-close");
  if (closeBtn) setTimeout(() => { try { (closeBtn as HTMLElement).focus(); } catch {} }, prefersReduced.matches ? 0 : 80);
};

export const closeRail = (): void => {
  if (!railOpen) return;
  railOpen = false;
  currentReqId = null; // drop any in-flight reply
  if (fetchTimer) { clearTimeout(fetchTimer); fetchTimer = null; }
  railEl.classList.remove("be-open");
  const finish = () => { if (!railOpen) { railEl.style.display = "none"; if (scrimEl) scrimEl.classList.remove("be-show"); } };
  if (prefersReduced.matches) finish();
  else setTimeout(finish, 200);
  updateResponsive();
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
};

// The deck advanced while the rail is open. Never leave the dossier pinned to a
// profile the owner already swiped past, or the footer refetch/error-retry
// would hit the OLD user_id. Re-point from cache only; if the new card has no
// cached full record, close rather than auto-fetch (one signed GET_USER per
// explicit open, never per swipe).
export const syncRailToActive = (): void => {
  try {
    if (!railOpen || currentUserId == null) return;
    const active = getActiveProfile();
    if (!active || !active.nameEl) return;
    const name = active.nameEl.textContent!.trim();
    const age = parseAge(active.ageEl);
    if (!name || Number.isNaN(age)) return;
    const r = resolve(name, age);
    const activeId = r.status === "hit" ? String(r.rec.user_id) : null;
    if (activeId === currentUserId) return;          // still the same profile
    if (activeId == null) { closeRail(); return; }   // ambiguous / unknown card
    const full = fullById.get(activeId);
    if (full && full._full) { currentUserId = activeId; renderFull(full, full._meta, true); }
    else closeRail();
  } catch (e) { err("syncRail", e); }
};

// ── Lightbox ─────────────────────────────────────────────────────────
const ensureLightbox = (): void => {
  if (lightboxEl) return;
  const scrim = h("div", { class: "be-lb-scrim" });
  scrim.addEventListener("click", () => closeLightbox());
  const prev = h("button", { class: "be-lb-prev", type: "button", "aria-label": "Previous", text: "‹" });
  prev.addEventListener("click", () => lightboxStep(-1));
  const next = h("button", { class: "be-lb-next", type: "button", "aria-label": "Next", text: "›" });
  next.addEventListener("click", () => lightboxStep(1));
  lightboxImg = h("img", { class: "be-lb-img", alt: "" }) as HTMLImageElement;
  const closeBtn = h("button", { class: "be-lb-close", type: "button", "aria-label": "Close", title: "Close (Esc)", text: "✕" });
  closeBtn.addEventListener("click", () => closeLightbox());
  lightboxEl = h("div", { id: LIGHTBOX_ID, role: "dialog", "aria-modal": "true", "aria-label": "Photo viewer" }, scrim, prev, lightboxImg, next, closeBtn);
  lightboxEl.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key === "ArrowLeft") { lightboxStep(-1); ev.preventDefault(); }
    else if (ev.key === "ArrowRight") { lightboxStep(1); ev.preventDefault(); }
    else if (ev.key === "Tab") {
      const f = Array.from(lightboxEl!.querySelectorAll("button"));
      if (!f.length) return;
      let i = f.indexOf(document.activeElement as any);
      i = ev.shiftKey ? i - 1 : i + 1;
      if (i < 0) i = f.length - 1; if (i >= f.length) i = 0;
      f[i].focus(); ev.preventDefault();
    }
  });
  document.body.appendChild(lightboxEl);
};
const renderLightbox = (): void => {
  const p = lightboxPhotos[lightboxIndex];
  lightboxImg.src = photoUrl(p, "large") || "";
  lightboxImg.alt = "Photo " + (lightboxIndex + 1) + " of " + lightboxPhotos.length;
};
const openLightbox = (photos: any[], index: number, returnFocus: HTMLElement): void => {
  ensureLightbox();
  lightboxPhotos = photos || []; lightboxIndex = index || 0; lightboxReturnFocus = returnFocus || null;
  renderLightbox();
  lightboxEl!.style.display = "flex";
  lightboxEl!.classList.add("be-open");
  const closeBtn = lightboxEl!.querySelector(".be-lb-close");
  if (closeBtn) try { (closeBtn as HTMLElement).focus(); } catch {}
};
const lightboxStep = (d: number): void => {
  if (!lightboxPhotos.length) return;
  lightboxIndex = (lightboxIndex + d + lightboxPhotos.length) % lightboxPhotos.length;
  renderLightbox();
};
export const closeLightbox = (): void => {
  if (!lightboxEl) return;
  lightboxEl.classList.remove("be-open");
  lightboxEl.style.display = "none";
  if (lightboxReturnFocus && lightboxReturnFocus.focus) { try { lightboxReturnFocus.focus(); } catch {} }
};

// ── Open / toggle flow ───────────────────────────────────────────────
export const openDossier = (userId?: any): void => {
  try {
    let uid = userId;
    if (uid == null) {
      const active = getActiveProfile();
      if (active && active.nameEl) {
        const name = active.nameEl.textContent!.trim();
        const age = parseAge(active.ageEl);
        const r = resolve(name, age);
        if (r.status === "hit") uid = r.rec.user_id;
      }
    }
    lastFocus = document.activeElement;
    ensureStyle();
    ensureRail();
    showRail();
    if (uid == null) { renderEmptyNoProfile(); return; }
    currentUserId = String(uid);
    const full = fullById.get(currentUserId);
    if (full && full._full) {
      renderFull(full, full._meta, true);
    } else {
      renderHero(byId.get(currentUserId) || {});
      renderSkeleton();
      requestUser(uid, false);
    }
  } catch (e) { err("openDossier", e); }
};

export const toggleDossier = (): void => { if (railOpen) closeRail(); else openDossier(); };
