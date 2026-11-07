# Abstract

Normally the [origin](background.md#origin) is the smallest trust boundary the browser enforces. Every script in a frame, and in every [same-origin](background.md#same-origin-policy) frame it can reach, can read and change the same DOM, storage, and credentials. However, an origin can create finer-grained trust boundaries at the granularity of [service worker](background.md#service-worker) [scopes](background.md#scope), using a service worker, the [Content-Security-Policy](background.md#content-security-policy) header [`sandbox` directive](background.md#csp-sandbox-directive), and an [iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).

# Introduction

## Background

The following assumes familiarity with the concepts in [./background.md](./background.md).

## Threat model

The origin, the browser, and the user are trusted. The attacker controls any untrusted code and infrastructure and can act with its ambient authority.

## Motivation

Consider a web application that displays a user's profile, including personally identifiable information (PII) such as their address. Any and all code running in the profile page can read that PII. Components of the application (code and infrastructure, e.g.) that can read PII are said to be _trusted_. Collectively, an application's trusted components are referred to as its _trusted computing base_ or TCB.

![A browser at example.com/profile shows a profile page with the user's name and address marked as PII. The browser requests GET /profile from the server at https://example.com:443, which responds with the page's HTML. Everything is trusted.](status-quo.svg)

Due to its sensitivity, PII is regulated in almost every jurisdiction—often by multiple regulatory bodies. In order to prove that the web application is following the law, its provider is usually required to demonstrate that all portions of its TCB under the provider's control are compliant. This typically involves annual audits by an independent third party. In the simple example above, this is not a serious burden. However, the TCB for the profile page of a typical modern web application includes many more components.

![The same profile page, served by a simplified modern web application at https://example.com:443. The browser requests /profile from a web server, which queries GraphQL for the profile data. GraphQL fetches the requested data from a profile microservice backed by a database. Once GraphQL returns the result of the query, the server responds with the page's HTML and then handles requests for the page's other resources, including scripts, styles, and images. The code running in the browser and on all of the infrastructure described above is deployed by a CI service combining code from the origin with third-party code. All of these components are trusted.](modern-app.svg)

Modern web applications can easily comprise hundreds of thousands or even millions of lines of code deployed on a diverse collection of infrastructure running millions of lines of third-party code. Securing a trusted computing base of this size is a daunting task made significantly more challenging by emerging agentic threats.

This is not a new problem. Academia and industry have grappled with the challenge of securing complex systems for decades. The most important result of this work is the idea that rather than trusting the entire system with sensitive information, only those components of the application with a need to know sensitive information should be trusted and everything else should be untrusted. The standard way to apply this principle on the web is to host the PII on another origin and embed it in the page using iframes.

![The same profile page, but the name and address are each in an iframe from https://pii.example.com. The browser requests /profile from https://example.com:443, which responds with the page's HTML. Each iframe requests its field, /name or /address, from https://pii.example.com:443, which responds with the field's HTML. Only the browser, pii.example.com, and the iframes are trusted. The rest of the page and example.com are untrusted.](cross-origin-iframes.svg)

Because the PII frame is not from the same origin as the page, the browser prevents the page from reading the contents of the frame (or any other resource from the PII origin). As a result, the page and its origin are both untrusted.

While this architecture achieves our goal of shrinking the application's TCB, it comes with some downsides, including the following. First, the application must ensure the origin only returns PII for authenticated requests. Second, each PII frame in the page degrades the application's robustness and performance, as each makes a network request to the PII origin that can fail or take a long time.

Browsers support another way for the web application to put the PII in a cross-origin iframe: the HTTP Content-Security-Policy (CSP) sandbox directive. The application can serve the PII frame on the page's origin, but ensure it is cross-origin to the page by including the CSP sandbox directive when returning the frame's HTML. Using a layer 7 router, the application can serve PII from a dedicated server and avoid trusting the rest of the web application. The origin and the router must prevent any untrusted portions of the web application from making requests to the dedicated PII server.

![The same profile page, with the name and address each in an iframe from /pii/name or /pii/address on example.com. At https://example.com:443, a layer 7 router receives every request. It routes /pii/* to a PII server, which responds with the field's HTML and Content-Security-Policy: sandbox, and routes other paths, including /profile, to the web server. The browser, the iframes, the router, and the PII server are trusted. The rest of the page and the web server are untrusted.](sandboxed-iframes.svg)

This architecture removes the need for cross-origin authentication without significantly changing the size of the TCB. However, each PII frame still requires a network round trip to render. Using a service worker, the application can serve the PII frame from the browser without making a network request, but the worker code would need to include any PII data the page needs, which is inconvenient. Instead, we can encrypt the PII and include the key in the service worker code, allowing it to respond with the decrypted PII. The web server fetches encrypted PII from the PII server and includes it in each frame's `src`.

To ensure confidentiality, we now must only prevent untrusted portions of the web application from reading the service worker's source. On the server side, the origin and router must ensure only clients can read the service worker source. There are three refinements necessary to preserve confidentiality client-side.

First, the page can fetch `/pii/sw.js` directly or from the browser's cache and read the key. To prevent this, the server must return the service worker only for requests with the [`Sec-Fetch-Dest: serviceworker`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Dest) header, which scripts can't set. Otherwise, it must return `403 Forbidden`. It also must set the `Cache-Control: no-store` header on its response, so the page can't read it from the HTTP cache.

Second, if the page load is uncontrolled (because the service worker is not yet installed, e.g.) and the worker calls [`clients.claim()`](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim), the page can read the PII. The page can open `/pii/x` before the worker activates, which results in a 404 response from the server, creating a same-origin, unsandboxed document in the worker's scope. Once the worker claims that document, the page can call `fetch("/pii/abc123")` from it (by injecting a script tag, e.g.) and read the decrypted response. To prevent this, the worker must only respond to requests whose [`destination`](https://developer.mozilla.org/en-US/docs/Web/API/Request/destination) is `"iframe"`, which scripts can't set, and return an error otherwise.

Third, the page can register a service worker that reads the key with a [built-in pollution](background.md#built-in-pollution) attack. The untrusted web server hosts a worker that patches a built-in to which the trusted code passes the key (`Uint8Array.fromBase64`, e.g.) to leak the key, and then imports `/pii/sw.js` as a module. In Chromium and WebKit, the request made for that import includes the `Sec-Fetch-Dest: serviceworker` header. To prevent this attack, the server must also require the [`Service-Worker: script`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Service-Worker) header, which browsers send only when fetching a worker's main script. Scripts _can_ set this header, so the `Sec-Fetch-Dest` check is still necessary.

![The same profile page, with the name and address each in an iframe whose src is /pii/ followed by the field's ciphertext, such as /pii/abc123. At https://example.com:443, a layer 7 router routes /pii/* to a PII server and other paths, including /profile, to the web server. The web server fetches the encrypted PII from the PII server and puts it in each iframe's src. A service worker in the browser fetches its code, /pii/sw.js, from the PII server with Sec-Fetch-Dest: serviceworker and Service-Worker: script, which responds with Cache-Control: no-store. The worker then answers each iframe's request without the network, responding with the decrypted PII and Content-Security-Policy: sandbox. The browser, the iframes, the service worker, the router, and the PII server are trusted. The rest of the page and the web server are untrusted.](service-worker.svg)

## Design

An _origin_ hosting an _untrusted page_ that registers a _service worker_ at a given _scope_ can communicate a secret from the _web server_ hosting the worker to _sandboxed iframes_ served client-side by the worker and embedded in the untrusted page if the following are true:

The origin
- is secure
- responds to unauthenticated requests for the service worker with an error
- responds to requests for the service worker from within the origin with an error
- forwards all other requests for resources in the scope to the web server

The web server
- returns an error if a request for the service worker does not have the following headers
    - `Sec-Fetch-Dest: serviceworker`
    - `Service-Worker: script`
- includes the `Cache-Control: no-store` header when responding with the service worker

The service worker
- returns an error for a request for an iframe if the request's `destination` is not `iframe`
- includes a CSP sandbox directive that does not include the `allow-same-origin` permission when responding with the iframe document

Given these conditions, an attacker cannot compromise the secret's integrity or its confidentiality except via side channel attacks like Spectre.

### Site Isolation

The page can mount a Spectre attack on the service worker to read the secret, since the worker is from the same site as the page and thus not isolated from it.

## A Minimal Proof-of-Concept

This architecture avoids making a network request for each PII frame without significantly changing the size of the TCB. For clarity, however, it assumes the service worker is already in place when the page is loaded and omits the details of how this is accomplished. See [`examples/minimal-poc`](../examples/minimal-poc) for a full proof-of-concept that handles the details of installing the service worker. This PoC is intended only as a demonstration of the trusted scope primitive. *It is not production ready.*
