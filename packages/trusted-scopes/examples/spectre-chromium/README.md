# spectre-chromium

Protects the profile page's PII from [Spectre](https://spectreattack.com/) attacks by the page in Chromium. Trusted code and data stay in `blob:null` frames, which Chromium runs in their own processes ([site isolation](../../docs/site-isolation.md#opaque-blob-origins)).

- `pnpm start` serves it at http://localhost:5176/profile.
- `pnpm test` runs the Playwright tests in headed Chromium.

## Terms

- **Controller frame:** the trusted frame the head script creates. It holds the session's MAC.
- **Scope frame:** a scope's trusted frame. It holds the scope's MAC and makes the scope's signed requests.
- **Controller service worker:** the trusted worker controlling the page, `/sw.js`.
- **Scope service worker:** a scope's trusted worker, `/trusted-scopes/<scope>/sw.js`. It serves the scope's frames and holds only ports.

## Servers

Each runs in its own process.

- `router.ts`, the trusted L7 router, creates a session for each `/profile` load and passes its ID to the profile server. It serves:
  - `/sw.js`, the controller worker;
  - `GET /psk/<key>`, which redeems a single-use key for the controller frame's MAC, and `DELETE /psk/<key>`, which revokes it;
  - `GET /scope-mac/<scope>`, signed with the controller frame's MAC, which returns the scope's MAC, or `404` for a scope it doesn't serve;
  - `/trusted-scopes/<scope>/*`, forwarded to the scope's server with the session ID if the `Trusted-Scope-Signature` header is the scope's MAC: `<session ID>.<scope>.<HMAC-SHA256 of the scope>`. It forwards `/trusted-scopes/<scope>/sw.js` unsigned, for `Sec-Fetch-Dest: serviceworker` only.
- `pii-server.ts`, the trusted server for the `pii` scope, serves:
  - `/trusted-scopes/pii/sw.js`, the scope worker;
  - the PII, encrypted with ChaCha20-Poly1305 under a per-session key, to the profile server only;
  - `/trusted-scopes/pii/session-key`, the session's key, for requests the router forwards signed.
- `profile-server.ts`, the untrusted profile server, renders the profile page's head and body content, with the encrypted PII.

The profile server returns the page's head and body content. The router wraps them in a document whose head starts with the trusted head script (`head.ts`) and a parser-blocking `<script src="/controller-frame-ready">`. It sends `Content-Security-Policy: frame-src <origin>/controller-frame <origin>/trusted-scopes/; require-trusted-types-for 'script'; trusted-types default`.

## Head script

It creates the `default` Trusted Types policy, which refuses `srcdoc`, and saves the built-ins it uses after untrusted code runs.

- **Load not controlled by any worker:** it revokes the key with a synchronous `DELETE`, registers the controller worker, and reloads once it's active.
- **Load controlled by another worker:** it revokes the key and stops.
- **Load controlled by the controller worker:**
  1. It adds the controller frame, `/controller-frame`. The controller worker serves it with `Content-Security-Policy: sandbox allow-scripts; frame-src blob:`, and it loads a `blob:null` document.
  2. That document posts a control port and a worker port to the page, then redeems the key.
  3. The head script keeps the control port and forwards the worker port to the controller worker.
  4. The controller frame sends `ready` to the controller worker, which then answers `/controller-frame-ready`. On timeout, it revokes the key first.

## trustedScopes

- `createScope(scope)` registers the scope's worker and waits for it to activate. It then adds the scope frame, `/trusted-scopes/<scope>/`, served by the scope worker. The scope frame posts three ports:
  - one to the controller frame, which gets the scope's MAC from `/scope-mac/<scope>` and sends it;
  - one to the scope worker;
  - one to the head script, on which the scope frame reports `ready`.

  The promise resolves to the trusted scope object.
- `scopes[scope]` is the trusted scope object for a created scope.
- `trustedScope.createFrame(path)` adds a frame for `/trusted-scopes/<scope><path>`, served by the scope worker. The frame posts one port to the scope frame and one to the scope worker. The scope frame sends the frame its content:
  - by default, the scope server's response to a signed request for the path;
  - in the `pii` scope, the path decrypted. The profile page calls `createFrame("/" + ciphertext)`, and the pii scope frame decrypts it with the session key from `/trusted-scopes/pii/session-key` and [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers). `blob:null` documents aren't secure contexts, so they have no WebCrypto.

The head script connects a trusted frame's ports only from a trusted message with origin `"null"` from the frame's first child, carrying the frame's path. If the path is wrong, it throws. Untrusted code can't run script there with origin `"null"`. `frame-src` blocks other URLs, the `default` policy blocks `srcdoc`, and a document it can script, such as `about:blank`, has the page's origin.
