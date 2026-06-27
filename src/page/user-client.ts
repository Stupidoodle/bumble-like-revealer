// Signed SERVER_GET_USER RPC: the dossier's data source. Lives in the MAIN
// world so it can reuse the page's pre-patch origFetch (never re-entering the
// encounters interceptor) and ride the same-origin session cookie.

import { USER_GET, USER_CHANNEL, USER_RPC, MT_GET_USER } from "../shared/constants";
import { SUPER_PROJECTION } from "../shared/projection";
import { buildUserEnvelope, signBody } from "../shared/rpc";
import { makeLog, makeErr } from "../shared/log";
import type { RawUser, UserReply } from "../shared/types";

const log = makeLog("[BE/page]");
const err = makeErr("[BE/page]");

interface FetchUserResult {
  ok: boolean;
  status: number;
  ms: number;
  user: RawUser | null;
}

// Signs and POSTs the EXACT byte string it hashes, so server-side re-derivation
// of X-Pingback always matches.
async function fetchUser(origFetch: typeof fetch, userId: unknown): Promise<FetchUserResult> {
  const env = buildUserEnvelope(userId);
  const s = JSON.stringify(env);
  const url = location.origin + "/mwebapi.phtml?" + USER_RPC;
  const t0 = performance.now();
  const res = await origFetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-use-session-cookie": "1",
      "X-Pingback": signBody(s),
      "X-Message-type": String(MT_GET_USER),
    },
    body: s,
  });
  const ms = Math.round(performance.now() - t0);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  const user: RawUser | null =
    ((json && json.body) || []).map((m: any) => m && m.user).find(Boolean) || null;
  return { ok: res.ok && !!user, status: res.status, ms, user };
}

function countPopulated(user: RawUser | null): number {
  if (!user) return 0;
  return Object.keys(user).filter((k) => {
    const v = (user as Record<string, unknown>)[k];
    return v != null && !(Array.isArray(v) && v.length === 0);
  }).length;
}

export function installUserClient(origFetch: typeof fetch): void {
  window.addEventListener(USER_GET, async (e) => {
    const detail = (e as CustomEvent).detail || {};
    const { user_id, reqId } = detail as { user_id: unknown; reqId: string };
    const requested = SUPER_PROJECTION.length;
    try {
      const { ok, status, ms, user } = await fetchUser(origFetch, user_id);
      const populated = countPopulated(user);
      log("GET_USER", status, ms + "ms", populated + "/" + requested);
      const reply: UserReply = {
        reqId, ok, user, meta: { status, ms, populated, requested },
      };
      window.dispatchEvent(new CustomEvent(USER_CHANNEL, { detail: reply }));
    } catch (error) {
      err("GET_USER failed", error);
      const reply: UserReply = {
        reqId, ok: false, user: null,
        error: String((error as Error)?.message || error),
        meta: { status: 0, ms: 0, populated: 0, requested },
      };
      window.dispatchEvent(new CustomEvent(USER_CHANNEL, { detail: reply }));
    }
  });
}
