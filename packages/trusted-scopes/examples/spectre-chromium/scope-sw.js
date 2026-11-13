// A scope service worker, registered at /trusted-scopes/<scope>/. It serves the
// scope's frames and holds no secrets: the scope frame signs the scope's requests,
// which bypass this worker because the scope frame has an opaque origin.
//
// The scope's server defines three constants before this source (see
// scope-worker.ts): TEMPLATES, the worker's HTML templates; SCOPE_MODULES, ES
// module sources by file name, which the scope frame loads in order and links by
// relative import; and FRAME_CONTENT, the source of an async function that
// returns a frame's content given its path, a function that makes a signed
// request for a scope path, and the modules.

self.addEventListener("install", () => self.skipWaiting());

const SCOPE = new URL(self.registration.scope).pathname.split("/")[2];
const ROOT = `/trusted-scopes/${SCOPE}/`;

// Embeds a string in a script without letting it close the script element.
const lit = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

// Replaces each {{key}} in a template with values[key].
const render = (name, values) => TEMPLATES[name].replace(/{{(\w+)}}/g, (_, key) => values[key]);

// A sandboxed document that loads `inner` from a Blob URL, so `inner` has an
// opaque blob:null origin and its own process.
const blobFrame = (inner) =>
  new Response(render("blob-frame.html", { inner: lit(inner) }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts; frame-src blob:",
      "Cache-Control": "no-store",
    },
  });

// The scope frame. It posts three ports to the page: one for the controller frame,
// which sends the scope's MAC; one for this worker; and one for the head script,
// which sends it ports to the scope's frames. It sends each frame the content
// FRAME_CONTENT returns for the frame's path.
const scopeFrame = render("scope-frame.html", {
  scope: lit(SCOPE),
  origin: lit(self.location.origin),
  root: lit(ROOT),
  modules: lit(SCOPE_MODULES),
  frameContent: FRAME_CONTENT,
});

// A frame in the scope. It posts a port for the scope frame, which sends it its
// content, and a port for this worker.
const frame = (path) => render("scope-member-frame.html", { path: lit(path) });

// The head script relays a port from each of the scope's frames here.
const ports = [];
self.addEventListener("message", (e) => {
  if (!e.ports[0]) return;
  ports.push(e.ports[0]);
  fetch(`/log?scope-worker-port-${SCOPE}`);
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.mode !== "navigate") return;
  e.respondWith(blobFrame(url.pathname === ROOT ? scopeFrame : frame(url.pathname)));
});
