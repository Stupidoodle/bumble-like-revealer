// Content-script constants. The page<->content channel and RPC names live in
// shared/constants; everything here is content-only: DOM ids, cache caps,
// timings, the vote->badge token tables, and the Bumble card selectors.

export const BADGE_ID = "be-vote-badge";
export const RAIL_ID = "be-dossier";
export const LIGHTBOX_ID = "be-lightbox";
export const SCRIM_ID = "be-dossier-scrim";

export const STORAGE_KEY = "be_cache_v2";
export const FULL_STORAGE_KEY = "be_full_cache_v1"; // full-record cache key
export const CACHE_LIMIT = 1000; // LRU cap on remembered slim profiles
export const FULL_CACHE_LIMIT = 50; // cap in-memory/persisted full records

export const DOM_SETTLE_MS = 40; // coalesce DOM bursts before reading
export const BROKEN_AFTER_MS = 8000; // no data by now => likely broken

export const THEIR_VOTE = { NOT_VOTED: 1, LIKED_YOU: 2, REJECTED_YOU: 3 } as const;

// Accent tokens shared with the Phase 2 dossier so one fact never reads green
// in the badge and honey in the rail. Honey = LIKED/MATCH (dossier --be-honey);
// muted warm ink = PASSED/NEW/NEUTRAL/UNCERTAIN/NO-DATA (dossier --be-ink-mute);
// the online-green #45D27A (dossier --be-online) is carried by the green
// enrichment emoji, the only green left on the badge.
export const BADGE_HONEY = "#F6B23C";
export const BADGE_MUTE = "#ADA9A0";
export const NEUTRAL = BADGE_MUTE;

export const VOTE_BADGE: Record<number, { text: string; color: string }> = {
  [THEIR_VOTE.NOT_VOTED]: { text: "NOT VOTED", color: BADGE_MUTE },
  [THEIR_VOTE.LIKED_YOU]: { text: "LIKED YOU ❤️", color: BADGE_HONEY },
  [THEIR_VOTE.REJECTED_YOU]: { text: "PASSED 💔", color: BADGE_MUTE },
};

// Prefer stable QA/aria hooks; fall back to the BEM class. Build pipelines hash
// CSS classes but tend to keep test attributes.
export const NAME_SELECTORS = [
  '[data-qa-role="encounters-story-profile-name"]',
  ".encounters-story-profile__name",
];
export const AGE_SELECTORS = [
  '[data-qa-role="encounters-story-profile-age"]',
  ".encounters-story-profile__age",
];
export const CARD_SELECTOR = ".encounters-story-profile";
