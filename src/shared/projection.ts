// The full SUPER_PROJECTION (mirrors bumble_api client.py): every reversed
// UserProjection field id, requested so the dossier shows everything.

const BASE: readonly number[] = [
  12, 42, 91, 93, 100, 200, 210, 220, 230, 231, 240, 250, 260, 280, 290,
  291, 300, 304, 305, 310, 311, 330, 331, 333, 340, 341, 370, 380, 382,
  400, 471, 480, 490, 492, 493, 494, 520, 530, 531, 540, 550, 560, 570,
  580, 582, 583, 584, 585, 586, 590, 591, 592, 600, 602, 610, 620, 630,
  640, 650, 660, 662, 670, 700, 732, 733, 762, 763, 790, 850, 860, 880,
  890, 900, 911, 912, 930, 1110, 1140, 1150, 1160, 1161, 1162, 1163, 1210,
  1251, 1253, 1262, 1422, 1423, 1424, 1433, 1437, 1447, 1452, 1482,
];

// The de-anonymizing trio (520 precise distance, 602 blocked_you, 900
// is_teleported). In a public-safe build they are never even requested.
const PUBLIC_SAFE_DROP = new Set([520, 602, 900]);

export const SUPER_PROJECTION: readonly number[] = __BE_PUBLIC_SAFE__
  ? BASE.filter((id) => !PUBLIC_SAFE_DROP.has(id))
  : BASE;

// Preview + large photo urls (mirrors client.py CHAT_ALBUM_REQUESTS).
export const ALBUM_REQUESTS = [
  {
    count: 10,
    offset: 1,
    album_type: 2,
    photo_request: { return_preview_url: true, return_large_url: true },
  },
] as const;
