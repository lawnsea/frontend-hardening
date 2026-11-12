// The trusted script the router injects into the head of the profile page that runs before untrusted code
export function headScript(psk: string): string {
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

  // Without the controller worker, nothing holds untrusted code until the key is
  // redeemed, so revoke it before any untrusted code runs.
  const controller = navigator.serviceWorker.controller;
  if (controller?.scriptURL !== new URL("/sw.js", location.href).href) {
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", "/psk/${psk}", false);
    xhr.send();
    // If the page load was not controlled by any service worker, install the controller worker and reload the page
    if (!controller) {
      navigator.serviceWorker.register("/sw.js")
        .then(() => trustedGlobals.serviceWorker.ready)
        .then(() => location.reload());
    }
    return;
  }

  const controllerFrame = document.createElement("iframe");
  controllerFrame.src = "/controller-frame?psk=${psk}";
  controllerFrame.hidden = true;

  // The head script's end of the message channel that connects it to the controller frame
  let control = null;
  // Map from trusted frames that have not yet posted their ports to the frame's
  // expected path and what to do with the ports
  const pendingFrames = new trustedGlobals.Map();
  // The trusted scope objects, by scope
  const scopes = new trustedGlobals.Map();

  // These listeners are registered before untrusted code runs, so they see each
  // message first. Each trusted frame's blob:null document posts to the page, so
  // its messages have origin "null" and come from the trusted frame's first child.
  // A document untrusted code can put there under the page's CSP has the page's
  // origin, or can't run script.

  // Establish message channels connecting the controller frame to the trusted head script and the controller service worker
  const onControllerMessage = (event) => {
    const e = trustedGlobals.message(event);
    if (!e.isTrusted || e.origin !== "null") return;
    if (e.source !== trustedGlobals.iframe(controllerFrame).contentWindow?.[0]) return;
    e.stopImmediatePropagation();
    trustedGlobals.window.removeEventListener("message", onControllerMessage, true);
    trustedGlobals.serviceWorker.postMessage(controller, null, [e.ports[1]]);
    control = e.ports[0];
  };
  addEventListener("message", onControllerMessage, true);

  // Connect a scope frame or a scope's frame once it posts its ports
  addEventListener("message", (event) => {
    const e = trustedGlobals.message(event);
    if (!e.isTrusted || e.origin !== "null") return;
    const source = e.source;
    if (!source) return;
    let frame = null;
    let expected;
    pendingFrames.forEach((value, candidate) => {
      if (!frame && trustedGlobals.iframe(candidate).contentWindow?.[0] === source) {
        frame = candidate;
        expected = value;
      }
    });
    if (!frame) return;
    e.stopImmediatePropagation();
    pendingFrames.delete(frame);
    const reported = trustedGlobals.ownValue(e.data, "path");
    // Only a document a trusted worker serves can post from this frame with origin
    // "null", so a different path means the frame loaded the wrong one.
    if (reported !== expected.path) {
      throw new trustedGlobals.Error(\`A trusted frame's document was served at \${reported}, not \${expected.path}, so it isn't connected.\`);
    }
    expected.connect(e.ports);
  }, true);
  document.documentElement.append(controllerFrame);

  // Adds a trusted frame for path and connects it once it posts its ports.
  const addFrame = (path, connect) => {
    const frame = trustedGlobals.document.createElement("iframe");
    trustedGlobals.iframe(frame).src = path;
    pendingFrames.set(frame, { __proto__: null, path, connect });
    return frame;
  };

  // Create a new scope, register its service worker if necessary, and resolve to its trusted scope object
  const createScope = (scope) =>
    new trustedGlobals.Promise((resolve, reject) => {
      if (typeof scope !== "string" || !trustedGlobals.isScopeName(scope)) {
        return reject(new trustedGlobals.Error(\`"\${scope}" isn't a valid scope name: use lowercase letters, digits, and hyphens.\`));
      }
      if (scopes.has(scope)) return reject(new trustedGlobals.Error(\`The "\${scope}" scope already exists; use trustedScopes.scopes["\${scope}"].\`));
      if (!control) return reject(new trustedGlobals.Error("The controller frame isn't connected, so no scope can be created."));
      scopes.set(scope, null);
      const root = \`/trusted-scopes/\${scope}/\`;
      trustedGlobals.serviceWorker.register(\`\${root}sw.js\`, root, (worker) => {
        const scopeFrame = addFrame(root, (ports) => {
          const toController = ports[0];
          const toWorker = ports[1];
          const toScope = ports[2];
          trustedGlobals.port(control).postMessage({ __proto__: null, scope }, [toController]);
          trustedGlobals.serviceWorker.postMessage(worker, null, [toWorker]);
          const trustedScope = trustedGlobals.freeze({
            __proto__: null,
            name: scope,
            // Create a new trusted frame from a scope-relative path
            createFrame: (path) => {
              if (typeof path !== "string" || !trustedGlobals.isScopePath(path)) {
                throw new trustedGlobals.Error(\`"\${path}" isn't a valid frame path: use segments like "/name".\`);
              }
              return addFrame(root + path.slice(1), (framePorts) => {
                trustedGlobals.port(toScope).postMessage({ __proto__: null, path }, [framePorts[0]]);
                trustedGlobals.serviceWorker.postMessage(worker, null, [framePorts[1]]);
              });
            },
          });
          trustedGlobals.port(toScope).onmessage = (data) => {
            if (data === "ready") {
              scopes.set(scope, trustedScope);
              resolve(trustedScope);
            } else if (data === "failed") {
              scopes.delete(scope);
              reject(new trustedGlobals.Error(\`The router has no "\${scope}" scope, or refused to sign for it.\`));
            }
          };
        });
        trustedGlobals.iframe(scopeFrame).hidden = true;
        trustedGlobals.document.documentElement.append(scopeFrame);
      }, (error) => {
        scopes.delete(scope);
        reject(error);
      });
    });

  Object.defineProperty(window, "trustedScopes", {
    value: Object.freeze({
      createScope,
      // Get the trusted scope objects for the scopes created so far, by scope
      get scopes() {
        const snapshot = { __proto__: null };
        scopes.forEach((trustedScope, scope) => {
          if (trustedScope) snapshot[scope] = trustedScope;
        });
        return trustedGlobals.freeze(snapshot);
      },
    }),
  });

  // Returns the subset of the page's APIs this script uses after untrusted code
  // runs, built from built-ins saved now, so untrusted code can't replace them.
  function captureTrustedGlobals() {
    const { apply } = Reflect;
    const { freeze, getOwnPropertyDescriptor, hasOwn } = Object;
    const iterator = Symbol.iterator;
    const accessor = (proto, name) => getOwnPropertyDescriptor(proto, name);
    const SavedError = Error;
    const SavedMap = Map;
    const SavedPromise = Promise;
    const then = Promise.prototype.then;
    const test = RegExp.prototype.test;
    const scopeName = /^[a-z0-9-]+$/;
    const scopePath = /^(\\/[A-Za-z0-9_-]+)+$/;
    const { delete: mapDelete, forEach: mapForEach, get: mapGet, has: mapHas, set: mapSet } = Map.prototype;
    const createElement = Document.prototype.createElement;
    const documentElement = accessor(Document.prototype, "documentElement").get;
    const append = Element.prototype.append;
    const hidden = accessor(HTMLElement.prototype, "hidden").set;
    const iframeSrc = accessor(HTMLIFrameElement.prototype, "src").set;
    const iframeContentWindow = accessor(HTMLIFrameElement.prototype, "contentWindow").get;
    const addEventListener = EventTarget.prototype.addEventListener;
    const removeEventListener = EventTarget.prototype.removeEventListener;
    const stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
    const messageData = accessor(MessageEvent.prototype, "data").get;
    const messageOrigin = accessor(MessageEvent.prototype, "origin").get;
    const messagePorts = accessor(MessageEvent.prototype, "ports").get;
    const messageSource = accessor(MessageEvent.prototype, "source").get;
    const portPostMessage = MessagePort.prototype.postMessage;
    const portOnMessage = accessor(MessagePort.prototype, "onmessage").set;
    const workerPostMessage = ServiceWorker.prototype.postMessage;
    const workerState = accessor(ServiceWorker.prototype, "state").get;
    const register = ServiceWorkerContainer.prototype.register;
    const ready = accessor(ServiceWorkerContainer.prototype, "ready").get;
    const installing = accessor(ServiceWorkerRegistration.prototype, "installing").get;
    const waiting = accessor(ServiceWorkerRegistration.prototype, "waiting").get;
    const active = accessor(ServiceWorkerRegistration.prototype, "active").get;
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
      Promise: SavedPromise,
      freeze,
      // A Map whose methods untrusted code can't replace.
      Map: class {
        #map = new SavedMap();
        get(key) {
          return apply(mapGet, this.#map, [key]);
        }
        has(key) {
          return apply(mapHas, this.#map, [key]);
        }
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
      isScopeName: (s) => apply(test, scopeName, [s]),
      isScopePath: (s) => apply(test, scopePath, [s]),
      // The value of an object's own data property, ignoring its prototype chain.
      ownValue: (object, key) => {
        if (object === null || (typeof object !== "object" && typeof object !== "function")) return undefined;
        const descriptor = getOwnPropertyDescriptor(object, key);
        return descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
      },
      document: freeze({
        __proto__: null,
        createElement: (tag) => apply(createElement, doc, [tag]),
        documentElement: freeze({ __proto__: null, append: (node) => apply(append, apply(documentElement, doc, []), [node]) }),
      }),
      window: freeze({ __proto__: null, removeEventListener: (...args) => apply(removeEventListener, win, args) }),
      serviceWorker: freeze({
        __proto__: null,
        get ready() {
          return apply(ready, container, []);
        },
        postMessage: (worker, message, transfer = []) => apply(workerPostMessage, worker, [message, transferList(transfer)]),
        // Registers url for scope and calls onActive with the worker once it's activated.
        register: (url, scope, onActive, onError) => {
          const whenActivated = (registration) => {
            const current = apply(active, registration, []);
            if (current && apply(workerState, current, []) === "activated") return onActive(current);
            const worker = apply(installing, registration, []) ?? apply(waiting, registration, []) ?? current;
            apply(addEventListener, worker, ["statechange", () => {
              if (apply(workerState, worker, []) === "activated") onActive(worker);
            }]);
          };
          apply(then, apply(register, container, [url, { __proto__: null, scope }]), [whenActivated, onError]);
        },
      }),
      iframe: (frame) => ({
        __proto__: null,
        set src(url) {
          apply(iframeSrc, frame, [url]);
        },
        set hidden(value) {
          apply(hidden, frame, [value]);
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
        // Calls fn with the data of each message on the port.
        set onmessage(fn) {
          apply(portOnMessage, port, [(event) => fn(apply(messageData, event, []))]);
        },
      }),
    });
  }
})();`;
}
