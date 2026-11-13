# Site Isolation

[Site isolation](https://www.chromium.org/Home/chromium-security/site-isolation/) is a browser security feature that mitigates [Spectre](https://spectreattack.com/) and other side-channel attacks, as well as attacks from a compromised renderer, by running documents from different [sites](https://html.spec.whatwg.org/multipage/browsers.html#sites) in different processes.

Chromium and Firefox enable site isolation by default. WebKit support is in progress and disabled by default, but can be enabled by the user in Safari's Technology Preview. Browser implementations of site isolation differ.

## Browser Support

### Chromium

The service worker runs in the page's process, so the page and any other script in its process (other service workers, e.g.) can read any secrets the worker contains with a side-channel attack. Sandboxed frames in the page run in a process separate from the page's. However, that process is shared with every sandboxed frame from the page's site, so an attacker-controlled sandboxed frame (`<iframe sandbox="allow-scripts" srcdoc="<attack>"></iframe>`, e.g.) can read secrets from any other sandboxed frames from the page's site, including the frame returned by the service worker.

#### Opaque Blob Origins

Chromium runs documents created from null-origin Blob URLs of the form `blob:null/<uuid>` (i.e., one created by a sandboxed frame) in a process shared only with other documents created from other null-origin blob URLs with the same UUID. The service worker can ensure a sandboxed frame is site isolated by embedding its content in a blob URL with a unique UUID. Unfortunately, this is not useful: the attacker cannot read a secret from the blob iframe, but it can still be read from the outer sandboxed frame (and the service worker).

#### Document-Isolation-Policy

Chromium runs a document served with [`Document-Isolation-Policy`](https://github.com/WICG/document-isolation-policy) in a process shared only with same-origin documents with the header, when it can, and sets `crossOriginIsolated` only then. A sandboxed document with the header has a unique opaque origin, so it gets its own process. A same-origin, unsandboxed document with the header doesn't: the attacker can serve its own same-origin document with the header and script it, and any same-origin document can read its storage.

### Firefox

Service workers run in a separate process for each site ([process model](https://firefox-source-docs.mozilla.org/dom/ipc/process_model.html)), so the page can't read the key, but an attacker-controlled service worker can. However, Firefox assigns documents with opaque origins to the site of the document that created them ([`ProcessIsolation.cpp`](https://github.com/mozilla-firefox/firefox/blob/ac7b5e4bc10b65142541a54b0ef23462647f7da1/dom/ipc/ProcessIsolation.cpp)), so the page can read secrets from sandboxed frames and frames created from opaque blob URLs.

### WebKit

Site isolation is off by default ([`UnifiedWebPreferences.yaml`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L5962-L5970)). The page, its frames, and the service worker share one process. When site isolation is enabled, frames from the page's site, including sandboxed frames, still run in the page's process ([`WebProcessPool.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/WebProcessPool.cpp#L2526-L2530)), as does the service worker ([`WebProcessPool.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/WebProcessPool.cpp#L755-L759)). Frames from all other sites share a single process ([`BrowsingContextGroup.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/BrowsingContextGroup.cpp#L65-L127)).
