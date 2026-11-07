# minimal-poc

Minimal proof of concept for [`trusted-scopes`](../../docs/design.md#a-minimal-proof-of-concept). The profile server renders an untrusted page that holds only ciphertext. A trusted service worker decrypts each PII field into a sandboxed frame, without a network request.

![The design's service worker diagram, as implemented. The browser at localhost:5173/profile shows the profile page, with the name and address each in an iframe whose src is /pii/ followed by the field's ciphertext. Vite, at http://localhost:5173, plays the L7 router: it sends /profile to the untrusted profile server and /pii/* to the trusted PII server, and relays the profile server's requests for /pii/fields/<name> to the PII server. The service worker fetches /pii/sw.js from the PII server with Sec-Fetch-Dest: serviceworker and Service-Worker: script, which responds with Cache-Control: no-store. The worker then answers each iframe's request with the decrypted field and Content-Security-Policy: sandbox.](poc.svg)

- `pnpm dev` serves it with Vite at http://localhost:5173/profile.
- `pnpm test` runs the Playwright tests in Chromium, Firefox, and WebKit.

**This PoC is not production ready.** It makes only the security guarantees described in the [design](../../docs/design.md#design), weakened to reflect the fact that it is not hosted on a secure site and it does not authenticate requests.
