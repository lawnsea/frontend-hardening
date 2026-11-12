// The trusted script the router injects into the head of the profile page that runs before untrusted code
export function headScript(secret: string): string {
  // An IIFE keeps the script's bindings out of the global scope that all scripts
  // share, so untrusted code can't read or replace them.
  return `(() => {
  // Code that can run after untrusted code uses these instead of the page's globals.
  const trustedGlobals = captureTrustedGlobals();

  // The page's CSP allows only this policy, and only once.
  trustedTypes.createPolicy("default", {
    // Block srcdoc to prevent untrusted code from replacing the outer frame document with inline HTML
    createHTML: (html, type, sink) => (/srcdoc/i.test(sink) ? null : html),
    createScript: (script) => script,
    createScriptURL: (url) => url,
  });

  // If the page load was not controlled by the expected service worker, install it and reload the page
  const controller = navigator.serviceWorker.controller;
  if (controller?.scriptURL !== new URL("/sw.js", location.href).href) {
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", "/redeem", false);
    xhr.send("${secret}");
    navigator.serviceWorker.register("/sw.js")
      .then(() => trustedGlobals.serviceWorker.ready)
      .then(() => location.reload());
    return;
  }

  const trustedFrame = document.createElement("iframe");
  trustedFrame.src = "/__frame/trusted?secret=${secret}";

  // The head script's end of the message channel that connects it to the trusted frame
  let control = null;
  // Map from minted frames that have not yet posted their port to the frame's expected path
  const pendingFrames = new trustedGlobals.Map();

  // These listeners are registered before untrusted code runs, so they see each
  // message first. The frames the worker serves are sandboxed, so their messages
  // have origin "null"; a document untrusted code can put in a frame under the
  // page's CSP has the page's origin, or can't run script.

  // Establish message channels connecting the trusted frame to the trusted head script and the service worker
  const onTrustedMessage = (event) => {
    const e = trustedGlobals.message(event);
    if (!e.isTrusted || e.origin !== "null") return;
    if (e.source !== trustedGlobals.iframe(trustedFrame).contentWindow?.[0]) return;
    e.stopImmediatePropagation();
    trustedGlobals.window.removeEventListener("message", onTrustedMessage, true);
    trustedGlobals.serviceWorker.postMessage(controller, null, [e.ports[1]]);
    control = e.ports[0];
  };
  addEventListener("message", onTrustedMessage, true);

  // Establish a message channel between the trusted frame and a minted frame
  addEventListener("message", (event) => {
    const e = trustedGlobals.message(event);
    if (!e.isTrusted || e.origin !== "null") return;
    const source = e.source;
    const port = e.ports[0];
    if (!source || !port) return;
    let frame = null;
    let path;
    pendingFrames.forEach((expected, candidate) => {
      if (!frame && trustedGlobals.iframe(candidate).contentWindow === source) {
        frame = candidate;
        path = expected;
      }
    });
    if (!frame) return;
    e.stopImmediatePropagation();
    pendingFrames.delete(frame);
    const reported = trustedGlobals.ownValue(e.data, "path");
    // Only a document the worker serves can post from this frame with origin
    // "null", so a different path means the frame loaded the wrong one.
    if (reported !== path) {
      throw new trustedGlobals.Error(\`A minted frame's document was served at \${reported}, not \${path}, so it gets no PII.\`);
    }
    if (control) trustedGlobals.port(control).postMessage(null, [port]);
  }, true);
  document.documentElement.append(trustedFrame);

  // Returns a frame that shows the PII once its document posts its port.
  const mintPiiFrame = () => {
    const path = "/__frame/pii";
    const frame = trustedGlobals.document.createElement("iframe");
    trustedGlobals.iframe(frame).src = path;
    pendingFrames.set(frame, path);
    return frame;
  };
  Object.defineProperty(window, "trustedScopes", { value: Object.freeze({ mintPiiFrame }) });

  // Returns the subset of the page's APIs this script uses after untrusted code
  // runs, built from built-ins saved now, so untrusted code can't replace them.
  function captureTrustedGlobals() {
    const { apply } = Reflect;
    const { freeze, getOwnPropertyDescriptor, hasOwn } = Object;
    const iterator = Symbol.iterator;
    const accessor = (proto, name) => getOwnPropertyDescriptor(proto, name);
    const SavedError = Error;
    const SavedMap = Map;
    const { delete: mapDelete, forEach: mapForEach, set: mapSet } = Map.prototype;
    const createElement = Document.prototype.createElement;
    const iframeSrc = accessor(HTMLIFrameElement.prototype, "src").set;
    const iframeContentWindow = accessor(HTMLIFrameElement.prototype, "contentWindow").get;
    const removeEventListener = EventTarget.prototype.removeEventListener;
    const stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
    const messageData = accessor(MessageEvent.prototype, "data").get;
    const messageOrigin = accessor(MessageEvent.prototype, "origin").get;
    const messagePorts = accessor(MessageEvent.prototype, "ports").get;
    const messageSource = accessor(MessageEvent.prototype, "source").get;
    const portPostMessage = MessagePort.prototype.postMessage;
    const workerPostMessage = ServiceWorker.prototype.postMessage;
    const ready = accessor(ServiceWorkerContainer.prototype, "ready").get;
    const container = navigator.serviceWorker;
    const doc = document;
    const win = window;

    // A transfer list that doesn't use Array.prototype[Symbol.iterator] or the
    // array iterator's next.
    const transferList = (ports) => ({
      __proto__: null,
      [iterator]: () => {
        let i = 0;
        return {
          __proto__: null,
          next: () =>
            i < ports.length ? { __proto__: null, done: false, value: ports[i++] } : { __proto__: null, done: true },
        };
      },
    });

    return freeze({
      __proto__: null,
      Error: SavedError,
      // A Map whose methods untrusted code can't replace.
      Map: class {
        #map = new SavedMap();
        set(key, value) {
          apply(mapSet, this.#map, [key, value]);
          return this;
        }
        delete(key) {
          return apply(mapDelete, this.#map, [key]);
        }
        forEach(fn) {
          apply(mapForEach, this.#map, [fn]);
        }
      },
      // The value of an object's own data property, ignoring its prototype chain.
      ownValue: (object, key) => {
        if (object === null || (typeof object !== "object" && typeof object !== "function")) return undefined;
        const descriptor = getOwnPropertyDescriptor(object, key);
        return descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
      },
      document: freeze({ __proto__: null, createElement: (tag) => apply(createElement, doc, [tag]) }),
      window: freeze({ __proto__: null, removeEventListener: (...args) => apply(removeEventListener, win, args) }),
      serviceWorker: freeze({
        __proto__: null,
        get ready() {
          return apply(ready, container, []);
        },
        postMessage: (worker, message, transfer = []) => apply(workerPostMessage, worker, [message, transferList(transfer)]),
      }),
      iframe: (frame) => ({
        __proto__: null,
        set src(url) {
          apply(iframeSrc, frame, [url]);
        },
        get contentWindow() {
          return apply(iframeContentWindow, frame, []);
        },
      }),
      // isTrusted is an own, unforgeable property of each event.
      message: (event) => ({
        __proto__: null,
        isTrusted: event.isTrusted,
        get data() {
          return apply(messageData, event, []);
        },
        get origin() {
          return apply(messageOrigin, event, []);
        },
        get ports() {
          return apply(messagePorts, event, []);
        },
        get source() {
          return apply(messageSource, event, []);
        },
        stopImmediatePropagation: () => apply(stopImmediatePropagation, event, []),
      }),
      port: (port) => ({
        __proto__: null,
        postMessage: (message, transfer = []) => apply(portPostMessage, port, [message, transferList(transfer)]),
      }),
    });
  }
})();`;
}
