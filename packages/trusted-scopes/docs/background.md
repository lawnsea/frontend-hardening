# Background

- [Content Security Policy](#content-security-policy)
- [CSP Sandbox Directive](#csp-sandbox-directive)
- [Opaque Origin](#opaque-origin)
- [Origin](#origin)
- [Same-Origin Policy](#same-origin-policy)
- [Scope](#scope)
- [Service Worker](#service-worker)

# Content Security Policy

A [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) (CSP) is a response header that restricts what a document may do, such as which scripts it may run.

# CSP Sandbox Directive

The CSP [`sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) applies the restrictions of the iframe [`sandbox` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) to a document, wherever it loads. `sandbox allow-scripts` lets the document run scripts but, without `allow-same-origin`, gives it an opaque origin.

# Opaque Origin

An [opaque origin](https://html.spec.whatwg.org/multipage/browsers.html#concept-origin-opaque) is an origin equal to no other origin. Other frames can't access the DOM or JavaScript globals of a document with an opaque origin, and the document can't access the storage or cookies of its URL's origin.

# Origin

An [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) is a URL's scheme, host, and port.

# Same-Origin Policy

Under the [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy), a script can read and change the documents, storage, and cookies of its own origin, but not those of other origins.

# Scope

A service worker's registration controls the URLs under its [scope](https://w3c.github.io/ServiceWorker/#scope-match-algorithm), a URL prefix: a navigation goes to the registration whose scope is the longest prefix of its URL. By default, a scope must be within the directory of the worker's script.

# Service Worker

A [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) is a script the browser runs apart from any page. It acts as a proxy for the network requests of the pages and frames it controls, and can answer a request with a response it builds itself.
