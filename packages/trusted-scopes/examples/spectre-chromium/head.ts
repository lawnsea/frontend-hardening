// The trusted head script the router puts first in the profile page. It builds on
// the standard DOM API; a real deployment also saves every built-in it uses before
// untrusted code runs.
export function headScript(secret: string): string {
  return `(() => {
  // Refuses srcdoc, so untrusted code can't load its own sandboxed document in a
  // frame. The router's CSP allows only this policy, and only once.
  trustedTypes.createPolicy("default", {
    createHTML: (html, type, sink) => (/srcdoc/i.test(sink) ? null : html),
    createScript: (script) => script,
    createScriptURL: (url) => url,
  });

  // Without the worker, nothing holds untrusted code until the secret is redeemed,
  // so spend it before any untrusted code runs, then install the worker and
  // reload. There's no PII until the reload.
  if (navigator.serviceWorker.controller?.scriptURL !== new URL("/sw.js", location.href).href) {
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", "/redeem", false);
    xhr.send("${secret}");
    navigator.serviceWorker.register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => location.reload());
    return;
  }

  const trusted = document.createElement("iframe");
  trusted.src = "/__frame/trusted?secret=${secret}";

  // Set before the gate opens whenever the secret was redeemed, so before untrusted
  // code can mint a frame. If it's still null, there's no PII.
  let control = null;
  // Minted frames still waiting to post their port, with the path each loads.
  const minted = new Map();

  // These listeners are registered before untrusted code runs, so they see each
  // message first. The frames the worker serves are sandboxed, so their messages
  // have origin "null"; a document untrusted code can put in a frame under the
  // page's CSP has the page's origin, or can't run script.

  // The trusted frame posts its control port and a port for the worker while the
  // gate blocks the parser.
  const onTrustedMessage = (e) => {
    if (!e.isTrusted || e.origin !== "null" || e.source !== trusted.contentWindow?.[0]) return;
    e.stopImmediatePropagation();
    removeEventListener("message", onTrustedMessage, true);
    const [controlPort, workerPort] = e.ports;
    navigator.serviceWorker.controller?.postMessage(null, [workerPort]);
    control = controlPort;
  };
  addEventListener("message", onTrustedMessage, true);

  // Each minted frame posts the path it was served at and its port.
  addEventListener("message", (e) => {
    if (!e.isTrusted || e.origin !== "null" || !e.ports[0]) return;
    for (const [frame, path] of minted) {
      if (e.source !== frame.contentWindow || e.data?.path !== path) continue;
      e.stopImmediatePropagation();
      minted.delete(frame);
      control?.postMessage(null, [e.ports[0]]);
      return;
    }
  }, true);
  document.documentElement.append(trusted);

  // Returns a frame that shows the PII once its document posts its port.
  const mintPiiFrame = () => {
    const path = "/__frame/pii";
    const frame = document.createElement("iframe");
    frame.src = path;
    minted.set(frame, path);
    return frame;
  };
  Object.defineProperty(window, "trustedScopes", { value: Object.freeze({ mintPiiFrame }) });
})();`;
}
