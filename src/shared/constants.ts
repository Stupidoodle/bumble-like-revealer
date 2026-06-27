// Single source of truth for the page<->content contract and the Bumble RPC
// names. page.ts (MAIN world) and content.ts (isolated world) compile to
// separate bundles, but both import these literals, so the event-channel
// strings can never drift between the two halves.

// page -> content: a fresh slim encounters batch.
export const ENCOUNTERS_CHANNEL = "__be_encounters";
// content -> page: replay the last batch (for a late-loading content script).
export const ENCOUNTERS_PULL = "__be_encounters:pull";
// content -> page: fetch one full profile by id.
export const USER_GET = "__be_user:get";
// page -> content: the full-profile reply (correlated by reqId).
export const USER_CHANNEL = "__be_user";

// mwebapi server actions.
export const ENCOUNTERS_RPC = "SERVER_GET_ENCOUNTERS";
export const USER_RPC = "SERVER_GET_USER";
export const MT_GET_USER = 403;
