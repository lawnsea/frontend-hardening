# trusted-scopes

`trusted-scopes` describes how an [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) can create trust boundaries at the granularity of [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) scopes, using a service worker, the [CSP `sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox), and an iframe. It also describes and demonstrates use cases of this primitive.

- [Design](docs/design.md)
- [Minimal example](examples/minimal-poc): an untrusted page holds only ciphertext, and a worker decrypts each PII field into a sandboxed frame.

## Development

- `pnpm build` compiles `src` to `dist`.
- `pnpm typecheck` typechecks `src`, including tests.
- `pnpm test` runs the unit tests with [Vitest](https://vitest.dev/).
