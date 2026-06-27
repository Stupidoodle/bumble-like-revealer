// MAIN-world entry, injected at document_start. Captures the pristine fetch
// before patching, then installs the encounters interceptor and the signed
// SERVER_GET_USER client (both share that origFetch).

import { installIntercept } from "./intercept";
import { installUserClient } from "./user-client";
import { makeLog } from "../shared/log";

(() => {
  "use strict";
  const origFetch = window.fetch;
  installIntercept(origFetch);
  installUserClient(origFetch);
  makeLog("[BE/page]")("page hook installed");
})();
