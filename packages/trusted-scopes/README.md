# trusted-scopes

`trusted-scopes` creates trust boundaries within a web application at a finer grain than an [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin). Code and data that need protection live in a sandboxed frame that a trusted [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) serves. The rest of the page can only send that frame messages.

The project is at the design stage and has no public API yet.

- [Design](docs/design.md)
- [Minimal example](examples/minimal-poc): a worker sends ciphertext to an untrusted page, and a sandboxed frame decrypts it.

## Development

- `pnpm build` compiles `src` to `dist`.
- `pnpm typecheck` typechecks `src`, including tests.
- `pnpm test` runs the unit tests with [Vitest](https://vitest.dev/).
