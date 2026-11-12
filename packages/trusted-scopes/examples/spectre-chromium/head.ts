// The trusted script the router injects into the head of the profile page that runs before untrusted code
export function headScript(secret: string): string {
  // An IIFE keeps the script's bindings out of the global scope that all scripts
  // share, so untrusted code can't read or replace them.
  return `(() => {
  // Saved before untrusted code runs, for the code that runs after it.
  const { apply } = Reflect;
  const { getOwnPropertyDescriptor } = Object;
  const iterator = Symbol.iterator;
  const SavedError = Error;
  const { delete: mapDelete, forEach: mapForEach, set: mapSet } = Map.prototype;
  const createElement = Document.prototype.createElement;
  const setSrc = getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src").set;
  const contentWindow = getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow").get;
  const removeEventListener = EventTarget.prototype.removeEventListener;
  const stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
  const eventGetter = (name) => getOwnPropertyDescriptor(MessageEvent.prototype, name).get;
  const eventData = eventGetter("data");
  const eventOrigin = eventGetter("origin");
  const eventPorts = eventGetter("ports");
  const eventSource = eventGetter("source");
  // isTrusted is an own, unforgeable property of each event.
  const isTrusted = (e) => e.isTrusted;
  const portPostMessage = MessagePort.prototype.postMessage;
  const workerPostMessage = ServiceWorker.prototype.postMessage;
  const readyGetter = getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, "ready").get;
  const container = navigator.serviceWorker;
  const controller = container.controller;
  const doc = document;

  // A transfer list that doesn't use Array.prototype[Symbol.iterator] or the
  // array iterator's next.
  const transfer = (port) => ({
    __proto__: null,
    [iterator]: () => {
      let done = false;
      return {
        __proto__: null,
        next: () => (done ? { __proto__: null, done } : ((done = true), { __proto__: null, done: false, value: port })),
      };
    },
  });

  // The page's CSP allows only this policy, and only once.
  const policy = trustedTypes.createPolicy("block-srcdoc", {
    // Block srcdoc to prevent untrusted code from replacing the outer frame document with inline HTML
    createHTML: (html, type, sink) => (/srcdoc/i.test(sink) ? null : html),
    createScript: (script) => script,
    createScriptURL: (url) => url,
  });

  // If the page load was not controlled by the expected service worker, install it and reload the page
  if (controller?.scriptURL !== new URL("/sw.js", location.href).href) {
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", "/redeem", false);
    xhr.send("${secret}");
    container.register(policy.createScriptURL("/sw.js"))
      .then(() => apply(readyGetter, container, []))
      .then(() => location.reload());
    return;
  }

  const trusted = doc.createElement("iframe");
  trusted.src = "/__frame/trusted?secret=${secret}";

  // The head script's end of the message channel that connects it to the trusted frame
  let control = null;
  // Map from minted frames that have not yet posted their port to the frame's expected path
  const pendingFrames = new Map();

  // These listeners are registered before untrusted code runs, so they see each
  // message first. The frames the worker serves are sandboxed, so their messages
  // have origin "null"; a document untrusted code can put in a frame under the
  // page's CSP has the page's origin, or can't run script.

  // Establish message channels connecting the trusted frame to the trusted head script and the service worker
  const onTrustedMessage = (e) => {
    if (!isTrusted(e) || apply(eventOrigin, e, []) !== "null") return;
    if (apply(eventSource, e, []) !== apply(contentWindow, trusted, [])?.[0]) return;
    apply(stopImmediatePropagation, e, []);
    apply(removeEventListener, window, ["message", onTrustedMessage, true]);
    const ports = apply(eventPorts, e, []);
    apply(workerPostMessage, controller, [null, transfer(ports[1])]);
    control = ports[0];
  };
  addEventListener("message", onTrustedMessage, true);

  // Establish a message channel between the trusted frame and a minted frame
  addEventListener("message", (e) => {
    if (!isTrusted(e) || apply(eventOrigin, e, []) !== "null") return;
    const source = apply(eventSource, e, []);
    const port = apply(eventPorts, e, [])[0];
    if (!source || !port) return;
    let frame = null;
    let path;
    apply(mapForEach, pendingFrames, [(expected, candidate) => {
      if (!frame && apply(contentWindow, candidate, []) === source) {
        frame = candidate;
        path = expected;
      }
    }]);
    if (!frame) return;
    apply(stopImmediatePropagation, e, []);
    apply(mapDelete, pendingFrames, [frame]);
    const data = apply(eventData, e, []);
    const reported = data !== null && typeof data === "object" ? getOwnPropertyDescriptor(data, "path")?.value : undefined;
    // Only a document the worker serves can post from this frame with origin
    // "null", so a different path means the frame loaded the wrong one.
    if (reported !== path) {
      throw new SavedError(\`A minted frame's document was served at \${reported}, not \${path}, so it gets no PII.\`);
    }
    if (control) apply(portPostMessage, control, [null, transfer(port)]);
  }, true);
  doc.documentElement.append(trusted);

  // Returns a frame that shows the PII once its document posts its port.
  const mintPiiFrame = () => {
    const path = "/__frame/pii";
    const frame = apply(createElement, doc, ["iframe"]);
    apply(setSrc, frame, [path]);
    apply(mapSet, pendingFrames, [frame, path]);
    return frame;
  };
  Object.defineProperty(window, "trustedScopes", { value: Object.freeze({ mintPiiFrame }) });
})();`;
}
