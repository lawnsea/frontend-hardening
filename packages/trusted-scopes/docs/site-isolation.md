# Site Isolation

[Site isolation](https://www.chromium.org/Home/chromium-security/site-isolation/) is a browser security feature that mitigates [Spectre](https://spectreattack.com/) and other side-channel attacks, as well as attacks from a compromised renderer by running documents from different [sites](https://html.spec.whatwg.org/multipage/browsers.html#sites) in different processes.

Chromium and Firefox enable site isolation by default. WebKit support is in-progress and disabled by default, but can be enabled by the user. Browser implementations of site isolation differ.

## Browser Support

### Chromium

The service worker runs in the page's process, so the page can read any secrets it contains with a side-channel attack. Sandboxed frames in the page run in a process separate from the page's. However, that process is shared with every sandboxed frame from the page's site, so an attacker-controlled sandbox frame can read secrets from other sandboxed frames from the page's site, including the frame returned by the service worker.

#### Opaque Blob Origins

A Blob URL created by a sandboxed frame with an [opaque origin](background.md#opaque-origin), so  has the form `blob:null/<uuid>`. Chromium runs documents created from such a URL in their own process (shared only with documents with the same UUID).

### Firefox

Service workers run in a separate process for each site ([process model](https://firefox-source-docs.mozilla.org/dom/ipc/process_model.html)), so the page can't read the key, but an attacker-controlled service worker can. However, Firefox assigns documents with opaque origins to the site of the document that created them ([`ProcessIsolation.cpp`](https://github.com/mozilla-firefox/firefox/blob/ac7b5e4bc10b65142541a54b0ef23462647f7da1/dom/ipc/ProcessIsolation.cpp)), so the page can read secrets from sandboxed frames and frames created from opaque blob URLs.

### WebKit

Site isolation is off by default ([`UnifiedWebPreferences.yaml`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L5962-L5970)). The page, its frames, and the service worker share one process. When site isolation is enabled, frames from the page's site, including sandboxed frames, still run in the page's process ([`WebProcessPool.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/WebProcessPool.cpp#L2526-L2530)), as does the service worker ([`WebProcessPool.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/WebProcessPool.cpp#L755-L759)). Frames from all other sites share a single process ([`BrowsingContextGroup.cpp`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WebKit/UIProcess/BrowsingContextGroup.cpp#L65-L127)).
