// Reproduces Bumble's mwebapi request signing: the BadooMessage envelope plus
// X-Pingback = md5(exactBodyString + salt). The exact serialized string that is
// hashed is the same string that gets POSTed, so the bytes always match.

import { MT_GET_USER } from "./constants";
import { SUPER_PROJECTION, ALBUM_REQUESTS } from "./projection";
import { md5 } from "./md5";

export const PINGBACK_SALT = "whitetelevisionbulbelectionroofhorseflying";

let userMsgId = 1000; // own counter band; never collides with the app's ids

export function buildUserEnvelope(userId: unknown) {
  return {
    $gpb: "badoo.bma.BadooMessage",
    body: [
      {
        message_type: MT_GET_USER,
        server_get_user: {
          user_id: userId, // ORIGINAL wire type from the cached encounters record
          user_field_filter: {
            projection: SUPER_PROJECTION,
            request_albums: ALBUM_REQUESTS,
          },
          client_source: 7,
        },
      },
    ],
    message_id: userMsgId++,
    message_type: MT_GET_USER,
    version: 1,
    is_background: false,
  };
}

export function signBody(body: string): string {
  return md5(body + PINGBACK_SALT);
}
