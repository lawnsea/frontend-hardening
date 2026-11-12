# spectre-chromium

Protects the profile page's PII from [Spectre](https://spectreattack.com/) attacks by the page in Chromium. The PII stays in `blob:null` frames, which Chromium runs in their own processes ([site isolation](../../docs/site-isolation.md#opaque-blob-origins)).

- `pnpm start` serves it at http://localhost:5176/profile.
- `pnpm test` runs the Playwright tests in headed Chromium.

## Architecture

`server.ts` plays the L7 router and the PII server. It serves `/profile` only for `Sec-Fetch-Dest: document`, with:

- the trusted head script (`head.ts`), holding a single-use secret;
- a **gate:** a parser-blocking `<script src="/__gate">`, so no untrusted code runs until it loads;
- the untrusted page (`profile.ts`);
- `Content-Security-Policy: frame-src <origin>/__frame/; require-trusted-types-for 'script'; trusted-types default`.

It serves `sw.js` only for `Sec-Fetch-Dest: serviceworker`, and no other path for that destination.

### Load without the worker

1. The head script spends the secret with a synchronous `DELETE /redeem`.
2. It registers `sw.js` and reloads once the worker is active.
3. The gate reaches the server, which holds it until the secret is spent.

### Load through the worker

1. The head script creates the `default` Trusted Types policy, which refuses `srcdoc`.
2. It adds the trusted frame, `/__frame/trusted?secret=…`. The worker serves it with `Content-Security-Policy: sandbox allow-scripts; frame-src blob:`, and it loads a `blob:null` document.
3. That document posts a control port and a worker port to the page, then redeems the secret with `POST /redeem`.
4. The head script's capture listener, registered before untrusted code, keeps the control port and forwards the worker port to the worker.
5. The trusted frame reports the redemption on the worker port. The worker then answers the gate. On timeout, it spends the secret first.

### PII frames

1. Untrusted code calls `trustedScopes.mintPiiFrame()`, which returns an iframe for `/__frame/pii`.
2. The worker serves it sandboxed. Its document posts its path and a port to the page, and gives the other end of the channel to its `blob:null` document.
3. The head script accepts the port only from a trusted message with origin `"null"`, from that frame's window, with that frame's path. It sends the port to the trusted frame over the control port, and the trusted frame answers on it with the PII.

Untrusted code can't run script in a frame document with origin `"null"`. `frame-src` blocks other URLs, the `default` policy blocks `srcdoc`, and Chromium blocks other origins' `blob:` URLs. A frame document it can script, such as `about:blank`, has the page's origin.
