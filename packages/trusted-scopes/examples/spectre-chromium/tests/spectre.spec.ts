import { expect, test, type Page } from "@playwright/test";
import { PII, startExample, type Example } from "../server.ts";

const UNTRUSTED = (e: string) => e.startsWith("untrusted-") || e.startsWith("breakout") || e.startsWith("attacker-");
let port = 5320;
let example: Example;
test.afterEach(() => example?.close());

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

// Where the reload's log entries start: the second time /profile was served.
const reloadStart = () => example.log.indexOf("profile-served", example.log.indexOf("profile-served") + 1);

// Loads the page, which spends its secret, registers the worker and reloads, and
// returns the log entries from the reload.
const loadThroughWorker = async (page: Page, path: string) => {
  await page.goto(`${example.url}${path}`);
  await expect.poll(reloadStart, { timeout: 10000 }).toBeGreaterThan(-1);
  await expect.poll(() => attackerDone(example.log.slice(reloadStart())), { timeout: 10000 }).toBe(true);
  return example.log.slice(reloadStart());
};

test("a load the worker doesn't control spends the secret before untrusted code runs", async ({ page }) => {
  // With the worker refused, the page stays on its uncontrolled load.
  example = await startExample(port++, { refuseWorker: true });
  await page.goto(`${example.url}/profile`);
  await expect.poll(() => attackerDone(example.log)).toBe(true);
  const deleted = example.log.indexOf("redeem-deleted");
  expect(deleted).toBeGreaterThan(-1);
  expect(example.log.findIndex(UNTRUSTED)).toBeGreaterThan(deleted);
  expect(example.log).toContain("attacker-found-secret-true");
  expect(example.log).toContain("attacker-redeem-410");
  expect(example.log.filter((e) => e.startsWith("redeem-ok"))).toEqual([]);
});

test("a load the worker doesn't control installs the worker and reloads", async ({ page }) => {
  example = await startExample(port++);
  const log = await loadThroughWorker(page, "/profile");
  expect(example.log.slice(0, reloadStart())).toContain("redeem-deleted");
  expect(log).toContain("redeem-ok-origin-null");
  await expect.poll(() => piiShown(page)).toBe(true);
});

for (const hangRedeem of [false, true]) {
  test(`the gate holds untrusted code until the secret is spent${hangRedeem ? " (redemption hangs)" : ""}`, async ({ page }) => {
    example = await startExample(port++, { hangRedeem });
    const log = await loadThroughWorker(page, "/profile");

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
  example = await startExample(port++);
  await loadThroughWorker(page, "/profile?attack");
  await page.waitForTimeout(1000);
  expect(example.log.filter((e) => e.startsWith("attacker-stole-"))).toEqual([]);
  await expect.poll(() => piiShown(page)).toBe(true);
});

for (const route of ["srcdoc", "sandboxed-srcdoc", "data", "blank", "trusted", "frames", "name"]) {
  test(`untrusted code can't load its own document in a minted frame (${route})`, async ({ page }) => {
    example = await startExample(port++);
    await loadThroughWorker(page, `/profile?nav=${route}`);
    await expect.poll(() => example.log.some((e) => e.startsWith(`attacker-${route}-`)), { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(2500);
    expect(example.log.filter((e) => e.startsWith("attacker-stole-"))).toEqual([]);
  });
}
