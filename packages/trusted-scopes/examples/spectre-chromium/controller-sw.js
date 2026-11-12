// The controller service worker. It serves the controller frame and holds each
// page's /controller-frame-ready script until that page's controller frame has
// redeemed its key.

self.addEventListener("install", () => self.skipWaiting());

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

// Posts a control port and a port for this worker to the page, then redeems the
// key for the controller frame's MAC. Each message on the control port names a
// scope and carries a port to its scope frame, which gets the scope's MAC.
const controllerFrame = (psk) => `<!doctype html><meta charset="utf-8"><script>
  const ORIGIN = ${lit(self.location.origin)};
  const control = new MessageChannel();
  const worker = new MessageChannel();
  parent.parent.postMessage({ path: "/controller-frame" }, "*", [control.port2, worker.port2]);
  const mac = fetch(ORIGIN + "/psk/" + ${lit(encodeURIComponent(psk))})
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
  mac.then(() => worker.port1.postMessage("ready"), () => worker.port1.postMessage("failed"));
  control.port1.onmessage = async (m) => {
    const port = m.ports[0];
    const response = await fetch(ORIGIN + "/scope-mac/" + encodeURIComponent(m.data.scope), {
      headers: { "Trusted-Scope-Signature": await mac },
    });
    port.postMessage(response.ok ? { mac: await response.text() } : { error: response.status });
  };
</script>`;

// Each page's controller frame status, by client ID.
const pages = new Map();
const pageFor = (clientId) => {
  if (!pages.has(clientId)) {
    let settle;
    const settled = new Promise((r) => (settle = r));
    pages.set(clientId, { settled, settle, connected: false });
  }
  return pages.get(clientId);
};

// The page's head script relays the controller frame's port here before any
// untrusted code runs. Only the first one counts.
self.addEventListener("message", (e) => {
  const port = e.ports[0];
  if (!port || !e.source) return;
  const page = pageFor(e.source.id);
  if (page.connected) return;
  page.connected = true;
  port.onmessage = (m) => page.settle(m.data);
});

// Answers the page's parser-blocking script once its controller frame is ready,
// or on timeout. A key that wasn't redeemed is revoked first.
const controllerFrameReady = async (clientId, params) => {
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), Number(params.get("timeout"))));
  const result = await Promise.race([pageFor(clientId).settled, timeout]);
  pages.delete(clientId);
  if (result !== "ready") await fetch(`/psk/${encodeURIComponent(params.get("psk"))}`, { method: "DELETE" });
  await fetch(`/log?worker-gate-${result}`);
  return new Response("", { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
};

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname === "/controller-frame-ready") {
    e.respondWith(controllerFrameReady(e.clientId, url.searchParams));
  } else if (url.pathname === "/controller-frame" && e.request.mode === "navigate") {
    e.respondWith(blobFrame(controllerFrame(url.searchParams.get("psk"))));
  }
});
