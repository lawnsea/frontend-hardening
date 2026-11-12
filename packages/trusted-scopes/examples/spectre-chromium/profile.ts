// The untrusted profile page. Each script logs to the server and records its order.
// Query parameters turn on the attacks the tests check:
// - `?attack`: takes the trusted frame's ports, or sends the trusted frame its own.
// - `?nav=<route>`: mints a PII frame and tries to load its own document in it.
// The body script always looks for the secret and tries to redeem it.
export const PROFILE_PAGE = `<!doctype html>
<html><head><title>Profile</title>
<script>
  const trustedFrame = document.querySelector("html > iframe");
  if (location.search === "?attack") {
    const report = (m) => fetch("/log?attacker-stole-" + encodeURIComponent(m.data));
    addEventListener("message", (e) => {
      const control = e.ports[0];
      if (!control) return;
      const mint = new MessageChannel();
      mint.port1.onmessage = report;
      control.postMessage(null, [mint.port2]);
    }, true);
    document.addEventListener("load", (e) => {
      if (e.target !== trustedFrame) return;
      e.stopImmediatePropagation();
      const control = new MessageChannel();
      const mint = new MessageChannel();
      mint.port1.onmessage = report;
      control.port1.postMessage(null, [mint.port2]);
      trustedFrame.contentWindow.postMessage(null, "*", [control.port2]);
    }, true);
  }
</script>
<script>(window.order ??= []).push("untrusted-head-inline"); fetch("/log?untrusted-head-inline")</script>
</head><body>
<h1>Profile</h1>
<script>if (window.trustedScopes) document.body.append(trustedScopes.mintPiiFrame());</script>
<!-- </script></body><script>fetch("/log?breakout")</script> -->
</script><script>(window.order ??= []).push("breakout-2"); fetch("/log?breakout-2")</script>
<script>
  (window.order ??= []).push("untrusted-body-inline");
  fetch("/log?untrusted-body-inline");
  const sources = [...document.scripts].map((s) => s.textContent).join("\\n");
  const stolen = sources.match(/secret=([\\w-]{43})/)?.[1];
  fetch("/log?attacker-found-secret-" + Boolean(stolen));
  fetch("/redeem", { method: "POST", body: stolen ?? "" }).then((r) => fetch("/log?attacker-redeem-" + r.status));
</script>
<script>
  const route = new URLSearchParams(location.search).get("nav");
  if (route) {
    const report = '(m) => fetch("' + location.origin + '/log?attacker-stole-" + encodeURIComponent(m.data))';
    const listener = '<script>addEventListener("message", (e) => { const p = e.ports[0]; if (p) p.onmessage = ' + report + '; });<' + '/script>';
    // Offers its own port as a PII frame's.
    const poser = 'const c = new MessageChannel(); c.port1.onmessage = ' + report + '; parent.postMessage({ path: "/__frame/pii" }, "*", [c.port2]);';
    const attempt = (fn) => {
      try { fn(); fetch("/log?attacker-" + route + "-set"); } catch (e) { fetch("/log?attacker-" + route + "-threw-" + e.name); }
    };
    const frame = trustedScopes.mintPiiFrame();
    if (route === "srcdoc") attempt(() => { frame.srcdoc = listener; });
    if (route === "sandboxed-srcdoc") attempt(() => { frame.sandbox = "allow-scripts"; frame.srcdoc = "<script>" + poser + "<" + "/script>"; });
    if (route === "data") attempt(() => { frame.src = "data:text/html," + encodeURIComponent("<script>" + poser + "<" + "/script>"); });
    if (route === "trusted") attempt(() => { frame.src = "/__frame/trusted?secret=x"; });
    document.body.append(frame);
    if (route === "blank") {
      // about:blank has this page's origin.
      frame.contentWindow.location = "about:blank";
      setTimeout(() => attempt(() => {
        frame.contentWindow.trustedTypes.createPolicy("default", { createScript: (s) => s });
        const body = frame.contentDocument.body;
        body.setAttribute("onclick", poser);
        body.click();
      }), 500);
    }
    if (route === "frames") attempt(() => { window[window.length - 1].location = "/evil"; });
    if (route === "name") {
      const start = Date.now();
      const poll = () => {
        for (let i = 0; i < window.length; i++) {
          try {
            if (window[i].pii) return void attempt(() => open("/evil", "pii"));
          } catch {}
        }
        if (Date.now() - start < 2000) setTimeout(poll);
        else fetch("/log?attacker-name-not-found");
      };
      poll();
    }
  }
</script>
<script src="/untrusted.js"></script>
<script>(window.order ??= []).push("untrusted-after-external"); fetch("/log?untrusted-after-external")</script>
</body></html>`;

export const UNTRUSTED_JS = `(window.order ??= []).push("untrusted-external"); fetch("/log?untrusted-external")`;

// A document that reports any port it's sent and the messages on it.
export const EVIL_PAGE = `<!doctype html><script>addEventListener("message", (e) => { const p = e.ports[0]; if (p) p.onmessage = (m) => fetch("/log?attacker-stole-" + encodeURIComponent(m.data)); });</script>`;
