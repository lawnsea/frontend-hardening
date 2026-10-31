# minimal-poc

Minimal proof of concept for [`trusted-scopes`](../../docs/design.md#a-minimal-proof-of-concept). The profile server renders an untrusted page that holds only ciphertext. A trusted service worker decrypts each PII field into a sandboxed frame, without a network request.

![The design's service worker diagram, as implemented. The browser at localhost:5173/profile shows the profile page, with the name and address each in an iframe whose src is /pii/ followed by the field's ciphertext. Vite, at http://localhost:5173, plays the L7 router: it sends /profile to the untrusted profile server and /pii/* to the trusted PII server, and relays the profile server's requests for /pii/fields/<name> to the PII server. The service worker fetches /pii/sw.js from the PII server, then answers each iframe's request with the decrypted field and Content-Security-Policy: sandbox.](poc.svg)

- `router.js` is a Vite plugin that plays the L7 router. It runs each server as a subprocess, forwards the browser's requests to it over IPC (`ipc.js`), and relays requests between servers:
  - `/profile` goes to the untrusted profile server, `profile-server.js`. It gets each PII field's ciphertext from the PII server, by field name, and renders it as a `data-pii` attribute.
  - `/pii/*` goes to the trusted PII server, `pii-server.js`. It serves the worker at `/pii/sw.js` with the key built in and, to the profile server only, answers `/pii/fields/<name>` with that field's ciphertext. Every other `/pii/` request gets a 404.
  - Vite serves everything else.
- `profile-db.js` stands in for the profile database.
- The page registers the worker with scope `/pii/` unless `getRegistrations()` already has it. Once the worker is active, the page inserts an `<iframe src="/pii/<ciphertext>">` for each field. The worker never controls the page.
- The worker answers each `/pii/<ciphertext>` request with the decrypted field and `Content-Security-Policy: sandbox`.
- `pnpm dev` serves it with Vite at http://localhost:5173/profile.
- `pnpm test` runs the Playwright tests in Chromium, Firefox, and WebKit.

**This PoC is not production ready and has known vulnerabilities.** See the [design doc](../../docs/design.md#necessary-constraints) for details.
