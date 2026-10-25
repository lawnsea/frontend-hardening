# minimal-poc

Minimal proof of concept for [`sandbox-component`](../../docs/design.md). A trusted service worker encrypts a secret and posts the ciphertext to an untrusted page. The page puts it in a sandbox frame's URL, and the frame decrypts and shows it.

- `server.js` serves only `/index.html` (untrusted) and `/sw.js` (trusted, holds the key).
- The worker serves `/sandbox` with `Content-Security-Policy: sandbox allow-scripts`.
- `pnpm start` serves it at http://localhost:5175/index.html.
- `pnpm test` runs the Playwright tests in Chromium.

This PoC ignores known attacks; see the design doc.
