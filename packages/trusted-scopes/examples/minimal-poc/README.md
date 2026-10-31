# minimal-poc

Minimal proof of concept for [`trusted-scopes`](../../docs/design.md#a-minimal-proof-of-concept). The profile server renders an untrusted page that holds only ciphertext. A trusted service worker decrypts each PII field into a sandboxed frame, without a network request.

![The design's service worker diagram, as implemented. The browser at localhost:5173/profile shows the profile page, with the name and address each in an iframe whose src is /pii/ followed by the field's ciphertext. Vite, at http://localhost:5173, plays the L7 router: it sends /profile to the untrusted profile server and /pii/* to the trusted PII server, and relays the profile server's requests for /pii/fields/<name> to the PII server. The service worker fetches /pii/sw.js from the PII server, then answers each iframe's request with the decrypted field and Content-Security-Policy: sandbox.](poc.svg)

- `pnpm dev` serves it with Vite at http://localhost:5173/profile.
- `pnpm test` runs the Playwright tests in Chromium, Firefox, and WebKit.

**This PoC is not production ready and has known vulnerabilities.** See the [design doc](../../docs/design.md#vulnerabilities) for details.
