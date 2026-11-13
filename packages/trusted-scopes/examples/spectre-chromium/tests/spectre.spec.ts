import { expect, test, type Page } from "@playwright/test";
import { PII } from "../profile-db.ts";
import { startExample, type Example, type Options } from "../router.ts";

let port = 5320;
let example: Example;
test.afterEach(() => example?.close());

// Records that an untrusted script ran, in run order on the page and in the
// router's log as a request to /log.
const mark = (name: string) => `<script>(window.order ??= []).push("${name}"); fetch("/log?${name}")</script>`;

// Untrusted markup that marks when untrusted code runs, tries to break out of the
// script it's in, and looks for the key and tries to redeem it.
const UNTRUSTED_HEAD = mark("untrusted-head-inline");
const UNTRUSTED_BODY = `
<!-- </script></body><script>fetch("/log?breakout")</script> -->
</script>${mark("breakout-2")}
<script>
  (window.order ??= []).push("untrusted-body-inline");
  fetch("/log?untrusted-body-inline");
  const stolen = [...document.scripts].map((s) => s.textContent).join("\\n").match(/psk[=/]([\\w-]{43})/)?.[1];
  fetch("/log?attacker-found-secret-" + Boolean(stolen));
  fetch("/psk/" + (stolen ?? "none")).then((r) => fetch("/log?attacker-redeem-" + r.status));
</script>
<script src="/untrusted.js"></script>
${mark("untrusted-after-external")}`;

// Reports whatever arrives on a port.
const REPORT = `(m) => fetch(location.origin + "/log?attacker-stole-" + encodeURIComponent(JSON.stringify(m.data)))`;

const FILES = {
  "/untrusted.js": {
    type: "text/javascript",
    body: `(window.order ??= []).push("untrusted-external"); fetch("/log?untrusted-external")`,
  },
  "/evil": {
    type: "text/html",
    body: `<!doctype html><script>addEventListener("message", (e) => { const p = e.ports[0]; if (p) p.onmessage = ${REPORT}; });</script>`,
  },
};

// Takes the controller frame's ports, or sends the controller frame its own.
const STEAL_CONTROL = `<script>
  const controllerFrame = document.querySelector("html > iframe");
  addEventListener("message", (e) => {
    const control = e.ports[0];
    if (!control) return;
    const mint = new MessageChannel();
    mint.port1.onmessage = ${REPORT};
    control.postMessage({ scope: "pii" }, [mint.port2]);
  }, true);
  document.addEventListener("load", (e) => {
    if (e.target !== controllerFrame) return;
    e.stopImmediatePropagation();
    const control = new MessageChannel();
    const mint = new MessageChannel();
    mint.port1.onmessage = ${REPORT};
    control.port1.postMessage({ scope: "pii" }, [mint.port2]);
    controllerFrame.contentWindow.postMessage(null, "*", [control.port2]);
  }, true);
</script>`;

// Replaces MessagePort.prototype.postMessage, and asks any port the head script
// sends on for the pii scope's MAC on a channel of its own.
const POLLUTE = `<script>
  const original = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, transfer) {
    const mint = new MessageChannel();
    mint.port1.onmessage = ${REPORT};
    original.call(this, { scope: "pii" }, [mint.port2]);
    return original.call(this, message, transfer);
  };
</script>`;

// Creates a frame in the pii scope and tries to load its own document in it, by
// `route`. Its document adds a child frame that posts as the frame's blob:null
// document would. The page's CSP lets each document create a default policy once.
const loadOwnDocument = (route: string) => `<script>
  const route = ${JSON.stringify(route)};
  // The child posts what it gets back to this page, which reports it.
  addEventListener("message", (e) => {
    if (e.data && "stolen" in e.data) fetch("/log?attacker-stole-" + encodeURIComponent(JSON.stringify(e.data.stolen)));
  });
  const ciphertext = document.getElementById("name").dataset.ciphertext;
  const child = 'const c = new MessageChannel(); c.port1.onmessage = (m) => parent.parent.postMessage({ stolen: m.data }, "*"); parent.parent.postMessage({ path: "/trusted-scopes/pii/' + ciphertext + '" }, "*", [c.port2, new MessageChannel().port2]);';
  const poser = 'try { trustedTypes.createPolicy("default", { createHTML: (s) => s }); } catch {} const child = document.createElement("iframe"); child.srcdoc = "<script>" + ' + JSON.stringify(child) + ' + "<" + "/script>"; document.documentElement.append(child);';
  const attempt = (fn) => {
    try { fn(); fetch("/log?attacker-" + route + "-set"); } catch (e) { fetch("/log?attacker-" + route + "-threw-" + e.name); }
  };
  const run = (frame) => {
    if (route === "srcdoc") attempt(() => { frame.srcdoc = "<script>" + poser + "<" + "/script>"; });
    if (route === "sandboxed-srcdoc") attempt(() => { frame.sandbox = "allow-scripts"; frame.srcdoc = "<script>" + poser + "<" + "/script>"; });
    if (route === "default-policy") attempt(() => {
      trustedTypes.createPolicy("default", { createHTML: (html) => html });
      frame.sandbox = "allow-scripts";
      frame.srcdoc = "<script>" + poser + "<" + "/script>";
    });
    if (route === "data") attempt(() => { frame.src = "data:text/html," + encodeURIComponent("<script>" + poser + "<" + "/script>"); });
    if (route === "controller") attempt(() => { frame.src = "/controller-frame?psk=x"; });
    document.body.append(frame);
    if (route === "blank") {
      // about:blank has the page's origin.
      frame.contentWindow.location = "about:blank";
      setTimeout(() => attempt(() => {
        const w = frame.contentWindow;
        w.trustedTypes.createPolicy("default", { createHTML: (s) => s, createScript: (s) => s });
        w.eval(poser);
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
  };
  const waitForScope = () => {
    const pii = trustedScopes.scopes.pii;
    if (pii) run(pii.createFrame("/" + ciphertext));
    else setTimeout(waitForScope, 20);
  };
  waitForScope();
</script>`;

const start = (opts: Options = {}, attack: { head?: string; body?: string } = {}) =>
  startExample(port++, {
    ...opts,
    profile: { head: (attack.head ?? "") + UNTRUSTED_HEAD, body: UNTRUSTED_BODY + (attack.body ?? ""), files: FILES },
  });

// The router's log, with each request to /log reduced to its query and other
// requests dropped.
const events = () =>
  example.log.flatMap((e) => (e.startsWith("request /log?") ? [e.slice("request /log?".length)] : e.startsWith("request ") ? [] : [e]));

const UNTRUSTED = (e: string) => e.startsWith("untrusted-") || e.startsWith("breakout") || e.startsWith("attacker-");
const stolen = () => events().filter((e) => e.startsWith("attacker-stole-"));

// Whether a blob:null frame, which can only be a trusted frame, shows the PII.
const piiShown = async (page: Page) => {
  const blobFrames = page.frames().filter((f) => f.url().startsWith("blob:null/"));
  const texts = await Promise.all(blobFrames.map((f) => f.locator("body").textContent().catch(() => null)));
  return texts.includes(PII);
};

// Whether the attacker has logged both its search for the key and its redemption
// attempt. Each is a separate fetch, so they can arrive in either order.
const attackerDone = (log: string[]) =>
  log.some((e) => e.startsWith("attacker-found-secret-")) && log.some((e) => e.startsWith("attacker-redeem-"));

// Where the reload's events start: the second time /profile was served.
const reloadStart = () => {
  const log = events();
  return log.indexOf("profile-served", log.indexOf("profile-served") + 1);
};

// Loads the page, which revokes its key, registers the controller worker and
// reloads, and returns the events from the reload.
const loadThroughWorker = async (page: Page, path = "/profile") => {
  await page.goto(`${example.url}${path}`);
  await expect.poll(reloadStart, { timeout: 10000 }).toBeGreaterThan(-1);
  await expect.poll(() => attackerDone(events().slice(reloadStart())), { timeout: 10000 }).toBe(true);
  return events().slice(reloadStart());
};

test("a load the controller worker doesn't control revokes the key before untrusted code runs", async ({ page }) => {
  // With the worker refused, the page stays on its uncontrolled load.
  example = await start({ refuseWorker: true });
  await page.goto(`${example.url}/profile`);
  await expect.poll(() => attackerDone(events())).toBe(true);
  const log = events();
  const revoked = log.indexOf("psk-revoked");
  expect(revoked).toBeGreaterThan(-1);
  expect(log.findIndex(UNTRUSTED)).toBeGreaterThan(revoked);
  expect(log).toContain("attacker-found-secret-true");
  expect(log).toContain("attacker-redeem-410");
  expect(log.filter((e) => e.startsWith("psk-redeemed"))).toEqual([]);
});

test("a load the controller worker doesn't control installs it and reloads", async ({ page }) => {
  example = await start();
  const log = await loadThroughWorker(page);
  expect(events().slice(0, reloadStart())).toContain("psk-revoked");
  expect(log).toContain("psk-redeemed-origin-null");
  await expect.poll(() => piiShown(page)).toBe(true);
});

for (const hangRedeem of [false, true]) {
  test(`untrusted code waits until the key is spent${hangRedeem ? " (redemption hangs)" : ""}`, async ({ page }) => {
    example = await start({ hangRedeem });
    const log = await loadThroughWorker(page);

    const spent = log.findIndex((e) => e.startsWith("psk-redeemed") || e === "psk-revoked");
    const ready = log.findIndex((e) => e.startsWith("worker-gate-"));
    expect(spent).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(spent);
    expect(log.findIndex(UNTRUSTED)).toBeGreaterThan(ready);
    expect(log).toContain(hangRedeem ? "worker-gate-timeout" : "worker-gate-ready");
    if (!hangRedeem) expect(log).not.toContain("psk-revoked");
    expect(log).toContain("attacker-found-secret-true");
    expect(log).toContain("attacker-redeem-410");
    expect(await page.evaluate(() => (window as unknown as { order: string[] }).order)).toEqual([
      "untrusted-head-inline",
      "breakout-2",
      "untrusted-body-inline",
      "untrusted-external",
      "untrusted-after-external",
    ]);
    if (hangRedeem) {
      await page.waitForTimeout(500);
      expect(await piiShown(page)).toBe(false);
    } else {
      await expect.poll(() => piiShown(page)).toBe(true);
    }
  });
}

test("the page has only the PII's ciphertext", async ({ page }) => {
  example = await start();
  await loadThroughWorker(page);
  await expect.poll(() => piiShown(page)).toBe(true);
  const html = await page.content();
  expect(html).not.toContain(PII);
  expect(await page.locator("#name").getAttribute("data-ciphertext")).toMatch(/^[\w-]{40,}$/);
});

test("the session key needs the pii scope's MAC", async ({ page }) => {
  example = await start();
  await loadThroughWorker(page);
  await expect.poll(() => piiShown(page)).toBe(true);
  const statuses = await page.evaluate(async () => {
    const get = (headers: Record<string, string>) => fetch("/trusted-scopes/pii/session-key", { headers }).then((r) => r.status);
    return [await get({}), await get({ "Trusted-Scope-Signature": "x.pii.y" })];
  });
  expect(statuses).toEqual([403, 403]);
  expect(events()).toContain("scope-forwarded-/trusted-scopes/pii/session-key");
  expect(events()).toContain("scope-refused-/trusted-scopes/pii/session-key");
});

test("a page can use several scopes", async ({ page }) => {
  example = await startExample(port++, { scopes: { echo: "tests/echo-scope-server.ts" } });
  await page.goto(`${example.url}/profile`);
  await expect.poll(() => piiShown(page), { timeout: 10000 }).toBe(true);
  const listed = await page.evaluate(async () => {
    const { trustedScopes } = window as unknown as {
      trustedScopes: { createScope(s: string): Promise<{ createFrame(p: string): HTMLIFrameElement }>; scopes: object };
    };
    const echo = await trustedScopes.createScope("echo");
    document.body.append(echo.createFrame("/greeting"));
    return Object.keys(trustedScopes.scopes);
  });
  expect(listed).toEqual(["pii", "echo"]);
  const texts = async () => Promise.all(page.frames().map((f) => f.locator("body").textContent().catch(() => null)));
  await expect.poll(texts).toContain("Hello from echo");
  expect(await piiShown(page)).toBe(true);
});

test("a later load reuses the registered scope worker", async ({ page }) => {
  example = await start();
  await loadThroughWorker(page);
  await expect.poll(() => piiShown(page)).toBe(true);
  await page.reload();
  await expect.poll(() => events().filter((e) => e === "profile-served").length).toBe(3);
  await expect.poll(() => piiShown(page)).toBe(true);
});

test("the scope worker gets a port from the scope frame and from each frame", async ({ page }) => {
  example = await start();
  await loadThroughWorker(page);
  await expect.poll(() => piiShown(page)).toBe(true);
  await expect.poll(() => events().filter((e) => e === "scope-worker-port-pii").length).toBe(2);
});

test("the router registers only the trusted workers", async ({ page }) => {
  example = await start();
  await loadThroughWorker(page);
  const outcomes = await page.evaluate(async () => {
    const outcome = (p: Promise<unknown>) => p.then(() => "registered", (e: Error) => e.name);
    return [
      await outcome(navigator.serviceWorker.register("/untrusted.js")),
      await outcome(navigator.serviceWorker.register("/trusted-scopes/pii/sw.js", { scope: "/" })),
    ];
  });
  expect(outcomes).not.toContain("registered");
  expect(events()).toContain("serviceworker-refused-/untrusted.js");
});

test("trustedScopes creates each scope once and lists it", async ({ page }) => {
  example = await start();
  await loadThroughWorker(page);
  await expect.poll(() => piiShown(page)).toBe(true);
  const result = await page.evaluate(async () => {
    const { trustedScopes } = window as unknown as {
      trustedScopes: { createScope(s: string): Promise<unknown>; scopes: Record<string, { name: string }> };
    };
    const outcome = (p: Promise<unknown>) => p.then(() => "resolved", (e: Error) => e.message);
    return {
      listed: Object.keys(trustedScopes.scopes),
      name: trustedScopes.scopes.pii.name,
      again: await outcome(trustedScopes.createScope("pii")),
      invalid: await outcome(trustedScopes.createScope("Not Valid")),
      unknown: await outcome(trustedScopes.createScope("nope")),
    };
  });
  expect(result.listed).toEqual(["pii"]);
  expect(result.name).toBe("pii");
  expect(result.again).toContain("already exists");
  expect(result.invalid).toContain("isn't a valid scope name");
  expect(result.unknown).not.toBe("resolved");
});

test("untrusted code can't connect its own control port to the controller frame", async ({ page }) => {
  example = await start({}, { head: STEAL_CONTROL });
  await loadThroughWorker(page);
  await page.waitForTimeout(1000);
  expect(stolen()).toEqual([]);
  await expect.poll(() => piiShown(page)).toBe(true);
});

test("untrusted code can't take the control port by replacing built-ins", async ({ page }) => {
  example = await start({}, { head: POLLUTE });
  await loadThroughWorker(page);
  await expect.poll(() => piiShown(page)).toBe(true);
  expect(stolen()).toEqual([]);
});

for (const route of ["srcdoc", "sandboxed-srcdoc", "default-policy", "data", "blank", "controller", "frames", "name"]) {
  test(`untrusted code can't load its own document in a scope's frame (${route})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    example = await start({}, { body: loadOwnDocument(route) });
    await loadThroughWorker(page);
    await expect.poll(() => events().some((e) => e.startsWith(`attacker-${route}-`)), { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(4000);
    expect(stolen()).toEqual([]);
    // The genuine controller frame's document reports its own path.
    if (route === "controller") expect(errors.some((m) => m.includes("served at /controller-frame"))).toBe(true);
  });
}
