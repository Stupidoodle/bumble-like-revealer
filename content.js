// Listens for slimmed encounter data from page.js, caches it keyed by
// the stable user_id, and badges the profile card the user is actually
// looking at with their like/pass status. Read-only: it never votes.
(function () {
  'use strict';

  // ── Config ───────────────────────────────────────────────────
  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log('[BE]', ...a); };

  const CHANNEL = '__be_encounters';
  const BADGE_ID = 'be-vote-badge';
  const STORAGE_KEY = 'be_cache_v2';
  const CACHE_LIMIT = 1000;        // LRU cap on remembered profiles
  const DOM_SETTLE_MS = 40;        // coalesce DOM bursts before reading
  const BROKEN_AFTER_MS = 8000;    // no data by now ⇒ likely broken

  const THEIR_VOTE = { NOT_VOTED: 1, LIKED_YOU: 2, REJECTED_YOU: 3 };

  const VOTE_BADGE = {
    [THEIR_VOTE.NOT_VOTED]:    { text: 'NOT VOTED',    color: '#f59e0b' },
    [THEIR_VOTE.LIKED_YOU]:    { text: 'LIKED YOU ❤️', color: '#10b981' },
    [THEIR_VOTE.REJECTED_YOU]: { text: 'PASSED 💔',    color: '#f43f5e' },
  };
  const NEUTRAL = '#94a3b8';

  // Prefer stable QA/aria hooks; fall back to the BEM class. Build
  // pipelines hash CSS classes but tend to keep test attributes.
  const NAME_SELECTORS = [
    '[data-qa-role="encounters-story-profile-name"]',
    '.encounters-story-profile__name',
  ];
  const AGE_SELECTORS = [
    '[data-qa-role="encounters-story-profile-age"]',
    '.encounters-story-profile__age',
  ];
  const CARD_SELECTOR = '.encounters-story-profile';

  // ── State ────────────────────────────────────────────────────
  const byId = new Map();          // user_id -> slim record (insertion-ordered)
  const idsByNameAge = new Map();  // "name|age" -> Set(user_id) for DOM lookup
  let liveReceived = false;
  let suspectBroken = false;
  let lastBadgeKey = null;

  // ── Helpers ──────────────────────────────────────────────────
  const normName = (n) => String(n == null ? '' : n).trim().toLowerCase();
  const nameAgeKey = (name, age) => `${normName(name)}|${age}`;
  const haveData = () => liveReceived || byId.size > 0;

  const queryFirst = (selectors, root) => {
    const scope = root || document;
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    return null;
  };
  const queryAll = (selectors) => {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  };

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
  };

  // Pick the name element on the card the user is actually looking at,
  // not a transient outgoing/incoming card sharing the DOM mid-swipe.
  const getActiveProfile = () => {
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

  const parseAge = (ageEl) => {
    if (!ageEl) return NaN;
    const m = String(ageEl.textContent).match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  };

  // ── Cache ────────────────────────────────────────────────────
  const remember = (rec) => {
    if (!rec || rec.user_id == null) return;
    const id = String(rec.user_id);
    if (byId.has(id)) byId.delete(id); // refresh insertion order (LRU)
    byId.set(id, rec);
    while (byId.size > CACHE_LIMIT) byId.delete(byId.keys().next().value);

    const k = nameAgeKey(rec.name, rec.age);
    let set = idsByNameAge.get(k);
    if (!set) { set = new Set(); idsByNameAge.set(k, set); }
    set.add(id);
  };

  // Resolve on-screen name+age to a single record, or flag ambiguity
  // instead of guessing — the badge must never assert a wrong vote.
  const resolve = (name, age) => {
    const set = idsByNameAge.get(nameAgeKey(name, age));
    if (!set || set.size === 0) return { status: 'miss' };
    if (set.size > 1) return { status: 'ambiguous' };
    const rec = byId.get(set.values().next().value);
    return rec ? { status: 'hit', rec } : { status: 'miss' };
  };

  // ── Badge ────────────────────────────────────────────────────
  const enrichmentChips = (rec) => {
    const chips = [];
    if (rec.is_crush) chips.push('⭐ SUPERSWIPED');
    if (rec.online_status === 1) chips.push('🟢');
    if (rec.is_verified) chips.push('✓');
    return chips.length ? ' · ' + chips.join(' ') : '';
  };

  const clearBadge = () => {
    document.querySelectorAll('#' + BADGE_ID).forEach((b) => b.remove());
    lastBadgeKey = null;
  };

  const render = (cardEl, nameEl, key, text, color) => {
    if (key === lastBadgeKey && document.getElementById(BADGE_ID)) return; // no churn
    document.querySelectorAll('#' + BADGE_ID).forEach((b) => b.remove());
    const badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.style.cssText = `margin-left:8px;font-weight:700;font-size:15px;color:${color};`;
    badge.textContent = text;
    (nameEl.parentElement || cardEl).appendChild(badge);
    lastBadgeKey = key;
  };

  const processEncounter = () => {
    try {
      const active = getActiveProfile();
      if (!active || !active.nameEl) return;
      const name = active.nameEl.textContent.trim();
      const age = parseAge(active.ageEl);
      if (!name || Number.isNaN(age)) return; // wait for a real render

      const r = resolve(name, age);
      const { cardEl, nameEl } = active;

      if (r.status === 'hit') {
        const cfg = VOTE_BADGE[r.rec.their_vote];
        if (cfg) {
          render(cardEl, nameEl, 'id:' + r.rec.user_id,
            `[${cfg.text}]${enrichmentChips(r.rec)}`, cfg.color);
        } else {
          render(cardEl, nameEl, 'unk:' + r.rec.user_id, '[UNKNOWN]', NEUTRAL);
        }
      } else if (r.status === 'ambiguous') {
        render(cardEl, nameEl, 'amb:' + name + age, '[UNCERTAIN — duplicate name]', NEUTRAL);
      } else if (haveData()) {
        render(cardEl, nameEl, 'new:' + name + age, '[NEW PROFILE]', '#3b82f6');
      } else if (suspectBroken) {
        render(cardEl, nameEl, 'nodata', '[NO DATA — extension may be broken]', NEUTRAL);
      } else {
        clearBadge(); // still loading: assert nothing
      }
    } catch (e) {
      if (DEBUG) console.error('[BE] process failed', e);
    }
  };

  // ── Scheduler (one coalesced pass per burst) ─────────────────
  let scheduled = false;
  let settleTimer = null;
  const schedule = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; processEncounter(); });
    }, DOM_SETTLE_MS);
  };

  // ── Persistence (the durable "burn book") ────────────────────
  let writeTimer = null;
  const persist = () => {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      try {
        chrome.storage && chrome.storage.local.set({ [STORAGE_KEY]: Array.from(byId.values()) });
      } catch (e) { if (DEBUG) console.error('[BE] persist', e); }
    }, 1000);
  };

  const hydrate = () => {
    try {
      if (!chrome.storage) return;
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const arr = data && data[STORAGE_KEY];
        if (Array.isArray(arr)) {
          arr.forEach(remember);
          log('hydrated', arr.length);
          schedule();
        }
      });
    } catch (e) { if (DEBUG) console.error('[BE] hydrate', e); }
  };

  // ── Data bridge ──────────────────────────────────────────────
  window.addEventListener(CHANNEL, (event) => {
    const results = event.detail;
    if (!Array.isArray(results)) return;
    liveReceived = true;
    results.forEach((rec) => {
      try { remember(rec); } catch (e) { if (DEBUG) console.error('[BE] bad record', e); }
    });
    log('cached batch', results.length, 'total', byId.size);
    persist();
    schedule();
  });

  // ── Observe the deck ─────────────────────────────────────────
  const startObserver = () => {
    const root =
      document.querySelector('.encounters-album') ||
      document.querySelector('main') ||
      document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    log('observing', root === document.body ? 'body' : 'encounters root');
  };

  hydrate();
  startObserver();
  // Pull any batch page.js buffered before we were listening.
  window.dispatchEvent(new CustomEvent(CHANNEL + ':pull'));
  // If no data ever arrives, surface a broken state instead of lying.
  setTimeout(() => { if (!liveReceived) { suspectBroken = true; schedule(); } }, BROKEN_AFTER_MS);
  log('content script ready');
})();
