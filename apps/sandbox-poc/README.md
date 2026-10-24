# sandbox-poc

Proof of concept for [`sandbox-component`](../../packages/sandbox-component/docs/design.md), built around the PII form example. A `<sandbox-input>` holds an SSN that only its sandbox frame can read. The embedding page sees ciphertext only.

- `pnpm dev` serves it with Vite. `vite.config.ts` also stands in for the application server.
- `pnpm test` runs the Playwright tests in Chromium.

The worker's key is hard-coded as a stand-in for key provisioning, which is out of scope.
