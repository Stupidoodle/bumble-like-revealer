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

  log('page hook installed');
})();
