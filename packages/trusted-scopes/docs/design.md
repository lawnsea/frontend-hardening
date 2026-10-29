# Abstract

Normally the [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) is the smallest trust boundary the browser enforces. Every script in a frame, and in every [same-origin](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy) frame it can reach, can read and change the same DOM, storage, and credentials. However, an origin can create finer-grained trust boundaries at the granularity of [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) [scopes](https://w3c.github.io/ServiceWorker/#scope-match-algorithm), using a service worker, the [Content-Security-Policy header `sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox), and an [iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).

# Introduction

## Background

The following assumes familiarity with the concepts in [./background.md](./background.md).

## Motivation

Consider a web application that displays a user's profile, including personally identifiable information (PII) such as their address. Any and all code running in the profile page can read that PII. Code and infrastructure that can read PII are said to be _trusted_.

![A browser at example.com/profile shows a profile page with the user's name and address marked as PII. The browser requests GET /profile from the server at https://example.com:443, which responds with the page's HTML. Everything is trusted.](status-quo.svg)

Due to its sensitivity, PII is regulated in almost every jurisdiction—often by multiple regulatory bodies. If the web application is audited for compliance, all trusted code and systems would be in-scope for the audit. In the simple example above, this is not a serious burden. However, the profile page for a modern web application typically includes many more components.

![The same profile page, served by a simplified modern web application at https://example.com:443. The browser requests /profile from a web server, which queries GraphQL for the profile data. GraphQL fetches the requested data from a profile microservice backed by a database. Once GraphQL returns the result of the query, the server responds with the page's HTML and then handles requests for the page's other resources, including scripts, styles, and images. The code running in the browser and on all of the infrastructure described above is deployed by a CI service combining code from the origin with third-party code. All of these components are trusted.](modern-app.svg)

Modern web applications can easily comprise hundreds of thousands or even millions of lines of code deployed on a diverse collection of infrastructure running millions of lines of third-party code. Securing a trusted computing base of this size is a daunting task made significantly more challenging by emerging agentic threats.

This is not a new problem. Academia and industry have grappled with the challenge of securing complex systems for decades. The most important result of this work is the idea that rather than trusting the entire system with sensitive information, only those components of the application with a need to know sensitive information should be trusted and everything else should be untrusted. The standard way to apply this principle on the web is to host the PII on another origin and embed it in the page using iframes.

![The same profile page, but the name and address are each in an iframe from https://pii.example.com. The browser requests /profile from https://example.com:443, which responds with the page's HTML. Each iframe requests its field, /name or /address, from https://pii.example.com:443, which responds with the field's HTML. Only the browser, pii.example.com, and the iframes are trusted. The rest of the page and example.com are untrusted.](cross-origin-iframes.svg)

One way: the page receives only PII ciphertext and displays it in `<iframe src="/pii/#<ciphertext>">`. The server returns a document that decrypts its fragment and renders the PII, and includes the `Content-Security-Policy: sandbox allow-scripts` header, causing the browser to assign the document an opaque origin. Because the document is not the same origin as the embedding page, it cannot access its contents, including the PII and the decryption key for the ciphertext.

Each frame costs a network round trip, so this is slow, and a network disruption stops the PII from rendering.

Instead, a service worker hosted at `/pii/sw.js` and registered with scope `/pii/` can answer the request for the frame's document locally.

## A Minimal Proof-of-Concept

See [`examples/minimal-poc`](../examples/minimal-poc) for a full proof-of-concept demonstrating this architecture. When the page loads with the service worker already installed:

1. The page finds the worker's registration with `getRegistrations()` and sends the worker a message.
2. The worker encrypts the string "setec astronomy" with its AES-GCM key and replies with the ciphertext.
3. The page inserts `<iframe src="/sandbox#<ciphertext>">`.
4. The worker answers the frame's request with a document that contains the key and a script, and with `Content-Security-Policy: sandbox allow-scripts`.
5. The frame's script decrypts the fragment and displays the plaintext.

## Necessary Constraints

This proof-of-concept has several vulnerabilities that must be mitigated.

### Any client can read the secret

Any client, not only the page, can request `/sw.js` and read the key. To prevent this, the server must return the worker's script only for authenticated requests, and return an error otherwise.

### The page can read the worker's source

Any page script can fetch `/sw.js` and read the key. To prevent this, the server must serve the worker's script only to requests with [`Sec-Fetch-Dest: serviceworker`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Dest), which scripts can't set, and [`Service-Worker: script`](https://w3c.github.io/ServiceWorker/#service-worker), and with `Cache-Control: no-store`, so the page can't read it from the HTTP cache. If either header is missing, the server must return `403 Forbidden`.

### The page can read the frame's document

The worker answers every request for `/sandbox`, not only navigations, and the `sandbox` directive doesn't apply to a `fetch` response. The page can create a same-origin iframe the worker controls, such as one at `/sandbox/x`, and call that frame's `fetch("/sandbox")` to read the key. To prevent this, the worker must only respond to requests whose [`mode`](https://developer.mozilla.org/en-US/docs/Web/API/Request/mode) is `"navigate"` and whose [`destination`](https://developer.mozilla.org/en-US/docs/Web/API/Request/destination) is `"iframe"`, which scripts can't set.
