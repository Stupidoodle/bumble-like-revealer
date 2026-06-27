// Bumble payloads are large and loosely typed; we model only what the extension
// reads and keep the rest open.

export type RawUser = Record<string, unknown> & { user_id?: unknown };

// The slim record forwarded from the encounters interception to the badge.
export interface SlimUser {
  user_id: unknown;
  name?: string;
  age?: number;
  their_vote?: number;
  is_verified?: boolean;
  online_status?: number;
  is_match?: boolean;
  is_crush?: boolean;
  is_hot?: boolean;
}

export interface UserMeta {
  status: number;
  ms: number;
  populated: number;
  requested: number;
}

// page -> content reply for a single full profile.
export interface UserReply {
  reqId: string;
  ok: boolean;
  user: RawUser | null;
  error?: string;
  meta: UserMeta;
}
