// The durable "burn book": the id-keyed slim cache + the full-record cache,
// their name|age reverse index, LRU eviction, the slim<->full merge, and
// chrome.storage persistence/hydration. Owns the liveReceived / suspectBroken
// signals, exposed via accessors so other modules can read/flip them.

import { STORAGE_KEY, FULL_STORAGE_KEY, CACHE_LIMIT, FULL_CACHE_LIMIT } from "./constants";
import { makeLog, makeErr } from "../shared/log";
import { schedule } from "./scheduler";

const log = makeLog("[BE]");
const err = makeErr("[BE]");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;
type Resolution =
  | { status: "miss" }
  | { status: "ambiguous" }
  | { status: "hit"; rec: Rec };

// ── State ────────────────────────────────────────────────────
export const byId = new Map<string, Rec>();          // user_id -> slim record (insertion-ordered)
export const idsByNameAge = new Map<string, Set<string>>(); // "name|age" -> Set(user_id)
export const fullById = new Map<string, Rec>();       // String(user_id) -> merged full record
let liveReceived = false;
let suspectBroken = false;

export const setLiveReceived = (): void => { liveReceived = true; };
export const isLiveReceived = (): boolean => liveReceived;
export const setSuspectBroken = (): void => { suspectBroken = true; };
export const isSuspectBroken = (): boolean => suspectBroken;

// ── Helpers ──────────────────────────────────────────────────
export const normName = (n: any): string => String(n == null ? "" : n).trim().toLowerCase();
export const nameAgeKey = (name: any, age: any): string => `${normName(name)}|${age}`;
export const haveData = (): boolean => liveReceived || byId.size > 0;

// ── Cache ────────────────────────────────────────────────────
export const remember = (rec: Rec): void => {
  if (!rec || rec.user_id == null) return;
  const id = String(rec.user_id);
  if (byId.has(id)) byId.delete(id); // refresh insertion order (LRU)
  byId.set(id, rec);
  while (byId.size > CACHE_LIMIT) byId.delete(byId.keys().next().value as string);

  const k = nameAgeKey(rec.name, rec.age);
  let set = idsByNameAge.get(k);
  if (!set) { set = new Set(); idsByNameAge.set(k, set); }
  set.add(id);
};

// Resolve on-screen name+age to a single record, or flag ambiguity instead of
// guessing. The badge must never assert a wrong vote.
export const resolve = (name: any, age: any): Resolution => {
  const set = idsByNameAge.get(nameAgeKey(name, age));
  if (!set || set.size === 0) return { status: "miss" };
  if (set.size > 1) return { status: "ambiguous" };
  const rec = byId.get(set.values().next().value as string);
  return rec ? { status: "hit", rec } : { status: "miss" };
};

// ── Persistence (slim cache) ─────────────────────────────────
let writeTimer: ReturnType<typeof setTimeout> | null = null;
export const persist = (): void => {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      chrome.storage && chrome.storage.local.set({ [STORAGE_KEY]: Array.from(byId.values()) });
    } catch (e) { err("persist", e); }
  }, 1000);
};

export const hydrate = (): void => {
  try {
    if (!chrome.storage) return;
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const arr = data && data[STORAGE_KEY];
      if (Array.isArray(arr)) {
        arr.forEach(remember);
        log("hydrated", arr.length);
        schedule();
      }
    });
  } catch (e) { err("hydrate", e); }
};

// ── Cache merge (slim Track A fields preserved; full record cached) ───
export const slimFromFull = (u: Rec): Rec => ({
  user_id: u.user_id, name: u.name, age: u.age, their_vote: u.their_vote,
  is_verified: u.is_verified, online_status: u.online_status,
  is_match: u.is_match, is_crush: u.is_crush, is_hot: u.is_hot,
});

let fullWriteTimer: ReturnType<typeof setTimeout> | null = null;
export const persistFull = (): void => {
  if (fullWriteTimer) clearTimeout(fullWriteTimer);
  fullWriteTimer = setTimeout(() => {
    fullWriteTimer = null;
    try {
      const capped = Array.from(fullById.values()).slice(-FULL_CACHE_LIMIT);
      chrome.storage && chrome.storage.local.set({ [FULL_STORAGE_KEY]: capped });
    } catch (e) { err("persistFull", e); }
  }, 1000);
};

export const mergeFull = (user: Rec, meta: any): Rec | null => {
  if (!user || user.user_id == null) return null;
  const id = String(user.user_id);
  const slim = byId.get(id) || {};
  const merged: Rec = Object.assign({}, slim, user, { _full: true, _meta: Object.assign({ at: Date.now() }, meta) });
  // Public-safe build: strip the de-anonymizing fields from the STORED record
  // (not just the view), before caching or persisting. Keep textual
  // distance_long/short so the LOCATION section still reads naturally.
  if (__BE_PUBLIC_SAFE__) { delete merged.distance; delete merged.is_teleported; delete merged.blocked_you; }
  if (fullById.has(id)) fullById.delete(id);
  fullById.set(id, merged);
  while (fullById.size > FULL_CACHE_LIMIT) fullById.delete(fullById.keys().next().value as string);
  // Re-slim from the MERGED record (not the raw GET_USER payload): encounters
  // fields (their_vote/is_crush/is_match/is_hot) are absent from GET_USER, so
  // slimming the raw user would write their_vote:undefined and corrupt the
  // good encounters record. merged preserves them.
  try { remember(slimFromFull(merged)); persist(); } catch (e) { err("remember full", e); }
  persistFull();
  return merged;
};

// Hydrate persisted full records so an in-session reopen is instant.
export const hydrateFull = (): void => {
  try {
    if (chrome.storage) chrome.storage.local.get(FULL_STORAGE_KEY, (data) => {
      const arr = data && data[FULL_STORAGE_KEY];
      if (Array.isArray(arr)) arr.forEach((rec) => {
        if (rec && rec.user_id != null) fullById.set(String(rec.user_id), rec);
      });
    });
  } catch (e) { err("hydrate full", e); }
};
