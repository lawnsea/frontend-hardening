# Site Isolation

[Site isolation](https://www.chromium.org/Home/chromium-security/site-isolation/) runs documents from different [sites](https://html.spec.whatwg.org/multipage/browsers.html#sites) in different processes. A document can then only read memory belonging to its own site, which mitigates [Spectre](https://spectreattack.com/) and other side-channel attacks, as well as attacks from a compromised renderer.

Chromium and Firefox enable site isolation by default. WebKit does not.

## Browser Support

### Chromium

- The service worker runs in the page's process, so the page can read the key.
- Sandboxed frames run in a process separate from the page's. That process is shared with every sandboxed frame from the same site, including frames the page creates.

#### Opaque Blob Origins

A sandboxed frame has an [opaque origin](background.md#opaque-origin), so a Blob URL it creates has the form `blob:null/<uuid>`. Chromium compares both the origin and the path of such URLs when assigning processes ([Edge](https://microsoftedge.github.io/edgevr/posts/deep-dive-into-site-isolation-part-1/)), so a frame the sandboxed frame embeds with that URL runs in its own process. The service worker does not handle navigations from frames nested in a sandboxed frame, so that frame's content can't come from the worker.

### Firefox

- Service workers run in a separate process for each site ([process model](https://firefox-source-docs.mozilla.org/dom/ipc/process_model.html)), so the page can't read the key. All of a site's service workers share that process, including ones the page registers.
- Sandboxed frames and the `blob:null` frames they create run in the page's process, because Firefox assigns documents with opaque origins to the site of the document that created them ([`ProcessIsolation.cpp`](https://github.com/mozilla-firefox/firefox/blob/ac7b5e4bc10b65142541a54b0ef23462647f7da1/dom/ipc/ProcessIsolation.cpp)).

### WebKit

Site isolation is off by default ([`UnifiedWebPreferences.yaml`](https://github.com/WebKit/WebKit/blob/597e544acfe77145f50ada861f0b2721ecdf8f38/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L5962-L5970)). The page, its frames, and the service worker share one process.
