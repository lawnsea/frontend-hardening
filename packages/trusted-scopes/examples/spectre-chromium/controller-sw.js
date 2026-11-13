// The controller service worker. It serves the controller frame and holds each
// page's /controller-frame-ready script until that page's controller frame has
// redeemed its key. The router defines TEMPLATES, the worker's HTML templates,
// before this source.

self.addEventListener("install", () => self.skipWaiting());

// Embeds a string in a script without letting it close the script element.
const lit = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

// Replaces each {{key}} in a template with values[key].
const render = (name, values) => TEMPLATES[name].replace(/{{(\w+)}}/g, (_, key) => values[key]);

// A trusted document. The sandbox gives it an opaque origin, and
// Document-Isolation-Policy puts it in its own process, which it checks with
// crossOriginIsolated before doing anything.
const isolated = (body) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts; frame-src 'none'",
      "Document-Isolation-Policy": "isolate-and-credentialless",
      "Cache-Control": "no-store",
    },
  });

// Posts a control port and a port for this worker to the page, then redeems the
// key for the controller frame's MAC. Each message on the control port names a
// scope and carries a port to its scope frame, which gets the scope's MAC.
const controllerFrame = (psk) =>
  render("controller-frame.html", { origin: lit(self.location.origin), psk: lit(encodeURIComponent(psk)) });

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
    e.respondWith(isolated(controllerFrame(url.searchParams.get("psk"))));
  }
});
