// Patches window.fetch and XMLHttpRequest in the page's MAIN world to read
// SERVER_GET_ENCOUNTERS responses and forward a slimmed copy to the content
// script. Runs at document_start so it is installed before the SPA's first
// request.

import { ENCOUNTERS_CHANNEL, ENCOUNTERS_PULL, ENCOUNTERS_RPC } from "../shared/constants";
import { makeLog, makeErr } from "../shared/log";
import type { RawUser, SlimUser } from "../shared/types";

const log = makeLog("[BE/page]");
const err = makeErr("[BE/page]");

const URL_KEY = Symbol("be_url");

// The payload is slimmed to only the fields the badge needs, so nothing beyond
// what is already on screen is exposed to other page scripts.
function slimResults(results: unknown[]): SlimUser[] {
  return results
    .map((r) => (r as { user?: RawUser } | null)?.user)
    .filter((u): u is RawUser => Boolean(u))
    .map((u) => ({
      user_id: u.user_id,
      name: u.name as string | undefined,
      age: u.age as number | undefined,
      their_vote: u.their_vote as number | undefined,
      is_verified: u.is_verified as boolean | undefined,
      online_status: u.online_status as number | undefined,
      is_match: u.is_match as boolean | undefined,
      is_crush: u.is_crush as boolean | undefined,
      is_hot: u.is_hot as boolean | undefined,
    }));
}

// Last slim batch, replayed on demand for a late-loading content script.
let buffer: SlimUser[] = [];

function emit(data: SlimUser[]): void {
  window.dispatchEvent(new CustomEvent(ENCOUNTERS_CHANNEL, { detail: data }));
}

function emitEncounters(results: unknown[]): void {
  buffer = slimResults(results);
  log("emit", buffer.length, "encounters");
  emit(buffer);
}

// Extract encounters from a parsed mwebapi response, tolerant of batch
// reordering and minor shape drift (encounters is not guaranteed at body[0]).
function extractResults(json: any): unknown[] | null {
  const body = (json && json.body) || [];
  if (!Array.isArray(body)) return null;
  const msg = body.find(
    (m: any) => m && m.client_encounters && Array.isArray(m.client_encounters.results),
  );
  if (msg) return msg.client_encounters.results;
  for (const m of body) {
    if (m && typeof m === "object") {
      for (const v of Object.values(m) as any[]) {
        if (
          v && Array.isArray(v.results) &&
          v.results.some((r: any) => r && r.user && "their_vote" in r.user)
        ) {
          return v.results;
        }
      }
    }
  }
  return null;
}

function handlePayload(json: unknown, source: string): void {
  try {
    const results = extractResults(json);
    if (Array.isArray(results)) emitEncounters(results);
    else log("no encounter results in", source);
  } catch (e) {
    err("parse failed", source, e);
  }
}

// fetch's first arg can be a string, Request, or URL.
function toUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  if (input && (input as URL).href) return String((input as URL).href);
  return input == null ? "" : String(input);
}

export function installIntercept(origFetch: typeof fetch): void {
  window.fetch = (async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const res = await origFetch.apply(this as any, args);
    try {
      const url = toUrl(args[0]);
      if (url.includes(ENCOUNTERS_RPC)) {
        handlePayload(await res.clone().json(), "fetch");
      }
    } catch (e) {
      err("fetch hook", e);
    }
    return res;
  }) as typeof window.fetch;

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: any,
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    this[URL_KEY] = toUrl(url);
    return (origOpen as (...a: any[]) => void).apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (this: any, ...args: any[]) {
    const url: string = this[URL_KEY];
    if (url && url.includes(ENCOUNTERS_RPC)) {
      this.addEventListener("load", function (this: XMLHttpRequest) {
        try {
          handlePayload(JSON.parse(this.responseText), "xhr");
        } catch (e) {
          err("xhr hook", e);
        }
      });
    }
    return origSend.apply(this, args as []);
  };

  // Replay buffered data for a late-loading content script.
  window.addEventListener(ENCOUNTERS_PULL, () => emit(buffer));
}
