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

  // Accent tokens shared with the Phase 2 dossier so one fact never reads
  // green in the badge and honey in the rail. Honey = LIKED/MATCH (dossier
  // --be-honey); muted warm ink = PASSED/NEW/NEUTRAL/UNCERTAIN/NO-DATA
  // (dossier --be-ink-mute); the online-green #45D27A (dossier --be-online)
  // is carried by the green enrichment emoji, the only green left on the badge.
  const BADGE_HONEY = '#F6B23C';
  const BADGE_MUTE = '#ADA9A0';
  const VOTE_BADGE = {
    [THEIR_VOTE.NOT_VOTED]:    { text: 'NOT VOTED',    color: BADGE_MUTE },
    [THEIR_VOTE.LIKED_YOU]:    { text: 'LIKED YOU ❤️', color: BADGE_HONEY },
    [THEIR_VOTE.REJECTED_YOU]: { text: 'PASSED 💔',    color: BADGE_MUTE },
  };
  const NEUTRAL = BADGE_MUTE;

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
  // instead of guessing. The badge must never assert a wrong vote.
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

  const render = (cardEl, nameEl, key, text, color, rec) => {
    if (key === lastBadgeKey && document.getElementById(BADGE_ID)) return; // no churn
    document.querySelectorAll('#' + BADGE_ID).forEach((b) => b.remove());
    const badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.style.cssText = `margin-left:8px;font-weight:700;font-size:15px;color:${color};text-shadow:0 1px 3px rgba(0,0,0,0.85);`;
    badge.textContent = text;
    // Phase 2 (additive): when a cached record backs this badge, arm it as
    // the sole, lazy trigger for the profile dossier. Existing text/color/
    // churn-guard logic above is untouched.
    if (rec && rec.user_id != null && typeof openDossier === 'function') {
      ensureStyle();
      badge.style.cursor = 'pointer';
      badge.title = 'Open dossier (Cmd/Ctrl+D)';
      badge.classList.add('be-badge--armed');
      // Bumble's card name container is pointer-events:none (click-through), which
      // the badge inherits, so real mouse clicks pass straight through it to
      // Bumble's nav overlay behind. Force the armed badge clickable and above the
      // card overlays so its open-dossier click actually lands. (Synthetic .click()
      // skips hit-testing, which is why this was invisible until a real click.)
      badge.style.pointerEvents = 'auto';
      badge.style.position = 'relative';
      badge.style.zIndex = '2147483000';
      badge._rec = rec;
      // Open on pointerdown (the FIRST event of the gesture) and stop it there,
      // so Bumble's own card handlers never fire on mousedown and re-render/move
      // the badge mid-gesture (which swallows a plain click, so the dossier never
      // opened on a real mouse click). Swallow the trailing mousedown/click too.
      const openFromBadge = (e) => {
        e.stopPropagation();
        e.preventDefault();
        try { openDossier(rec.user_id); }
        catch (err) { if (DEBUG) console.error('[BE] open dossier', err); }
      };
      badge.addEventListener('pointerdown', openFromBadge);
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      badge.addEventListener('mousedown', swallow);
      badge.addEventListener('click', swallow);
    }
    (nameEl.parentElement || cardEl).appendChild(badge);
    lastBadgeKey = key;
  };

  const processEncounter = () => {
    try {
      // If the deck advanced while the rail is open, resync (or close) it so
      // the footer never refetches/retries a profile the owner swiped past.
      if (railOpen) syncRailToActive();
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
            `[${cfg.text}]${enrichmentChips(r.rec)}`, cfg.color, r.rec);
        } else {
          render(cardEl, nameEl, 'unk:' + r.rec.user_id, '[UNKNOWN]', NEUTRAL, r.rec);
        }
      } else if (r.status === 'ambiguous') {
        render(cardEl, nameEl, 'amb:' + name + age, '[UNCERTAIN · duplicate name]', NEUTRAL);
      } else if (haveData()) {
        render(cardEl, nameEl, 'new:' + name + age, '[NEW PROFILE]', BADGE_MUTE);
      } else if (suspectBroken) {
        render(cardEl, nameEl, 'nodata', '[NO DATA · extension may be broken]', NEUTRAL);
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
    // Ignore mutations that originate inside our own overlays (rail, lightbox,
    // scrim) so opening or scrolling the dossier never re-triggers a deck pass.
    const fromOurUi = (n) => {
      const el = n && n.nodeType === 1 ? n : (n && n.parentElement);
      return !!(el && el.closest && el.closest('#be-dossier,#be-lightbox,#be-dossier-scrim'));
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (!fromOurUi(m.target)) { schedule(); return; }
      }
    }).observe(root, { childList: true, subtree: true });
    log('observing', root === document.body ? 'body' : 'encounters root');
  };

  // ═══════════════════════════════════════════════════════════════
  // Phase 2 - PROFILE DOSSIER (premium right-rail HUD)
  //
  // A lazy, on-demand readout of EVERYTHING SERVER_GET_USER returns for
  // the profile the owner is already viewing. Mounted on document.body
  // (never inside Bumble's recycled .encounters-story-profile subtree).
  // One signed GET_USER per explicit open, never per card. Track A's
  // encounters channel, observer, scheduler, badge and persistence are
  // all left intact; this block is purely additive.
  // ───────────────────────────────────────────────────────────────
  const USER_GET = '__be_user:get';
  const USER_CHANNEL = '__be_user';
  const RAIL_ID = 'be-dossier';
  const STYLE_ID = 'be-dossier-style';
  const LIGHTBOX_ID = 'be-lightbox';
  const SCRIM_ID = 'be-dossier-scrim';
  const FETCH_TIMEOUT = 9000;
  // Default false = show EVERYTHING (the owner's own tool, no redaction).
  // When true, the three de-anonymizing fields (precise distance in
  // metres, is_teleported, blocked_you) are omitted from the DOM entirely
  // so a public-repo build matches the README's privacy promise.
  const BE_PUBLIC_SAFE = false;
  const FULL_CACHE_LIMIT = 50;       // cap in-memory/persisted full records
  const FULL_STORAGE_KEY = 'be_full_cache_v1';
  const NARROW = 1180;               // px: below this the rail overlays + scrims

  let railOpen = false, currentUserId = null, currentReqId = null, seq = 0, fetchTimer = null;
  let railEl = null, statusEl = null, heroEl = null, bodyEl = null, footerEl = null, footerCacheEl = null, scrimEl = null;
  let lightboxEl = null, lightboxImg = null, lightboxPhotos = [], lightboxIndex = 0, lightboxReturnFocus = null;
  let lastFocus = null;
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');

  // Full records live here (in-memory LRU + own persisted cache) so the
  // existing slim STORAGE_KEY write stays small and unchanged.
  const fullById = new Map();        // String(user_id) -> merged full record

  const GENDER = { 1: 'Male', 2: 'Female', 3: 'Non-binary' };
  const GAME_MODE = { 0: 'Dating', 1: 'BFF', 5: 'Bizz' };
  const PERM_FLAGS = [
    ['allow_chat', 'chat'], ['allow_spark', 'spark'], ['allow_crush', 'crush'],
    ['allow_voting', 'voting'], ['allow_add_to_favourites', 'add fav'],
    ['is_locked', 'locked'], ['is_favourite', 'favourite'], ['is_conversation', 'conversation'],
    ['is_friend', 'friend'], ['is_blocked', 'blocked'], ['blocked_you', 'blocked you'],
    ['is_unread', 'unread'], ['has_finished_onboarding', 'onboarded'],
  ];

  // ── DOM helper (no innerHTML with remote strings; text via textContent) ──
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return el;
  };

  const isEditable = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
  };

  // ── Value formatters (defensive: unknown shapes collapse to null) ────
  const strOf = (x) => {
    if (x == null) return null;
    if (typeof x === 'string') return x.trim() || null;
    if (typeof x === 'number') return String(x);
    return x.text || x.value || x.display_value || x.name || x.phrase || null;
  };
  const numOr = (v) => (v == null ? null : v);
  const arrStrings = (x) => {
    if (!x) return [];
    return (Array.isArray(x) ? x : [x]).map((i) => strOf(i)).filter(Boolean);
  };
  const midEllipsis = (s, max) => {
    s = String(s); max = max || 22;
    if (s.length <= max) return s;
    const keep = Math.floor((max - 1) / 2);
    return s.slice(0, keep) + '…' + s.slice(s.length - keep);
  };
  const relTime = (ts) => {
    if (ts == null) return null;
    let n = Number(ts);
    if (!isFinite(n) || n <= 0) return null;
    if (n < 1e12) n *= 1000; // seconds -> ms
    const diff = n - Date.now();
    const mins = Math.round(Math.abs(diff) / 60000);
    const hrs = Math.round(Math.abs(diff) / 3600000);
    const days = Math.round(Math.abs(diff) / 86400000);
    if (mins < 1) return 'just now';
    const s = mins < 60 ? mins + 'm' : hrs < 24 ? hrs + 'h' : days + 'd';
    return diff < 0 ? s + ' ago' : 'in ' + s;
  };
  const fmtDob = (dob) => {
    if (!dob) return null;
    if (typeof dob === 'string') return dob;
    const y = dob.year, m = dob.month, d = dob.day;
    if (y && m && d) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return null;
  };
  const photoUrl = (p, prefer) => {
    if (!p) return null;
    if (typeof p === 'string') return p;
    const keys = prefer === 'large'
      ? ['large_url', 'large_photo_url', 'url', 'preview_url', 'preview_photo_url']
      : ['preview_url', 'preview_photo_url', 'url', 'large_url', 'large_photo_url'];
    for (const k of keys) if (p[k]) return p[k];
    if (p.photo) return photoUrl(p.photo, prefer);
    return null;
  };
  const flattenPhotos = (albums) => {
    const out = [];
    if (!Array.isArray(albums)) return out;
    for (const al of albums) {
      const photos = (al && (al.photos || al.photo)) || [];
      if (Array.isArray(photos)) for (const ph of photos) out.push(ph);
    }
    return out;
  };
  const locStr = (x) => {
    if (!x) return null;
    if (typeof x === 'string') return x;
    return x.name || x.display_value || (x.city && (x.city.name || x.city)) || x.text || null;
  };
  const residenceStr = (r) => {
    if (!r) return null;
    if (typeof r === 'string') return r;
    const get = (o) => (o && (typeof o === 'string' ? o : o.name)) || null;
    const parts = [get(r.country), get(r.region), get(r.city)].filter((p) => p && typeof p === 'string');
    return parts.length ? parts.join(' · ') : (r.name || null);
  };

  // ── Verdict ──────────────────────────────────────────────────────────
  const verdictInfo = (rec) => {
    rec = rec || {};
    if (rec.is_match) return { text: 'MATCH', cls: 'match', emoji: '' };
    const tv = rec.their_vote;
    if (tv === THEIR_VOTE.LIKED_YOU) return { text: 'LIKED YOU', cls: 'liked', emoji: '❤️' };
    if (tv === THEIR_VOTE.REJECTED_YOU) return { text: 'PASSED', cls: 'passed', emoji: '💔' };
    if (tv === THEIR_VOTE.NOT_VOTED) return { text: 'NEW', cls: 'new', emoji: '' };
    return { text: 'UNKNOWN', cls: 'new', emoji: '' };
  };
  const myVoteText = (rec) => {
    const mv = rec && rec.my_vote;
    if (mv === 2) return 'liked';
    if (mv === 3) return 'passed';
    return '-';
  };

  // ── Small render primitives ──────────────────────────────────────────
  const section = (title, ...kids) => h('div', { class: 'be-section' },
    h('div', { class: 'be-sec-head', text: title }), ...kids.filter(Boolean));

  const row = (label, value, opts) => {
    opts = opts || {};
    const provided = value != null && value !== '';
    if (opts.flag) {
      const wrap = h('span', { class: 'be-val be-mono' },
        h('span', { class: 'be-sens', title: 'de-anonymizing: omitted in public build', 'aria-label': 'de-anonymizing: omitted in public build', text: '⚑ ' }),
        document.createTextNode(provided ? String(value) : 'not provided'));
      return h('div', { class: 'be-row' }, h('span', { class: 'be-label', text: label }), wrap);
    }
    const valEl = h('span', {
      class: 'be-val' + (opts.mono ? ' be-mono' : '') + (provided ? '' : ' be-faint'),
      text: provided ? String(value) : 'not provided',
    });
    return h('div', { class: 'be-row' }, h('span', { class: 'be-label', text: label }), valEl);
  };

  const chip = (text, kind) => h('span', {
    class: 'be-chip ' + (kind === 'seal' ? 'be-chip-seal' : kind === 'honey' ? 'be-chip-honey' : 'be-chip-outline'),
    text: text,
  });
  const chipRow = (...chips) => {
    const real = chips.filter(Boolean);
    return real.length ? h('div', { class: 'be-chip-row' }, ...real) : null;
  };

  const copyRow = (label, value) => {
    const valEl = h('button', { class: 'be-copy be-mono', type: 'button', title: 'Click to copy', text: midEllipsis(value) });
    valEl.addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(String(value));
        const prev = midEllipsis(value);
        valEl.textContent = '✓ copied';
        valEl.classList.add('be-copied');
        setTimeout(() => { valEl.textContent = prev; valEl.classList.remove('be-copied'); }, 1100);
      } catch (e) { /* clipboard blocked */ }
    });
    return h('div', { class: 'be-row' }, h('span', { class: 'be-label', text: label }), valEl);
  };

  const collapsible = (title, content, opts) => {
    opts = opts || {};
    const expanded = !!opts.expanded;
    const head = h('button', { class: 'be-acc-head' + (expanded ? ' be-open' : ''), type: 'button', 'aria-expanded': String(expanded) },
      h('span', { class: 'be-acc-title', text: title }),
      opts.summary ? h('span', { class: 'be-acc-summary', text: opts.summary }) : null,
      h('span', { class: 'be-chev', 'aria-hidden': 'true', text: '›' }));
    const wrap = h('div', { class: 'be-acc-body' + (expanded ? ' be-open' : '') }, content);
    head.addEventListener('click', () => {
      const now = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!now));
      head.classList.toggle('be-open', !now);
      wrap.classList.toggle('be-open', !now);
    });
    return h('div', { class: 'be-acc' }, head, wrap);
  };

  const animateCount = (el, to) => {
    to = Number(to) || 0;
    if (prefersReduced.matches || to <= 0) { el.textContent = String(to); return; }
    const dur = 900, t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ── HERO (shared across loading / error / full) ──────────────────────
  const renderHero = (rec) => {
    rec = rec || {};
    heroEl.textContent = '';
    const v = verdictInfo(rec);

    const purl = photoUrl(rec.profile_photo, 'preview');
    const thumb = h('div', { class: 'be-hero-photo' },
      purl ? h('img', { src: purl, alt: '', loading: 'lazy' }) : h('div', { class: 'be-hero-photo-empty', 'aria-hidden': 'true' }));

    const tag = h('span', { class: 'be-verdict be-v-' + v.cls },
      h('span', { class: 'be-verdict-txt', text: v.text }),
      v.emoji ? h('span', { class: 'be-verdict-emoji', 'aria-hidden': 'true', text: ' ' + v.emoji }) : null);
    const underline = h('span', { class: 'be-verdict-underline', 'aria-hidden': 'true' });

    const heroChips = [];
    if (rec.is_crush) heroChips.push(chip('⭐ SUPERSWIPED YOU', 'honey'));
    if (rec.is_verified) heroChips.push(chip('VERIFIED ✓', 'seal'));
    if (rec.is_locked) heroChips.push(chip('LOCKED', 'honey'));

    const verdictCol = h('div', { class: 'be-hero-verdict' },
      h('div', { class: 'be-verdict-wrap' }, tag, underline),
      h('div', { class: 'be-hero-sub' }, h('span', { class: 'be-myvote', text: 'you: ' + myVoteText(rec) })),
      heroChips.length ? h('div', { class: 'be-hero-chips' }, ...heroChips) : null);

    let scoreCol = null;
    const score = Number(rec.profile_score_numeric);
    if (isFinite(score) && score > 0) {
      const fig = h('span', { class: 'be-score-fig', text: '0' });
      const fill = h('span', { class: 'be-score-fill' });
      scoreCol = h('div', { class: 'be-hero-score be-score-' + v.cls },
        h('div', { class: 'be-score-row' }, fig, h('span', { class: 'be-score-unit', text: '/1000' })),
        h('span', { class: 'be-score-meter' }, fill));
      requestAnimationFrame(() => {
        animateCount(fig, score);
        const pct = Math.max(0, Math.min(100, (score / 1000) * 100));
        if (prefersReduced.matches) fill.style.width = pct + '%';
        else requestAnimationFrame(() => { fill.style.width = pct + '%'; });
      });
    }

    heroEl.appendChild(h('div', { class: 'be-hero-top' }, thumb, verdictCol, scoreCol));
    if (rec.match_message) heroEl.appendChild(h('div', { class: 'be-match-quote', text: '“' + String(rec.match_message) + '”' }));
    if (prefersReduced.matches) underline.classList.add('be-wipe');
    else requestAnimationFrame(() => underline.classList.add('be-wipe'));
  };

  // ── Body sections ────────────────────────────────────────────────────
  const sectionActivity = (rec) => {
    const kids = [];
    const onlineRow = h('div', { class: 'be-row' }, h('span', { class: 'be-label', text: 'Online' }));
    if (rec.online_status === 1) {
      onlineRow.appendChild(h('span', { class: 'be-val be-online-line' },
        h('span', { class: 'be-dot', 'aria-hidden': 'true' }),
        document.createTextNode(rec.online_status_text || 'Online')));
    } else {
      onlineRow.appendChild(h('span', { class: 'be-val' + (rec.online_status_text ? '' : ' be-faint'), text: rec.online_status_text || 'offline' }));
    }
    kids.push(onlineRow);
    const exp = relTime(rec.online_status_expires_at);
    if (exp) kids.push(row('Status expires', exp, { mono: true }));
    const chips = [];
    if (rec.last_riseup_time_message) chips.push(chip('BOOSTING NOW', 'honey'));
    if (rec.is_hot) chips.push(chip('HOT', 'outline'));
    if (rec.is_highlighted) chips.push(chip('HIGHLIGHTED', 'outline'));
    if (rec.is_newbie) chips.push(chip('NEW HERE', 'outline'));
    const cr = chipRow(...chips);
    if (cr) kids.push(cr);
    kids.push(row('Interests', numOr(rec.interests_total), { mono: true }));
    kids.push(row('Photos', numOr(rec.photo_count), { mono: true }));
    kids.push(row('Videos', numOr(rec.video_count), { mono: true }));
    return section('ACTIVITY', ...kids);
  };

  const sectionIdentity = (rec) => {
    const kids = [];
    kids.push(h('div', { class: 'be-row be-row-name' },
      h('span', { class: 'be-name', text: rec.name || 'Unknown' }),
      rec.age != null ? h('span', { class: 'be-age be-mono', text: String(rec.age) }) : null));
    if (rec.profile_caption) kids.push(h('div', { class: 'be-caption', text: String(rec.profile_caption) }));
    const dob = fmtDob(rec.dob);
    if (dob) kids.push(row('Date of birth', dob, { mono: true }));
    const gchips = [];
    if (rec.gender != null) gchips.push(chip(GENDER[rec.gender] || ('gender ' + rec.gender), 'outline'));
    const eg = strOf(rec.extended_gender);
    if (eg) gchips.push(chip(eg, 'outline'));
    const cr = chipRow(...gchips);
    if (cr) kids.push(cr);
    if (rec.encrypted_user_id != null) kids.push(copyRow('Encrypted ID', String(rec.encrypted_user_id)));
    if (rec.user_id != null) kids.push(copyRow('User ID', String(rec.user_id)));
    return section('IDENTITY', ...kids);
  };

  const sectionVerification = (rec) => {
    const kids = [];
    const vi = rec.verified_information || {};
    const methods = Array.isArray(vi.methods) ? vi.methods : [];
    const anything = rec.is_verified || rec.verification_status != null || vi.display_message || methods.length || rec.show_verified_student_banner;
    const topChips = [];
    if (rec.is_verified) topChips.push(chip('VERIFIED ✓', 'seal'));
    if (rec.show_verified_student_banner) topChips.push(chip('STUDENT', 'outline'));
    const cr = chipRow(...topChips);
    if (cr) kids.push(cr);
    if (rec.verification_status != null) kids.push(row('Verification status', rec.verification_status, { mono: true }));
    if (vi.display_message) kids.push(row('Message', vi.display_message));
    if (methods.length) {
      const mc = chipRow(...methods.map((m) => chip(String(strOf(m) || 'method'), 'outline')));
      if (mc) kids.push(mc);
    }
    if (!anything) kids.push(h('div', { class: 'be-row' }, h('span', { class: 'be-val be-faint', text: 'not verified' })));
    return section('VERIFICATION', ...kids);
  };

  const sectionLocation = (rec) => {
    const kids = [];
    if (rec.distance_short) kids.push(h('div', { class: 'be-loc-primary', text: String(rec.distance_short) }));
    if (!BE_PUBLIC_SAFE && rec.distance != null) kids.push(row('Distance', String(rec.distance) + ' m', { mono: true, flag: true }));
    const seen = new Set();
    if (rec.distance_short) seen.add(String(rec.distance_short));
    const pushLoc = (label, v) => { const s = strOf(v); if (s && !seen.has(s)) { seen.add(s); kids.push(row(label, s)); } };
    pushLoc('Area', rec.distance_long);
    pushLoc('Current', rec.current_location_text);
    pushLoc('Location', rec.location_name);
    const city = rec.city && rec.city.name;
    const country = rec.country || {};
    const cparts = [];
    if (city) cparts.push(city);
    if (country.name) cparts.push(country.name);
    let cstr = cparts.join(', ');
    if (country.flag_symbol && cstr) cstr = country.flag_symbol + ' ' + cstr;
    if (country.iso_code) cstr = (cstr ? cstr + ' ' : '') + '(' + country.iso_code + ')';
    if (cstr.trim()) kids.push(row('City / Country', cstr));
    if (rec.hometown) kids.push(row('Hometown', locStr(rec.hometown)));
    if (rec.residence) kids.push(row('Residence', residenceStr(rec.residence)));
    if (rec.travel_location) kids.push(row('Travel', locStr(rec.travel_location)));
    if (!BE_PUBLIC_SAFE && rec.is_teleported) { const tc = chipRow(chip('⚑ TELEPORTED', 'honey')); if (tc) kids.push(tc); }
    if (!kids.length) kids.push(h('div', { class: 'be-row' }, h('span', { class: 'be-val be-faint', text: 'not provided' })));
    return section('LOCATION', ...kids);
  };

  const fieldList = (fields) => {
    if (!Array.isArray(fields)) return [];
    return fields.map((f) => {
      if (!f) return null;
      const label = f.name || f.display_name || f.title || f.type_name || ('field' + (f.type != null ? ' ' + f.type : ''));
      const value = f.display_value || f.value || f.text
        || (Array.isArray(f.values) ? f.values.map(strOf).filter(Boolean).join(', ') : null)
        || strOf(f);
      return row(String(label).trim() || 'field', value);
    }).filter(Boolean);
  };
  const sectionsList = (sections) => {
    if (!Array.isArray(sections)) return [];
    const out = [];
    sections.forEach((s) => {
      if (!s) return;
      const name = s.name || s.title || s.header || null;
      const val = s.display_value || s.value || s.text
        || (Array.isArray(s.items) ? s.items.map(strOf).filter(Boolean).join(', ') : null);
      if (name && val) out.push(row(String(name), val));
      else if (name) out.push(h('div', { class: 'be-sub-head', text: String(name).toUpperCase() }));
      else if (val) out.push(h('div', { class: 'be-row' }, h('span', { class: 'be-val', text: val })));
    });
    return out;
  };
  const expList = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map((it) => {
      if (!it) return null;
      const title = it.name || it.title || it.degree || it.position || it.role || strOf(it);
      const place = it.place || it.school || it.company || it.organisation || it.organization || it.subtitle || it.location;
      const txt = place ? (title ? title + ' @ ' + place : place) : title;
      return txt ? h('div', { class: 'be-exp', text: String(txt) }) : null;
    }).filter(Boolean);
  };
  const trackRow = (title, artist, preview) => {
    const txt = [title, artist].filter(Boolean).join(' · ') || 'track';
    const kids = [];
    if (preview) {
      const btn = h('button', { class: 'be-play', type: 'button', title: 'Preview', 'aria-label': 'Play preview', text: '▸' });
      let audio = null;
      btn.addEventListener('click', () => {
        try {
          if (!audio) audio = new Audio(preview);
          if (audio.paused) { audio.play(); btn.textContent = '❚❚'; audio.onended = () => { btn.textContent = '▸'; }; }
          else { audio.pause(); btn.textContent = '▸'; }
        } catch (e) { /* media blocked */ }
      });
      kids.push(btn);
    }
    kids.push(h('span', { class: 'be-track-txt', text: txt }));
    return h('div', { class: 'be-track' }, ...kids);
  };
  const musicRow = (rec) => {
    const out = [];
    const sp = rec.spotify_mood_song;
    if (sp) {
      const title = sp.name || sp.title || strOf(sp);
      const artist = sp.artist || sp.artist_name || (sp.artists && arrStrings(sp.artists).join(', '));
      const preview = sp.preview_url || sp.preview || (sp.urls && sp.urls.preview);
      out.push(trackRow(title, artist, preview));
    }
    if (Array.isArray(rec.music_services)) rec.music_services.forEach((svc) => {
      if (!svc) return;
      const tracks = svc.tracks || svc.top_artists || svc.items;
      if (Array.isArray(tracks)) tracks.forEach((t) => out.push(trackRow(t.name || t.title || strOf(t), t.artist || t.subtitle, t.preview_url)));
      else out.push(row(svc.name || 'music', strOf(svc) || 'connected'));
    });
    return out.length ? h('div', { class: 'be-sub' }, h('div', { class: 'be-sub-head', text: 'MUSIC' }), ...out) : null;
  };

  const subAccordion = (title, nodes, expanded) => {
    const real = (nodes || []).filter(Boolean);
    if (!real.length) return null;
    return collapsible(title, h('div', { class: 'be-acc-inner' }, ...real), { expanded: !!expanded });
  };

  const sectionProfile = (rec) => {
    const head = [];
    const aboutParts = [];
    if (rec.profile_summary) { const s = strOf(rec.profile_summary); if (s) aboutParts.push(s); }
    arrStrings(rec.displayed_about_me).forEach((a) => aboutParts.push(a));
    if (aboutParts.length) head.push(h('div', { class: 'be-pull', text: aboutParts.join('\n\n') }));
    const tiw = rec.tiw_idea && (rec.tiw_idea.tiw_phrase || rec.tiw_idea.phrase);
    if (tiw) head.push(h('div', { class: 'be-prompt' },
      h('span', { class: 'be-prompt-tag', text: 'PROMPT' }),
      h('span', { class: 'be-prompt-txt', text: String(tiw) })));

    const accs = [];
    accs.push(subAccordion('Profile fields', fieldList(rec.profile_fields), true));
    accs.push(subAccordion('Sections', sectionsList(rec.sections), false));
    const langs = arrStrings(rec.spoken_languages);
    if (langs.length) accs.push(subAccordion('Languages', [chipRow(...langs.map((l) => chip(l, 'outline')))], false));
    accs.push(subAccordion('Education', expList(rec.educations), false));
    accs.push(subAccordion('Work', expList(rec.jobs), false));
    const music = musicRow(rec);
    if (music) accs.push(subAccordion('Music', [music], false));

    const real = accs.filter(Boolean);
    const kids = head.concat(real);
    if (!kids.length) kids.push(h('div', { class: 'be-row' }, h('span', { class: 'be-val be-faint', text: 'not provided' })));
    return section('PROFILE', ...kids);
  };

  const sectionMedia = (rec) => {
    const kids = [];
    const photos = flattenPhotos(rec.albums);
    if (!photos.length && rec.profile_photo) photos.push(rec.profile_photo);
    const nPhotos = rec.photo_count != null ? rec.photo_count : photos.length;
    const nVideo = rec.video_count != null ? rec.video_count : 0;
    kids.push(h('div', { class: 'be-media-cap be-mono', text: nPhotos + ' photos · ' + nVideo + ' video' }));
    const usable = photos.filter((p) => photoUrl(p, 'preview') || photoUrl(p, 'large'));
    if (usable.length) {
      const strip = h('div', { class: 'be-filmstrip' });
      usable.forEach((p, i) => {
        const purl = photoUrl(p, 'preview') || photoUrl(p, 'large');
        const isVid = !!(p.is_video || p.video || p.video_url);
        const btn = h('button', { class: 'be-thumb', type: 'button', 'aria-label': 'Open photo ' + (i + 1) });
        btn.appendChild(h('img', { src: purl, alt: '', loading: 'lazy', 'data-large': photoUrl(p, 'large') || purl }));
        if (isVid) btn.appendChild(h('span', { class: 'be-thumb-vid', 'aria-hidden': 'true', text: '▸' }));
        btn.addEventListener('click', () => openLightbox(usable, i, btn));
        strip.appendChild(btn);
      });
      kids.push(strip);
    } else {
      kids.push(h('div', { class: 'be-row' }, h('span', { class: 'be-val be-faint', text: 'no media' })));
    }
    return section('MEDIA', ...kids);
  };

  const sectionPermissions = (rec) => {
    const grid = h('div', { class: 'be-flag-grid' });
    let lit = 0, total = 0;
    PERM_FLAGS.forEach(([key, label]) => {
      if (key === 'blocked_you' && BE_PUBLIC_SAFE) return;
      total++;
      const on = !!rec[key];
      if (on) lit++;
      grid.appendChild(h('span', { class: 'be-flag' + (on ? ' be-flag-on' : '') },
        key === 'blocked_you' ? h('span', { class: 'be-flag-glyph', title: 'de-anonymizing: omitted in public build', 'aria-label': 'de-anonymizing: omitted in public build', text: '⚑ ' }) : null,
        document.createTextNode(label)));
    });
    const extra = [];
    extra.push(row('Muted until', relTime(rec.muted_until_timestamp) || 'not muted', { mono: true }));
    extra.push(row('Unread', rec.unread_messages_count != null ? rec.unread_messages_count : 0, { mono: true }));
    if (rec.game_mode != null) extra.push(row('Game mode', GAME_MODE[rec.game_mode] != null ? GAME_MODE[rec.game_mode] : rec.game_mode, { mono: true }));
    if (rec.access_level != null) extra.push(row('Access level', rec.access_level, { mono: true }));
    const content = h('div', { class: 'be-perm-content' }, grid, ...extra);
    return h('div', { class: 'be-section' },
      h('div', { class: 'be-sec-head', text: 'PERMISSIONS & STATE' }),
      collapsible('Flags', content, { expanded: false, summary: lit + '/' + total + ' enabled' }));
  };

  // ── State renderers ──────────────────────────────────────────────────
  const setStatusLine = (txt, dim) => {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.classList.toggle('be-status-dim', !!dim);
  };
  const setFooterCache = (txt) => { if (footerCacheEl) footerCacheEl.textContent = txt; };

  const staggerReveal = () => {
    if (prefersReduced.matches) return;
    Array.from(bodyEl.children).slice(0, 8).forEach((k, i) => {
      k.classList.add('be-stagger');
      setTimeout(() => k.classList.add('be-in'), 60 * i);
    });
  };

  const renderSkeleton = () => {
    bodyEl.textContent = '';
    setStatusLine('GET_USER … requesting');
    for (let s = 0; s < 4; s++) {
      const rows = [h('div', { class: 'be-sk be-sk-head' })];
      for (let i = 0; i < 4; i++) rows.push(h('div', { class: 'be-sk-row' },
        h('span', { class: 'be-sk be-sk-label' }), h('span', { class: 'be-sk be-sk-val' })));
      bodyEl.appendChild(h('div', { class: 'be-section' }, ...rows));
    }
  };

  const renderEmptyNoProfile = () => {
    currentUserId = null;
    setStatusLine('no active profile', true);
    renderHero({});
    bodyEl.textContent = '';
    bodyEl.appendChild(h('div', { class: 'be-empty', text: 'No active profile' }));
    setFooterCache('idle');
  };

  const renderError = (err, rec) => {
    setStatusLine('GET_USER failed', true);
    renderHero(rec || fullById.get(String(currentUserId)) || byId.get(String(currentUserId)) || {});
    bodyEl.textContent = '';
    const retry = h('button', { class: 'be-retry', type: 'button', text: '✕ GET_USER failed · ' + String(err) + ' · retry ↻' });
    retry.addEventListener('click', () => { if (currentUserId) { renderSkeleton(); requestUser(currentUserId, true); } });
    bodyEl.appendChild(h('div', { class: 'be-error' }, retry));
    setFooterCache('error');
  };

  const renderFull = (rec, meta, cached) => {
    if (!rec) { renderEmptyNoProfile(); return; }
    if (meta) setStatusLine((cached ? 'GET_USER cached · ' : 'GET_USER ' + (meta.status || 200) + ' · ' + (meta.ms || 0) + 'ms · ') + (meta.populated || 0) + '/' + (meta.requested || 95));
    else setStatusLine('cached');
    renderHero(rec);
    bodyEl.textContent = '';
    bodyEl.appendChild(sectionActivity(rec));
    bodyEl.appendChild(sectionIdentity(rec));
    bodyEl.appendChild(sectionVerification(rec));
    bodyEl.appendChild(sectionLocation(rec));
    bodyEl.appendChild(sectionProfile(rec));
    bodyEl.appendChild(sectionMedia(rec));
    bodyEl.appendChild(sectionPermissions(rec));
    setFooterCache(cached ? 'cached · ↻' : ('live · ' + (meta ? (meta.ms || 0) + 'ms' : '') + ' · ↻'));
    staggerReveal();
  };

  // ── Cache merge (slim Track A fields preserved; full record cached) ───
  const slimFromFull = (u) => ({
    user_id: u.user_id, name: u.name, age: u.age, their_vote: u.their_vote,
    is_verified: u.is_verified, online_status: u.online_status,
    is_match: u.is_match, is_crush: u.is_crush, is_hot: u.is_hot,
  });
  let fullWriteTimer = null;
  const persistFull = () => {
    if (fullWriteTimer) clearTimeout(fullWriteTimer);
    fullWriteTimer = setTimeout(() => {
      fullWriteTimer = null;
      try {
        const capped = Array.from(fullById.values()).slice(-FULL_CACHE_LIMIT);
        chrome.storage && chrome.storage.local.set({ [FULL_STORAGE_KEY]: capped });
      } catch (e) { if (DEBUG) console.error('[BE] persistFull', e); }
    }, 1000);
  };
  const mergeFull = (user, meta) => {
    if (!user || user.user_id == null) return null;
    const id = String(user.user_id);
    const slim = byId.get(id) || {};
    const merged = Object.assign({}, slim, user, { _full: true, _meta: Object.assign({ at: Date.now() }, meta) });
    // Public-safe build: strip the de-anonymizing fields from the STORED record
    // (not just the view), before caching or persisting. Keep textual
    // distance_long/short so the LOCATION section still reads naturally.
    if (BE_PUBLIC_SAFE) { delete merged.distance; delete merged.is_teleported; delete merged.blocked_you; }
    if (fullById.has(id)) fullById.delete(id);
    fullById.set(id, merged);
    while (fullById.size > FULL_CACHE_LIMIT) fullById.delete(fullById.keys().next().value);
    // Re-slim from the MERGED record (not the raw GET_USER payload): encounters
    // fields (their_vote/is_crush/is_match/is_hot) are absent from GET_USER, so
    // slimming the raw user would write their_vote:undefined and corrupt the
    // good encounters record. merged preserves them.
    try { remember(slimFromFull(merged)); persist(); } catch (e) { if (DEBUG) console.error('[BE] remember full', e); }
    persistFull();
    return merged;
  };

  // ── Style injection (one <style>, scoped, no manifest change) ─────────
  const CSS = `
/* Bumble Enhancer dossier HUD. z-index band: #be-dossier 2147483000 sits
   one below 32-bit signed INT_MAX (2147483647). #be-lightbox 2147483001 is
   above the rail; #be-dossier-scrim 2147482999 is below it. */
#be-dossier,#be-dossier *,#be-lightbox,#be-lightbox *,#be-dossier-scrim{box-sizing:border-box;}
#be-dossier{
  --be-honey:#F6B23C;--be-honey-12:rgba(246,178,60,0.12);--be-honey-20:rgba(246,178,60,0.20);--be-honey-line:rgba(246,178,60,0.55);
  --be-online:#45D27A;--be-online-glow:rgba(69,210,122,0.45);
  --be-glass:rgba(13,14,17,0.72);--be-glass-raise:rgba(20,21,25,0.66);--be-backdrop:blur(10px) saturate(118%);
  --be-edge:rgba(255,255,255,0.10);--be-line:rgba(255,255,255,0.075);--be-line-2:rgba(255,255,255,0.14);
  --be-ink:#F3F1EC;--be-ink-mute:#ADA9A0;--be-ink-faint:#8C887F;
  --be-r-xs:2px;--be-r-sm:6px;--be-r-lg:10px;
  --be-shadow:0 10px 44px rgba(0,0,0,0.55),0 2px 10px rgba(0,0,0,0.40);
  --be-sans:-apple-system,BlinkMacSystemFont,'Inter',system-ui,'Segoe UI',sans-serif;
  --be-mono:ui-monospace,'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;
  --be-serif:'Newsreader','Iowan Old Style',Georgia,'Times New Roman',serif;
  position:fixed;top:0;right:0;height:100dvh;width:clamp(340px,30vw,400px);z-index:2147483000;
  display:none;flex-direction:column;
  background:var(--be-glass);background-image:linear-gradient(180deg,rgba(8,9,11,0.88) 0%,rgba(8,9,11,0.97) 100%);
  -webkit-backdrop-filter:var(--be-backdrop);backdrop-filter:var(--be-backdrop);
  border-left:1px solid var(--be-edge);border-top-left-radius:var(--be-r-lg);border-bottom-left-radius:var(--be-r-lg);
  box-shadow:var(--be-shadow);color:var(--be-ink);font-family:var(--be-sans);font-size:13px;line-height:1.4;
  font-variant-numeric:tabular-nums;pointer-events:none;
  transform:translateX(100%);transition:transform 220ms cubic-bezier(0.16,1,0.3,1);contain:layout style;
}
#be-dossier.be-open{transform:translateX(0);}
#be-dossier .be-header,#be-dossier .be-body,#be-dossier .be-footer{pointer-events:auto;}
#be-dossier .be-safe{position:absolute;left:0;right:0;bottom:0;height:88px;pointer-events:none;}
#be-dossier ::selection{background:var(--be-honey-20);}
#be-dossier button{font-family:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0;}
#be-dossier :focus-visible{outline:none;box-shadow:0 0 0 2px var(--be-honey-line);border-radius:var(--be-r-sm);}
/* Header */
#be-dossier .be-header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;padding:0 16px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-status{font:500 11px/1.2 var(--be-mono);letter-spacing:0.04em;text-transform:uppercase;color:var(--be-ink-mute);}
#be-dossier .be-status-dim{color:var(--be-honey);opacity:0.85;}
#be-dossier .be-close{width:24px;height:24px;border-radius:var(--be-r-sm);font-size:14px;color:var(--be-ink-mute);display:flex;align-items:center;justify-content:center;}
#be-dossier .be-close:hover{color:var(--be-ink);background:rgba(255,255,255,0.06);}
/* Hero */
#be-dossier .be-hero{padding:14px 16px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-hero-top{display:flex;gap:12px;align-items:flex-start;}
#be-dossier .be-hero-photo{width:72px;height:72px;flex:0 0 72px;border-radius:var(--be-r-sm);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.10);background:var(--be-glass-raise);}
#be-dossier .be-hero-photo img{width:100%;height:100%;object-fit:cover;display:block;}
#be-dossier .be-hero-photo-empty{width:100%;height:100%;background:linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01));}
#be-dossier .be-hero-verdict{flex:1 1 auto;min-width:0;}
#be-dossier .be-verdict-wrap{display:inline-flex;flex-direction:column;}
#be-dossier .be-verdict{display:inline-flex;align-items:center;font:700 13px/1.1 var(--be-sans);letter-spacing:0.10em;text-transform:uppercase;padding:3px 8px;border-radius:var(--be-r-sm);align-self:flex-start;}
#be-dossier .be-v-liked{color:var(--be-honey);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-v-match{color:#1a1206;background:var(--be-honey);}
#be-dossier .be-v-new{color:var(--be-honey);box-shadow:inset 0 0 0 1px var(--be-honey-line);background:transparent;}
#be-dossier .be-v-passed{color:var(--be-ink-mute);opacity:0.85;}
#be-dossier .be-verdict-underline{display:block;height:1px;width:0;background:var(--be-honey-line);margin-top:3px;transition:width 320ms ease;}
#be-dossier .be-verdict-underline.be-wipe{width:100%;}
#be-dossier .be-hero-sub{margin-top:6px;}
#be-dossier .be-myvote{font:500 11px/1.2 var(--be-mono);color:var(--be-ink-faint);}
#be-dossier .be-hero-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
#be-dossier .be-hero-score{flex:0 0 auto;text-align:right;min-width:84px;}
#be-dossier .be-score-row{display:flex;align-items:baseline;justify-content:flex-end;gap:3px;}
#be-dossier .be-score-fig{font:600 44px/0.9 var(--be-mono);letter-spacing:-0.02em;color:var(--be-ink);}
#be-dossier .be-score-liked .be-score-fig,#be-dossier .be-score-match .be-score-fig{color:var(--be-honey);}
#be-dossier .be-score-passed .be-score-fig{color:var(--be-ink-mute);}
#be-dossier .be-score-unit{font:500 12px/1 var(--be-mono);color:var(--be-ink-faint);}
#be-dossier .be-score-meter{display:block;height:2px;width:100%;background:rgba(255,255,255,0.08);border-radius:var(--be-r-xs);margin-top:6px;overflow:hidden;}
#be-dossier .be-score-fill{display:block;height:100%;width:0;background:var(--be-honey-line);transition:width 900ms ease-out;}
#be-dossier .be-match-quote{margin-top:12px;font:italic 400 14px/1.45 var(--be-serif);color:var(--be-ink-mute);}
/* Body */
#be-dossier .be-body{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding-bottom:96px;}
#be-dossier .be-body::-webkit-scrollbar{display:none;}
#be-dossier .be-section{padding:16px 16px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-sec-head{font:650 10.5px/1 var(--be-sans);letter-spacing:0.16em;text-transform:uppercase;color:var(--be-ink-mute);padding-bottom:10px;margin-bottom:4px;border-bottom:1px solid var(--be-line);}
#be-dossier .be-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-height:28px;padding:3px 0;}
#be-dossier .be-label{font:500 11px/1.3 var(--be-sans);letter-spacing:0.02em;color:var(--be-ink-mute);flex:0 0 auto;}
#be-dossier .be-val{font:500 13px/1.35 var(--be-sans);color:var(--be-ink);text-align:right;word-break:break-word;}
#be-dossier .be-val.be-mono{font-family:var(--be-mono);}
#be-dossier .be-faint{color:var(--be-ink-faint);font-weight:400;}
#be-dossier .be-row-name{align-items:baseline;}
#be-dossier .be-name{font:600 15px/1.2 var(--be-sans);color:var(--be-ink);}
#be-dossier .be-age{font:500 13px/1.2 var(--be-mono);color:var(--be-ink-mute);}
#be-dossier .be-caption{font:400 12px/1.3 var(--be-sans);color:var(--be-ink-faint);padding:2px 0 6px;}
#be-dossier .be-online-line{display:inline-flex;align-items:center;}
#be-dossier .be-dot{width:8px;height:8px;border-radius:50%;background:var(--be-online);display:inline-block;margin-right:7px;flex:0 0 8px;animation:be-pulse 2.4s ease-in-out infinite;}
#be-dossier .be-loc-primary{font:500 13px/1.4 var(--be-sans);color:var(--be-ink);padding:2px 0 6px;}
#be-dossier .be-sens,#be-dossier .be-flag-glyph{color:var(--be-honey);}
/* Chips */
#be-dossier .be-chip-row{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;}
#be-dossier .be-chip{display:inline-flex;align-items:center;font:600 11px/1 var(--be-sans);letter-spacing:0.02em;padding:3px 8px;border-radius:var(--be-r-sm);white-space:nowrap;}
#be-dossier .be-chip-outline{color:var(--be-honey);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-chip-honey{color:var(--be-honey);background:var(--be-honey-12);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-chip-seal{color:var(--be-honey);background:var(--be-honey-12);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
/* Copy */
#be-dossier .be-copy{font:500 12px/1.3 var(--be-mono);color:var(--be-ink);text-align:right;border-radius:var(--be-r-sm);padding:2px 4px;}
#be-dossier .be-copy:hover{background:rgba(255,255,255,0.05);}
#be-dossier .be-copied{color:var(--be-honey);}
/* Accordion */
#be-dossier .be-acc{border-top:1px solid var(--be-line);}
#be-dossier .be-acc:first-child{border-top:none;}
#be-dossier .be-acc-head{display:flex;align-items:center;width:100%;gap:8px;padding:10px 0;text-align:left;}
#be-dossier .be-acc-title{font:600 12px/1 var(--be-sans);color:var(--be-ink);flex:1 1 auto;}
#be-dossier .be-acc-summary{font:500 11px/1 var(--be-mono);color:var(--be-ink-faint);}
#be-dossier .be-chev{font-size:14px;color:var(--be-ink-mute);transition:transform 180ms ease;}
#be-dossier .be-acc-head.be-open .be-chev{transform:rotate(90deg);}
#be-dossier .be-acc-body{display:none;padding-bottom:6px;}
#be-dossier .be-acc-body.be-open{display:block;}
#be-dossier .be-acc-inner>*{margin-top:2px;}
#be-dossier .be-pull{font:400 15px/1.5 var(--be-serif);color:var(--be-ink);white-space:pre-wrap;padding:2px 0 10px;}
#be-dossier .be-prompt{display:flex;flex-direction:column;gap:4px;padding:10px 12px;margin:4px 0 10px;border-radius:var(--be-r-sm);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
#be-dossier .be-prompt-tag{font:700 10px/1 var(--be-sans);letter-spacing:0.14em;color:var(--be-honey);}
#be-dossier .be-prompt-txt{font:italic 400 14px/1.45 var(--be-serif);color:var(--be-ink);}
#be-dossier .be-sub{padding:6px 0;}
#be-dossier .be-sub-head{font:650 10px/1 var(--be-sans);letter-spacing:0.14em;text-transform:uppercase;color:var(--be-ink-faint);padding:6px 0 4px;}
#be-dossier .be-exp{font:500 13px/1.4 var(--be-sans);color:var(--be-ink);padding:3px 0;}
#be-dossier .be-track{display:flex;align-items:center;gap:8px;padding:3px 0;}
#be-dossier .be-track-txt{font:500 13px/1.35 var(--be-sans);color:var(--be-ink);}
#be-dossier .be-play{color:var(--be-honey);font-size:13px;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px var(--be-honey-line);display:flex;align-items:center;justify-content:center;flex:0 0 22px;}
/* Flag matrix */
#be-dossier .be-flag-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;}
#be-dossier .be-flag{display:inline-flex;align-items:center;font:550 10.5px/1 var(--be-mono);letter-spacing:0.02em;color:var(--be-ink-mute);padding:4px 8px;border-radius:var(--be-r-sm);box-shadow:inset 0 0 0 1px var(--be-line-2);}
#be-dossier .be-flag-on{color:var(--be-honey);background:var(--be-honey-12);box-shadow:inset 0 0 0 1px var(--be-honey-line);}
/* Filmstrip */
#be-dossier .be-media-cap{font:500 11px/1 var(--be-mono);color:var(--be-ink-mute);padding:2px 0 10px;}
#be-dossier .be-filmstrip{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;}
#be-dossier .be-filmstrip::-webkit-scrollbar{display:none;}
#be-dossier .be-thumb{position:relative;width:56px;height:72px;flex:0 0 56px;border-radius:var(--be-r-sm);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.10);}
#be-dossier .be-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
#be-dossier .be-thumb-vid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-size:14px;text-shadow:0 1px 4px rgba(0,0,0,0.7);}
/* States */
#be-dossier .be-empty{padding:48px 16px;text-align:center;color:var(--be-ink-faint);font:400 13px/1.4 var(--be-sans);}
#be-dossier .be-error{padding:16px;}
#be-dossier .be-retry{font:500 12px/1.4 var(--be-mono);color:var(--be-honey);text-align:left;padding:8px 10px;border-radius:var(--be-r-sm);box-shadow:inset 0 0 0 1px var(--be-honey-line);width:100%;}
#be-dossier .be-sk{background:linear-gradient(90deg,rgba(246,178,60,0.06) 25%,rgba(246,178,60,0.14) 50%,rgba(246,178,60,0.06) 75%);background-size:400px 100%;animation:be-shimmer 1.2s linear infinite;border-radius:var(--be-r-sm);height:10px;}
#be-dossier .be-sk-head{width:38%;height:9px;margin-bottom:14px;}
#be-dossier .be-sk-row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;}
#be-dossier .be-sk-label{flex:0 0 28%;}
#be-dossier .be-sk-val{flex:0 0 40%;}
/* Footer */
#be-dossier .be-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:36px;padding:0 16px;border-top:1px solid var(--be-line);background:var(--be-glass-raise);padding-bottom:max(0px,env(safe-area-inset-bottom));}
#be-dossier .be-cache{font:500 11px/1.2 var(--be-mono);color:var(--be-ink-mute);}
#be-dossier .be-refetch{width:24px;height:24px;border-radius:var(--be-r-sm);color:var(--be-honey);font-size:14px;display:flex;align-items:center;justify-content:center;}
#be-dossier .be-refetch:hover{background:var(--be-honey-12);}
#be-dossier .be-safe-note{font:500 10px/1 var(--be-mono);color:var(--be-ink-faint);letter-spacing:0.04em;}
/* Stagger */
#be-dossier .be-stagger{opacity:0;transform:translateY(6px);transition:opacity 240ms ease,transform 240ms cubic-bezier(0.16,1,0.3,1);}
#be-dossier .be-stagger.be-in{opacity:1;transform:none;}
/* Scrim (narrow viewports) */
#be-dossier-scrim{position:fixed;inset:0;z-index:2147482999;background:rgba(6,7,9,0.55);display:none;pointer-events:auto;-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px);}
#be-dossier-scrim.be-show{display:block;}
/* Lightbox */
#be-lightbox{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;pointer-events:auto;}
#be-lightbox .be-lb-scrim{position:absolute;inset:0;background:rgba(6,7,9,0.86);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
#be-lightbox .be-lb-img{position:relative;max-width:88vw;max-height:88vh;border-radius:var(--be-r-lg,10px);box-shadow:0 10px 44px rgba(0,0,0,0.6);object-fit:contain;}
#be-lightbox button{position:relative;background:rgba(20,21,25,0.66);color:#F3F1EC;border:none;cursor:pointer;border-radius:50%;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}
#be-lightbox button:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(246,178,60,0.55);}
#be-lightbox .be-lb-close{position:absolute;top:18px;right:18px;width:36px;height:36px;font-size:16px;}
#be-lightbox .be-lb-prev,#be-lightbox .be-lb-next{width:44px;height:44px;font-size:22px;margin:0 10px;}
/* Armed badge (lives in Bumble's DOM; only our id is targeted) */
#be-vote-badge.be-badge--armed{border-radius:6px;padding:1px 6px;background:rgba(8,9,11,0.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);transition:background 140ms ease,box-shadow 140ms ease;}
#be-vote-badge.be-badge--armed:hover{background:rgba(246,178,60,0.12);box-shadow:inset 0 0 0 1px rgba(246,178,60,0.55);}
#be-vote-badge.be-badge--armed:hover::after{content:' \\2318 D';font-size:10px;opacity:0.7;font-family:ui-monospace,Menlo,monospace;}
/* Animations */
@keyframes be-pulse{0%,100%{box-shadow:0 0 0 0 var(--be-online-glow);}50%{box-shadow:0 0 0 4px rgba(69,210,122,0);}}
@keyframes be-shimmer{0%{background-position:-200px 0;}100%{background-position:200px 0;}}
/* Reduced motion: collapse all motion to instant and drop GPU backdrop blur */
#be-dossier.be-rm,#be-dossier.be-rm *{transition:none !important;animation:none !important;}
#be-dossier.be-rm{-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}
@media (prefers-reduced-motion: reduce){
  #be-dossier,#be-dossier *,#be-vote-badge.be-badge--armed{transition:none !important;animation:none !important;}
  #be-dossier .be-dot{animation:none !important;}
  #be-dossier,#be-dossier-scrim,#be-lightbox .be-lb-scrim,#be-lightbox button,#be-vote-badge.be-badge--armed{-webkit-backdrop-filter:none !important;backdrop-filter:none !important;}
}
/* Narrow viewports: the scrim already blurs, so drop the rail's backdrop blur
   to avoid two stacked blurred layers over the animating deck. The raised
   opaque gradient fill keeps text contrast (AA) without it. */
@media (max-width:1179px){
  #be-dossier{-webkit-backdrop-filter:none;backdrop-filter:none;}
}
`;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  };

  // ── Rail + lightbox construction (built once, kept in the DOM) ────────
  const updateResponsive = () => {
    const narrow = window.innerWidth < NARROW;
    if (scrimEl) scrimEl.classList.toggle('be-show', narrow && railOpen);
    if (railEl) {
      if (narrow && railOpen) railEl.setAttribute('aria-modal', 'true');
      else railEl.removeAttribute('aria-modal');
    }
  };

  const ensureRail = () => {
    if (railEl) return;
    scrimEl = h('div', { id: SCRIM_ID, 'aria-hidden': 'true' });
    scrimEl.addEventListener('click', () => closeRail());
    document.body.appendChild(scrimEl);

    statusEl = h('div', { class: 'be-status', text: 'GET_USER' });
    const closeBtn = h('button', { class: 'be-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close dossier', text: '✕' });
    closeBtn.addEventListener('click', () => closeRail());
    const header = h('div', { class: 'be-header' }, statusEl, closeBtn);

    heroEl = h('div', { class: 'be-hero' });
    bodyEl = h('div', { class: 'be-body', tabindex: '-1' });

    footerCacheEl = h('div', { class: 'be-cache', text: 'idle' });
    const refetch = h('button', { class: 'be-refetch', type: 'button', title: 'Refetch', 'aria-label': 'Refetch profile', text: '↻' });
    refetch.addEventListener('click', () => { if (currentUserId) { renderSkeleton(); requestUser(currentUserId, true); } });
    footerEl = h('div', { class: 'be-footer' }, footerCacheEl, refetch);
    if (BE_PUBLIC_SAFE) footerEl.appendChild(h('div', { class: 'be-safe-note', text: 'public-safe build' }));

    const safe = h('div', { class: 'be-safe', 'aria-hidden': 'true' });

    railEl = h('div', { id: RAIL_ID, role: 'dialog', 'aria-label': 'Profile dossier' }, header, heroEl, bodyEl, footerEl, safe);
    if (prefersReduced.matches) railEl.classList.add('be-rm');
    document.body.appendChild(railEl);
  };

  const showRail = () => {
    railOpen = true;
    railEl.style.display = 'flex';
    if (prefersReduced.matches) railEl.classList.add('be-open');
    else requestAnimationFrame(() => requestAnimationFrame(() => railEl.classList.add('be-open')));
    updateResponsive();
    const closeBtn = railEl.querySelector('.be-close');
    if (closeBtn) setTimeout(() => { try { closeBtn.focus(); } catch (e) {} }, prefersReduced.matches ? 0 : 80);
  };

  const closeRail = () => {
    if (!railOpen) return;
    railOpen = false;
    currentReqId = null; // drop any in-flight reply
    if (fetchTimer) { clearTimeout(fetchTimer); fetchTimer = null; }
    railEl.classList.remove('be-open');
    const finish = () => { if (!railOpen) { railEl.style.display = 'none'; if (scrimEl) scrimEl.classList.remove('be-show'); } };
    if (prefersReduced.matches) finish();
    else setTimeout(finish, 200);
    updateResponsive();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  };

  // The deck advanced while the rail is open. Never leave the dossier pinned to
  // a profile the owner already swiped past, or the footer refetch/error-retry
  // would hit the OLD user_id. Re-point from cache only; if the new card has no
  // cached full record, close rather than auto-fetch (one signed GET_USER per
  // explicit open, never per swipe).
  const syncRailToActive = () => {
    try {
      if (!railOpen || currentUserId == null) return;
      const active = getActiveProfile();
      if (!active || !active.nameEl) return;
      const name = active.nameEl.textContent.trim();
      const age = parseAge(active.ageEl);
      if (!name || Number.isNaN(age)) return;
      const r = resolve(name, age);
      const activeId = r.status === 'hit' ? String(r.rec.user_id) : null;
      if (activeId === currentUserId) return;          // still the same profile
      if (activeId == null) { closeRail(); return; }   // ambiguous / unknown card
      const full = fullById.get(activeId);
      if (full && full._full) { currentUserId = activeId; renderFull(full, full._meta, true); }
      else closeRail();
    } catch (e) { if (DEBUG) console.error('[BE] syncRail', e); }
  };

  // ── Lightbox ─────────────────────────────────────────────────────────
  const ensureLightbox = () => {
    if (lightboxEl) return;
    const scrim = h('div', { class: 'be-lb-scrim' });
    scrim.addEventListener('click', () => closeLightbox());
    const prev = h('button', { class: 'be-lb-prev', type: 'button', 'aria-label': 'Previous', text: '‹' });
    prev.addEventListener('click', () => lightboxStep(-1));
    const next = h('button', { class: 'be-lb-next', type: 'button', 'aria-label': 'Next', text: '›' });
    next.addEventListener('click', () => lightboxStep(1));
    lightboxImg = h('img', { class: 'be-lb-img', alt: '' });
    const closeBtn = h('button', { class: 'be-lb-close', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', text: '✕' });
    closeBtn.addEventListener('click', () => closeLightbox());
    lightboxEl = h('div', { id: LIGHTBOX_ID, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer' }, scrim, prev, lightboxImg, next, closeBtn);
    lightboxEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { lightboxStep(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { lightboxStep(1); e.preventDefault(); }
      else if (e.key === 'Tab') {
        const f = Array.from(lightboxEl.querySelectorAll('button'));
        if (!f.length) return;
        let i = f.indexOf(document.activeElement);
        i = e.shiftKey ? i - 1 : i + 1;
        if (i < 0) i = f.length - 1; if (i >= f.length) i = 0;
        f[i].focus(); e.preventDefault();
      }
    });
    document.body.appendChild(lightboxEl);
  };
  const renderLightbox = () => {
    const p = lightboxPhotos[lightboxIndex];
    lightboxImg.src = photoUrl(p, 'large') || '';
    lightboxImg.alt = 'Photo ' + (lightboxIndex + 1) + ' of ' + lightboxPhotos.length;
  };
  const openLightbox = (photos, index, returnFocus) => {
    ensureLightbox();
    lightboxPhotos = photos || []; lightboxIndex = index || 0; lightboxReturnFocus = returnFocus || null;
    renderLightbox();
    lightboxEl.style.display = 'flex';
    lightboxEl.classList.add('be-open');
    const closeBtn = lightboxEl.querySelector('.be-lb-close');
    if (closeBtn) try { closeBtn.focus(); } catch (e) {}
  };
  const lightboxStep = (d) => {
    if (!lightboxPhotos.length) return;
    lightboxIndex = (lightboxIndex + d + lightboxPhotos.length) % lightboxPhotos.length;
    renderLightbox();
  };
  const closeLightbox = () => {
    if (!lightboxEl) return;
    lightboxEl.classList.remove('be-open');
    lightboxEl.style.display = 'none';
    if (lightboxReturnFocus && lightboxReturnFocus.focus) { try { lightboxReturnFocus.focus(); } catch (e) {} }
  };

  // ── Lazy fetch + open flow ───────────────────────────────────────────
  const requestUser = (userId, force) => {
    try {
      // In-flight dedupe: the same profile already has a pending signed
      // GET_USER and this is not a forced refetch -> do not fire a second one.
      if (!force && fetchTimer && currentUserId === String(userId)) return;
      const rec = byId.get(String(userId)) || fullById.get(String(userId));
      const origId = rec ? rec.user_id : userId; // preserve original wire type
      currentReqId = (++seq) + ':' + Date.now();
      setStatusLine('GET_USER … requesting');
      window.dispatchEvent(new CustomEvent(USER_GET, { detail: { user_id: origId, reqId: currentReqId, force: !!force } }));
      if (fetchTimer) clearTimeout(fetchTimer);
      fetchTimer = setTimeout(() => {
        fetchTimer = null;
        renderError('timeout', fullById.get(String(userId)) || byId.get(String(userId)));
      }, FETCH_TIMEOUT);
    } catch (e) { if (DEBUG) console.error('[BE] requestUser', e); }
  };

  const openDossier = (userId) => {
    try {
      let uid = userId;
      if (uid == null) {
        const active = getActiveProfile();
        if (active && active.nameEl) {
          const name = active.nameEl.textContent.trim();
          const age = parseAge(active.ageEl);
          const r = resolve(name, age);
          if (r.status === 'hit') uid = r.rec.user_id;
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
    } catch (e) { if (DEBUG) console.error('[BE] openDossier', e); }
  };

  const toggleDossier = () => { if (railOpen) closeRail(); else openDossier(); };

  // ── Reply listener (correlated by reqId; stale replies dropped) ──────
  window.addEventListener(USER_CHANNEL, (e) => {
    try {
      const d = e.detail;
      if (!d || d.reqId !== currentReqId) return; // stale or not ours
      if (fetchTimer) { clearTimeout(fetchTimer); fetchTimer = null; }
      if (d.ok && d.user) {
        const merged = mergeFull(d.user, d.meta);
        renderFull(merged || fullById.get(String(currentUserId)), d.meta, false);
      } else {
        const st = d.meta && d.meta.status;
        const msg = d.error || (st >= 200 && st < 300 ? 'no user in response' : 'HTTP ' + st);
        renderError(msg, fullById.get(String(currentUserId)) || byId.get(String(currentUserId)));
      }
    } catch (err) { if (DEBUG) console.error('[BE] user reply', err); }
  });

  // ── Global controls: hotkey, Esc, outside-click ──────────────────────
  document.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Escape') {
        if (lightboxEl && lightboxEl.classList.contains('be-open')) { closeLightbox(); e.stopPropagation(); return; }
        if (railOpen) { closeRail(); e.stopPropagation(); }
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
        if (isEditable(document.activeElement)) return;
        e.preventDefault();
        toggleDossier();
      }
    } catch (err) { if (DEBUG) console.error('[BE] keydown', err); }
  }, true);

  document.addEventListener('mousedown', (e) => {
    try {
      if (!railOpen) return;
      const t = e.target;
      if (railEl && railEl.contains(t)) return;
      if (lightboxEl && lightboxEl.contains(t)) return;
      if (t && t.id === BADGE_ID) return; // badge has its own toggle path
      closeRail();
    } catch (err) { /* never throw into Bumble */ }
  }, true);

  window.addEventListener('resize', () => { try { updateResponsive(); } catch (e) {} });
  try {
    prefersReduced.addEventListener('change', () => { if (railEl) railEl.classList.toggle('be-rm', prefersReduced.matches); });
  } catch (e) { /* older Safari */ }

  // Hydrate persisted full records so an in-session reopen is instant.
  try {
    if (chrome.storage) chrome.storage.local.get(FULL_STORAGE_KEY, (data) => {
      const arr = data && data[FULL_STORAGE_KEY];
      if (Array.isArray(arr)) arr.forEach((rec) => {
        if (rec && rec.user_id != null) fullById.set(String(rec.user_id), rec);
      });
    });
  } catch (e) { if (DEBUG) console.error('[BE] hydrate full', e); }

  hydrate();
  startObserver();
  // Pull any batch page.js buffered before we were listening.
  window.dispatchEvent(new CustomEvent(CHANNEL + ':pull'));
  // If no data ever arrives, surface a broken state instead of lying.
  setTimeout(() => { if (!liveReceived) { suspectBroken = true; schedule(); } }, BROKEN_AFTER_MS);
  log('content script ready');
})();
