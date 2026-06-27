// Runs in the Bumble page's own context (MAIN-world content script,
// injected at document_start) so it can patch fetch/XHR before the SPA
// fires its first request. It only reads the SERVER_GET_ENCOUNTERS
// response and forwards a slimmed copy to the content script.
(function () {
  'use strict';

  // ── Debug gate (off in shipped code) ─────────────────────────
  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log('[BE/page]', ...a); };

  // Bridge channel to the content script (isolated world). The payload
  // is slimmed to only the fields the badge needs, so nothing beyond
  // what is already on screen is exposed to other page scripts.
  const CHANNEL = '__be_encounters';
  const ENCOUNTERS_RPC = 'SERVER_GET_ENCOUNTERS';
  const URL_KEY = Symbol('be_url');

  // Last slim batch, so a content script that loads after the first
  // response can pull it on demand (request/replay).
  let buffer = [];

  const slimResults = (results) =>
    results
      .map((r) => r && r.user)
      .filter(Boolean)
      .map((u) => ({
        user_id: u.user_id,
        name: u.name,
        age: u.age,
        their_vote: u.their_vote,
        // Free enrichment already present in the encounters payload.
        is_verified: u.is_verified,
        online_status: u.online_status,
        is_match: u.is_match,
        is_crush: u.is_crush,
        is_hot: u.is_hot,
      }));

  const emit = (data) => {
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: data }));
  };

  const emitEncounters = (results) => {
    buffer = slimResults(results);
    log('emit', buffer.length, 'encounters');
    emit(buffer);
  };

  // Replay buffered data for a late-loading content script.
  window.addEventListener(CHANNEL + ':pull', () => emit(buffer));

  // Extract encounters from a parsed mwebapi response, tolerant of
  // batch reordering and minor shape drift (encounters is not
  // guaranteed to sit at body[0]).
  const extractResults = (json) => {
    const body = (json && json.body) || [];
    if (!Array.isArray(body)) return null;
    const msg = body.find(
      (m) => m && m.client_encounters && Array.isArray(m.client_encounters.results)
    );
    if (msg) return msg.client_encounters.results;
    // Fallback: any nested {results:[{user, their_vote}]} shape.
    for (const m of body) {
      if (m && typeof m === 'object') {
        for (const v of Object.values(m)) {
          if (
            v && Array.isArray(v.results) &&
            v.results.some((r) => r && r.user && 'their_vote' in r.user)
          ) {
            return v.results;
          }
        }
      }
    }
    return null;
  };

  const handlePayload = (json, source) => {
    try {
      const results = extractResults(json);
      if (Array.isArray(results)) emitEncounters(results);
      else log('no encounter results in', source);
    } catch (e) {
      if (DEBUG) console.error('[BE/page] parse failed', source, e);
    }
  };

  // fetch's first arg can be a string, Request, or URL.
  const toUrl = (input) => {
    if (typeof input === 'string') return input;
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    if (input && input.href) return String(input.href);
    return input == null ? '' : String(input);
  };

  // ── Patch fetch ──────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      // URL guard first so non-encounter responses are never cloned.
      const url = toUrl(args[0]);
      if (url.includes(ENCOUNTERS_RPC)) {
        handlePayload(await res.clone().json(), 'fetch');
      }
    } catch (e) {
      if (DEBUG) console.error('[BE/page] fetch hook', e);
    }
    return res;
  };

  // ── Patch XHR ────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this[URL_KEY] = toUrl(url);
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this[URL_KEY];
    if (url && url.includes(ENCOUNTERS_RPC)) {
      this.addEventListener('load', function () {
        try {
          handlePayload(JSON.parse(this.responseText), 'xhr');
        } catch (e) {
          if (DEBUG) console.error('[BE/page] xhr hook', e);
        }
      });
    }
    return origSend.apply(this, args);
  };

  // ═══════════════════════════════════════════════════════════════
  // Phase 2 - signed SERVER_GET_USER RPC (profile dossier data source)
  //
  // A second RPC client living in the SAME MAIN-world IIFE so it can
  // reuse the already-captured origFetch (line 98) and never re-enter
  // the patched window.fetch interceptor above. The encounters hook,
  // the '__be_encounters' channel and its ':pull' replay are untouched.
  // ───────────────────────────────────────────────────────────────
  const USER_GET = '__be_user:get';   // content -> page (request)
  const USER_CHANNEL = '__be_user';   // page -> content (reply)
  const USER_RPC = 'SERVER_GET_USER';
  const MT_GET_USER = 403;
  const PINGBACK_SALT = 'whitetelevisionbulbelectionroofhorseflying';
  // Keep in sync with content.js BE_PUBLIC_SAFE (default false). When true, the
  // three de-anonymizing projection ids (520 distance, 602, 900) are dropped
  // below so they are never even requested from the server.
  const BE_PUBLIC_SAFE = false;
  // 95-id SUPER_PROJECTION (mirrors bumble_api client.py SUPER_PROJECTION).
  const SUPER_PROJECTION = (function () {
    const base = [
      12, 42, 91, 93, 100, 200, 210, 220, 230, 231, 240, 250, 260, 280, 290,
      291, 300, 304, 305, 310, 311, 330, 331, 333, 340, 341, 370, 380, 382,
      400, 471, 480, 490, 492, 493, 494, 520, 530, 531, 540, 550, 560, 570,
      580, 582, 583, 584, 585, 586, 590, 591, 592, 600, 602, 610, 620, 630,
      640, 650, 660, 662, 670, 700, 732, 733, 762, 763, 790, 850, 860, 880,
      890, 900, 911, 912, 930, 1110, 1140, 1150, 1160, 1161, 1162, 1163, 1210,
      1251, 1253, 1262, 1422, 1423, 1424, 1433, 1437, 1447, 1452, 1482,
    ];
    if (!BE_PUBLIC_SAFE) return base;
    const drop = { 520: 1, 602: 1, 900: 1 };
    return base.filter((id) => !drop[id]);
  })();
  // Mirrors client.py CHAT_ALBUM_REQUESTS (preview + large photo urls).
  const ALBUM_REQUESTS = [
    {
      count: 10,
      offset: 1,
      album_type: 2,
      photo_request: { return_preview_url: true, return_large_url: true },
    },
  ];
  let userMsgId = 1000; // own counter band, will not collide with encounters

  // ── Bundled hex-MD5 (crypto.subtle has no MD5) ───────────────
  // Hashes the UTF-8 bytes of the input string and returns lowercase
  // hex. Validated against Python hashlib.md5 (auth.py) for the empty
  // string, ascii, non-ascii, emoji, and a real envelope+salt body.
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const MD5_K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) MD5_K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

  const md5 = (str) => {
    const msg = new TextEncoder().encode(str); // UTF-8 bytes
    const rotl = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0;
    let padded = msg.length + 1;
    while (padded % 64 !== 56) padded++;
    padded += 8;
    const buf = new Uint8Array(padded);
    buf.set(msg);
    buf[msg.length] = 0x80;
    const dv = new DataView(buf.buffer);
    const bits = msg.length * 8;
    dv.setUint32(padded - 8, bits >>> 0, true);
    dv.setUint32(padded - 4, Math.floor(bits / 4294967296) >>> 0, true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < padded; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + MD5_K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, MD5_S[i])) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const hex = (n) => {
      let h = '';
      for (let i = 0; i < 4; i++) h += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return h;
    };
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  };

  // ── Envelope (mirrors client.py get_user lines 419-452 exactly) ──
  const buildEnvelope = (user_id) => ({
    '$gpb': 'badoo.bma.BadooMessage',
    body: [{
      message_type: MT_GET_USER,
      server_get_user: {
        user_id: user_id, // ORIGINAL type from the cached encounters record
        user_field_filter: { projection: SUPER_PROJECTION, request_albums: ALBUM_REQUESTS },
        client_source: 7,
      },
    }],
    message_id: userMsgId++,
    message_type: MT_GET_USER,
    version: 1,
    is_background: false,
  });

  // ── Sign + POST (the EXACT byte string is signed AND posted) ─────
  const fetchUser = async (user_id) => {
    const env = buildEnvelope(user_id);
    const s = JSON.stringify(env); // compact, no spaces, ensure_ascii=false equivalent
    const pingback = md5(s + PINGBACK_SALT);
    const url = location.origin + '/mwebapi.phtml?' + USER_RPC;
    const t0 = performance.now();
    const res = await origFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-use-session-cookie': '1',
        'X-Pingback': pingback,
        'X-Message-type': String(MT_GET_USER),
      },
      body: s,
    });
    const ms = Math.round(performance.now() - t0);
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
    // Response: first body[].user (client.py lines 448-452).
    const user = ((json && json.body) || []).map((m) => m && m.user).find(Boolean) || null;
    return { ok: res.ok && !!user, status: res.status, ms, user };
  };

  // ── Bridge (request/reply, correlated by reqId, replies once) ────
  window.addEventListener(USER_GET, async (e) => {
    const d = e.detail || {};
    const { user_id, reqId } = d;
    try {
      const { ok, status, ms, user } = await fetchUser(user_id);
      // Count populated fields for the header status line ('85/95').
      const populated = user
        ? Object.keys(user).filter((k) => {
            const v = user[k];
            return v != null && !(Array.isArray(v) && v.length === 0);
          }).length
        : 0;
      log('GET_USER', status, ms + 'ms', populated + '/' + SUPER_PROJECTION.length);
      window.dispatchEvent(new CustomEvent(USER_CHANNEL, {
        detail: { reqId, ok, user, meta: { status, ms, populated, requested: SUPER_PROJECTION.length } },
      }));
    } catch (err) {
      if (DEBUG) console.error('[BE/page] GET_USER failed', err);
      window.dispatchEvent(new CustomEvent(USER_CHANNEL, {
        detail: {
          reqId, ok: false, user: null,
          error: String((err && err.message) || err),
          meta: { status: 0, ms: 0, populated: 0, requested: SUPER_PROJECTION.length },
        },
      }));
    }
  });

  log('page hook installed');
})();
