// Holds each page's gate script until the page's trusted frame reports that it
// redeemed the secret, and serves the sandboxed outer frames.

self.addEventListener("install", () => self.skipWaiting());

// Embeds a string in a script without letting it close the script element.
const lit = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

const sandboxed = (body) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts; frame-src blob:",
      "Cache-Control": "no-store",
    },
  });

// Loads `inner` from a Blob URL, so it has an opaque blob:null origin.
const blobFrame = (inner) => `<!doctype html><meta charset="utf-8"><body><script>
  const f = document.createElement("iframe");
  f.src = URL.createObjectURL(new Blob([${lit(inner)}], { type: "text/html" }));
  document.body.append(f);
</script>`;

// The PII frame's outer document. It creates the frame's channel, posts one end to
// the page right away with the path it was served at, and gives the other to
// `inner` once it loads. The page knows the message is from this document because
// its origin is "null".
const piiRelay = (inner, path) => `<!doctype html><meta charset="utf-8"><body><script>
  const channel = new MessageChannel();
  parent.postMessage({ path: ${lit(path)} }, "*", [channel.port2]);
  const f = document.createElement("iframe");
  f.src = URL.createObjectURL(new Blob([${lit(inner)}], { type: "text/html" }));
  f.addEventListener("load", () => f.contentWindow.postMessage(null, "*", [channel.port1]), { once: true });
  document.body.append(f);
</script>`;

// Posts a control port and a port for this worker to the page, then redeems the
// secret. Each message on the control port carries a port to a PII frame.
const trustedFrame = (secret) => `<!doctype html><meta charset="utf-8"><script>
  const control = new MessageChannel();
  const worker = new MessageChannel();
  parent.parent.postMessage(null, "*", [control.port2, worker.port2]);
  const pii = fetch(${lit(`${self.location.origin}/redeem`)}, { method: "POST", body: ${lit(secret)} })
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
  pii.then(() => worker.port1.postMessage("redeemed"), () => worker.port1.postMessage("failed"));
  control.port1.onmessage = (m) => pii.then((text) => m.ports[0].postMessage(text), () => {});
</script>`;

// Shows the PII it receives on the first port it's sent.
const PII_FRAME = `<!doctype html><meta charset="utf-8"><body><script>
  let connected = false;
  addEventListener("message", (e) => {
    if (connected || e.source !== parent || !e.ports[0]) return;
    connected = true;
    e.ports[0].onmessage = (m) => { document.body.textContent = m.data; };
  });
</script>`;

// Each page's gate, by client ID.
const gates = new Map();
const gateFor = (clientId) => {
  if (!gates.has(clientId)) {
    let open;
    const opened = new Promise((r) => (open = r));
    gates.set(clientId, { opened, open, connected: false });
  }
  return gates.get(clientId);
};

// The page's head script relays the trusted frame's port here. Only the first one
// counts, and it's sent before the gate opens, so before any untrusted code runs.
self.addEventListener("message", (e) => {
  const port = e.ports[0];
  if (!port || !e.source) return;
  const gate = gateFor(e.source.id);
  if (gate.connected) return;
  gate.connected = true;
  port.onmessage = (m) => gate.open(m.data);
});

// Answers the page's parser-blocking gate script once its trusted frame reports,
// or on timeout. A secret that wasn't redeemed is spent first.
const holdGate = async (clientId, params) => {
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), Number(params.get("timeout"))));
  const result = await Promise.race([gateFor(clientId).opened, timeout]);
  gates.delete(clientId);
  if (result !== "redeemed") await fetch("/invalidate", { method: "POST", body: params.get("secret") });
  await fetch(`/log?worker-gate-${result}`);
  return new Response("", { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
};

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname === "/__gate") {
    e.respondWith(holdGate(e.clientId, url.searchParams));
  } else if (url.pathname === "/__frame/trusted") {
    e.respondWith(sandboxed(blobFrame(trustedFrame(url.searchParams.get("secret")))));
  } else if (url.pathname === "/__frame/pii") {
    e.respondWith(sandboxed(piiRelay(PII_FRAME, url.pathname)));
  }
});
