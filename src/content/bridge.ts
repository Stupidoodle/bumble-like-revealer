// The signed GET_USER bridge: fire one CustomEvent(USER_GET) at the MAIN-world
// client and correlate its reply by reqId. In-flight dedupe lives here; the
// rail state it touches (currentReqId / currentUserId / fetchTimer) is owned by
// dossier.ts and reached through accessors. Registering the reply listener at
// module-eval time keeps it live before the first open, exactly as the monolith
// did.

import { byId, fullById, mergeFull } from "./cache";
import {
  renderFull, renderError, setStatusLine,
  getCurrentUserId, getCurrentReqId, setCurrentReqId,
  getFetchTimer, setFetchTimer,
} from "./dossier";
import { USER_GET, USER_CHANNEL } from "../shared/constants";
import { makeErr } from "../shared/log";

const err = makeErr("[BE]");

const FETCH_TIMEOUT = 9000;
let seq = 0;

// ── Lazy fetch ───────────────────────────────────────────────────────
export const requestUser = (userId: unknown, force?: boolean): void => {
  try {
    // In-flight dedupe: the same profile already has a pending signed GET_USER
    // and this is not a forced refetch -> do not fire a second one.
    if (!force && getFetchTimer() && getCurrentUserId() === String(userId)) return;
    const rec = byId.get(String(userId)) || fullById.get(String(userId));
    const origId = rec ? rec.user_id : userId; // preserve original wire type
    const reqId = (++seq) + ":" + Date.now();
    setCurrentReqId(reqId);
    setStatusLine("GET_USER … requesting");
    window.dispatchEvent(new CustomEvent(USER_GET, { detail: { user_id: origId, reqId, force: !!force } }));
    const existing = getFetchTimer();
    if (existing) clearTimeout(existing);
    setFetchTimer(setTimeout(() => {
      setFetchTimer(null);
      renderError("timeout", fullById.get(String(userId)) || byId.get(String(userId)));
    }, FETCH_TIMEOUT));
  } catch (e) { err("requestUser", e); }
};

// ── Reply listener (correlated by reqId; stale replies dropped) ──────
window.addEventListener(USER_CHANNEL, (e) => {
  try {
    const d = (e as CustomEvent).detail;
    if (!d || d.reqId !== getCurrentReqId()) return; // stale or not ours
    const t = getFetchTimer();
    if (t) { clearTimeout(t); setFetchTimer(null); }
    if (d.ok && d.user) {
      const merged = mergeFull(d.user, d.meta);
      renderFull(merged || fullById.get(String(getCurrentUserId())), d.meta, false);
    } else {
      const st = d.meta && d.meta.status;
      const msg = d.error || (st >= 200 && st < 300 ? "no user in response" : "HTTP " + st);
      renderError(msg, fullById.get(String(getCurrentUserId())) || byId.get(String(getCurrentUserId())));
    }
  } catch (err2) { err("user reply", err2); }
});
