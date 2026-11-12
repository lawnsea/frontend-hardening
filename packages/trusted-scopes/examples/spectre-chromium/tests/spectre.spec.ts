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
// script it's in, and looks for the secret and tries to redeem it.
const UNTRUSTED_HEAD = mark("untrusted-head-inline");
const UNTRUSTED_BODY = `
<!-- </script></body><script>fetch("/log?breakout")</script> -->
</script>${mark("breakout-2")}
<script>
  (window.order ??= []).push("untrusted-body-inline");
  fetch("/log?untrusted-body-inline");
  const stolen = [...document.scripts].map((s) => s.textContent).join("\\n").match(/secret=([\\w-]{43})/)?.[1];
  fetch("/log?attacker-found-secret-" + Boolean(stolen));
  fetch("/redeem", { method: "POST", body: stolen ?? "" }).then((r) => fetch("/log?attacker-redeem-" + r.status));
</script>
<script src="/untrusted.js"></script>
${mark("untrusted-after-external")}`;

const REPORT = `(m) => fetch("/log?attacker-stole-" + encodeURIComponent(m.data))`;

const FILES = {
  "/untrusted.js": {
    type: "text/javascript",
    body: `(window.order ??= []).push("untrusted-external"); fetch("/log?untrusted-external")`,
  },
  // Reports any port it's sent and the messages on it.
  "/evil": {
    type: "text/html",
    body: `<!doctype html><script>addEventListener("message", (e) => { const p = e.ports[0]; if (p) p.onmessage = ${REPORT}; });</script>`,
  },
};

// Takes the trusted frame's ports, or sends the trusted frame its own.
const STEAL_CONTROL = `<script>
  const trustedFrame = document.querySelector("html > iframe");
  addEventListener("message", (e) => {
    const control = e.ports[0];
    if (!control) return;
    const mint = new MessageChannel();
    mint.port1.onmessage = ${REPORT};
    control.postMessage(null, [mint.port2]);
  }, true);
  document.addEventListener("load", (e) => {
    if (e.target !== trustedFrame) return;
    e.stopImmediatePropagation();
    const control = new MessageChannel();
    const mint = new MessageChannel();
    mint.port1.onmessage = ${REPORT};
    control.port1.postMessage(null, [mint.port2]);
    trustedFrame.contentWindow.postMessage(null, "*", [control.port2]);
  }, true);
</script>`;

// Replaces MessagePort.prototype.postMessage, and uses any port the head script
// sends on to request the PII on a channel of its own.
const POLLUTE = `<script>
  const original = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, transfer) {
    const mint = new MessageChannel();
    mint.port1.onmessage = ${REPORT};
    original.call(this, null, [mint.port2]);
    return original.call(this, message, transfer);
  };
</script>`;

// Mints a PII frame and tries to load its own document in it, by `route`.
const loadOwnDocument = (route: string) => `<script>
  const route = ${JSON.stringify(route)};
  const listener = '<script>addEventListener("message", (e) => { const p = e.ports[0]; if (p) p.onmessage = (m) => fetch("' + location.origin + '/log?attacker-stole-" + encodeURIComponent(m.data)); });<' + '/script>';
  // Offers its own port as a PII frame's.
  const poser = 'const c = new MessageChannel(); c.port1.onmessage = (m) => fetch("' + location.origin + '/log?attacker-stole-" + encodeURIComponent(m.data)); parent.postMessage({ path: "/__frame/pii" }, "*", [c.port2]);';
  const attempt = (fn) => {
    try { fn(); fetch("/log?attacker-" + route + "-set"); } catch (e) { fetch("/log?attacker-" + route + "-threw-" + e.name); }
  };
  const frame = trustedScopes.mintPiiFrame();
  if (route === "srcdoc") attempt(() => { frame.srcdoc = listener; });
  if (route === "sandboxed-srcdoc") attempt(() => { frame.sandbox = "allow-scripts"; frame.srcdoc = "<script>" + poser + "<" + "/script>"; });
  if (route === "default-policy") attempt(() => {
    trustedTypes.createPolicy("default", { createHTML: (html) => html });
    frame.sandbox = "allow-scripts";
    frame.srcdoc = "<script>" + poser + "<" + "/script>";
  });
  if (route === "data") attempt(() => { frame.src = "data:text/html," + encodeURIComponent("<script>" + poser + "<" + "/script>"); });
  if (route === "trusted") attempt(() => { frame.src = "/__frame/trusted?secret=x"; });
  document.body.append(frame);
  if (route === "blank") {
    // about:blank has the page's origin.
    frame.contentWindow.location = "about:blank";
    setTimeout(() => attempt(() => {
      // The page's CSP lets each realm create one policy with this name.
      const policy = frame.contentWindow.trustedTypes.createPolicy("block-srcdoc", { createScript: (s) => s });
      const body = frame.contentDocument.body;
      body.setAttribute("onclick", policy.createScript(poser));
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

// Whether a blob:null frame, which can only be a minted PII frame, shows the PII.
const piiShown = async (page: Page) => {
  const blobFrames = page.frames().filter((f) => f.url().startsWith("blob:null/"));
  const texts = await Promise.all(blobFrames.map((f) => f.locator("body").textContent().catch(() => null)));
  return texts.includes(PII);
};

// Whether the attacker has logged both its search for the secret and its redemption
// attempt. Each is a separate fetch, so they can arrive in either order.
const attackerDone = (log: string[]) =>
  log.some((e) => e.startsWith("attacker-found-secret-")) && log.some((e) => e.startsWith("attacker-redeem-"));

// Where the reload's events start: the second time /profile was served.
const reloadStart = () => {
  const log = events();
  return log.indexOf("profile-served", log.indexOf("profile-served") + 1);
};

// Loads the page, which spends its secret, registers the worker and reloads, and
// returns the events from the reload.
const loadThroughWorker = async (page: Page, path = "/profile") => {
  await page.goto(`${example.url}${path}`);
  await expect.poll(reloadStart, { timeout: 10000 }).toBeGreaterThan(-1);
  await expect.poll(() => attackerDone(events().slice(reloadStart())), { timeout: 10000 }).toBe(true);
  return events().slice(reloadStart());
};

test("a load the worker doesn't control spends the secret before untrusted code runs", async ({ page }) => {
  // With the worker refused, the page stays on its uncontrolled load.
  example = await start({ pii: { refuseWorker: true } });
  await page.goto(`${example.url}/profile`);
  await expect.poll(() => attackerDone(events())).toBe(true);
  const log = events();
  const deleted = log.indexOf("redeem-deleted");
  expect(deleted).toBeGreaterThan(-1);
  expect(log.findIndex(UNTRUSTED)).toBeGreaterThan(deleted);
  expect(log).toContain("attacker-found-secret-true");
  expect(log).toContain("attacker-redeem-410");
  expect(log.filter((e) => e.startsWith("redeem-ok"))).toEqual([]);
});

test("a load the worker doesn't control installs the worker and reloads", async ({ page }) => {
  example = await start();
  const log = await loadThroughWorker(page);
  expect(events().slice(0, reloadStart())).toContain("redeem-deleted");
  expect(log).toContain("redeem-ok-origin-null");
  await expect.poll(() => piiShown(page)).toBe(true);
});

for (const hangRedeem of [false, true]) {
  test(`the gate holds untrusted code until the secret is spent${hangRedeem ? " (redemption hangs)" : ""}`, async ({ page }) => {
    example = await start({ pii: { hangRedeem } });
    const log = await loadThroughWorker(page);

    const spent = log.findIndex((e) => e.startsWith("redeem-ok") || e === "invalidated");
    const gate = log.findIndex((e) => e.startsWith("worker-gate-"));
    expect(spent).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(spent);
    expect(log.findIndex(UNTRUSTED)).toBeGreaterThan(gate);
    expect(log).toContain(hangRedeem ? "worker-gate-timeout" : "worker-gate-redeemed");
    expect(log).not.toContain("redeem-deleted");
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

test("untrusted code can't connect its own control port to the trusted frame", async ({ page }) => {
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

for (const route of ["srcdoc", "sandboxed-srcdoc", "default-policy", "data", "blank", "trusted", "frames", "name"]) {
  test(`untrusted code can't load its own document in a minted frame (${route})`, async ({ page }) => {
    example = await start({}, { body: loadOwnDocument(route) });
    await loadThroughWorker(page);
    await expect.poll(() => events().some((e) => e.startsWith(`attacker-${route}-`)), { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(2500);
    expect(stolen()).toEqual([]);
  });
}
