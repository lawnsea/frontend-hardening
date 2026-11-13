// A scope service worker, registered at /trusted-scopes/<scope>/. It serves the
// scope's frames and holds no secrets: the scope frame signs the scope's requests,
// which bypass this worker because the scope frame has an opaque origin.
//
// The scope's server defines two constants before this source (see
// scope-worker.ts): SCOPE_MODULES, ES module sources by file name, which the
// scope frame loads in order and links by relative import; and FRAME_CONTENT, the
// source of an async function that returns a frame's content given its path,
// a function that makes a signed request for a scope path, and the modules.

self.addEventListener("install", () => self.skipWaiting());

const SCOPE = new URL(self.registration.scope).pathname.split("/")[2];
const ROOT = `/trusted-scopes/${SCOPE}/`;

// Embeds a string in a script without letting it close the script element.
const lit = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

// A sandboxed document that loads `inner` from a Blob URL, so `inner` has an
// opaque blob:null origin and its own process.
const blobFrame = (inner) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body><script>
  const f = document.createElement("iframe");
  f.src = URL.createObjectURL(new Blob([${lit(inner)}], { type: "text/html" }));
  document.body.append(f);
</script>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "sandbox allow-scripts; frame-src blob:",
        "Cache-Control": "no-store",
      },
    },
  );

// The scope frame. It posts three ports to the page: one for the controller frame,
// which sends the scope's MAC; one for this worker; and one for the head script,
// which sends it ports to the scope's frames. It sends each frame the content
// FRAME_CONTENT returns for the frame's path.
const scopeFrame = `<!doctype html><meta charset="utf-8"><script>
  const SCOPE = ${lit(SCOPE)};
  const ORIGIN = ${lit(self.location.origin)};
  const toController = new MessageChannel();
  const toWorker = new MessageChannel();
  const toHead = new MessageChannel();
  parent.parent.postMessage({ path: ${lit(ROOT)} }, "*", [toController.port2, toWorker.port2, toHead.port2]);

  const signature = new Promise((resolve, reject) => {
    toController.port1.onmessage = ({ data }) => (data.mac ? resolve(data.mac) : reject(data.error));
  });
  signature.then(() => toHead.port1.postMessage("ready"), () => toHead.port1.postMessage("failed"));

  // Links each module's relative imports to the Blob URLs of the modules before it.
  const modules = (async () => {
    const urls = {};
    for (const [name, source] of Object.entries(${lit(SCOPE_MODULES)})) {
      const linked = source.replace(/from "\\.\\/([\\w.]+)"/g, (_, dep) => "from " + JSON.stringify(urls[dep]));
      urls[name] = URL.createObjectURL(new Blob([linked], { type: "text/javascript" }));
    }
    const loaded = {};
    for (const name in urls) loaded[name] = await import(urls[name]);
    return loaded;
  })();
  const fetchSigned = async (path) =>
    fetch(ORIGIN + "/trusted-scopes/" + SCOPE + path, { headers: { "Trusted-Scope-Signature": await signature } });
  const frameContent = ${FRAME_CONTENT};
  toHead.port1.onmessage = async (m) => {
    const port = m.ports[0];
    try {
      port.postMessage(await frameContent(m.data.path, fetchSigned, await modules));
    } catch {
      port.postMessage("");
    }
  };
</script>`;

// A frame in the scope. It posts a port for the scope frame, which sends it its
// content, and a port for this worker.
const frame = (path) => `<!doctype html><meta charset="utf-8"><body><script>
  const toScope = new MessageChannel();
  const toWorker = new MessageChannel();
  parent.parent.postMessage({ path: ${lit(path)} }, "*", [toScope.port2, toWorker.port2]);
  toScope.port1.onmessage = (m) => { document.body.textContent = m.data; };
</script>`;

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
