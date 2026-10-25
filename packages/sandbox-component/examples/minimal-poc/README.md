# minimal-poc

Minimal proof of concept for [`sandbox-component`](../../docs/design.md). A trusted service worker encrypts a secret and posts the ciphertext to an untrusted page. The page puts it in a sandbox frame's URL fragment, and the frame decrypts and shows it.

- `index.html` is the untrusted page. `sw.js` is the trusted worker, and it holds the key.
- The page registers the worker with scope `/sandbox` unless `getRegistrations()` already has it. The worker never controls the page. The page asks the worker for the ciphertext with `postMessage`.
- The worker serves `/sandbox` with `Content-Security-Policy: sandbox allow-scripts`.
- `pnpm dev` serves it with Vite at http://localhost:5173/index.html.
- `pnpm test` runs the Playwright tests in Chromium, Firefox, and WebKit.

This PoC ignores known attacks; see the design doc.
