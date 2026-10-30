# minimal-poc

Minimal proof of concept for [`trusted-scopes`](../../docs/design.md). The server renders an untrusted profile page that holds only ciphertext. A trusted service worker decrypts each PII field into a sandboxed frame, without a network request.

- `server.js` is a Vite plugin that plays the web server and the PII server:
  - `/profile` is the untrusted page. Each PII field is a `data-pii` attribute holding the field's ciphertext.
  - `/pii/sw.js` is the trusted worker, with the key built in.
- The page registers the worker with scope `/pii/` unless `getRegistrations()` already has it. Once the worker is active, the page inserts an `<iframe src="/pii/<ciphertext>">` for each field. The worker never controls the page.
- The worker answers each `/pii/<ciphertext>` request with the decrypted field and `Content-Security-Policy: sandbox`. The server returns 404 for those URLs.
- `pnpm dev` serves it with Vite at http://localhost:5173/profile.
- `pnpm test` runs the Playwright tests in Chromium, Firefox, and WebKit.

This PoC ignores known attacks; see the design doc.
