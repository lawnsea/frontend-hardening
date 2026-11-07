import { expect, test, type Page } from "@playwright/test";
import { PROFILE } from "../profile-db.js";

async function load(page: Page): Promise<void> {
  await page.goto("/profile");
  await expect(page.frameLocator("iframe").nth(0).locator("body")).toHaveText(PROFILE.name);
  await expect(page.frameLocator("iframe").nth(1).locator("body")).toHaveText(PROFILE.address.replace("\n", " "));
}

// Returns the name of the error that the page's code gets, or null.
function errorFromPage(page: Page, read: (frame: typeof globalThis) => unknown): Promise<string | null> {
  return page.evaluate(`(() => {
    const frame = document.querySelector("iframe").contentWindow;
    try {
      (${read})(frame);
      return null;
    } catch (e) {
      return e.name;
    }
  })()`);
}

test("the iframes contain the plaintext", async ({ page }) => {
  await load(page);
});

test("the page has only ciphertext", async ({ page }) => {
  await load(page);
  const html = await page.content();
  expect(html).not.toContain(PROFILE.name);
  expect(html).not.toContain("Enterprise Loop");
});

test("the network doesn't serve the frames", async ({ page }) => {
  await load(page);
  const src = await page.evaluate(() => document.querySelector("iframe")!.src);
  expect((await page.request.get(src)).status()).toBe(404);
});

test("the page can't access an iframe's JS scope", async ({ page }) => {
  await load(page);
  expect(await errorFromPage(page, (frame) => frame.eval("1"))).toBe("SecurityError");
  expect(await errorFromPage(page, (frame) => frame.crypto)).toBe("SecurityError");
});

test("the page can't access an iframe's DOM", async ({ page }) => {
  await load(page);
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument)).toBeNull();
  expect(await errorFromPage(page, (frame) => frame.document)).toBe("SecurityError");
});

test("the iframes have a null origin", async ({ page }) => {
  await load(page);
  const frames = page.frames().filter((f) => new URL(f.url()).pathname.startsWith("/pii/"));
  expect(frames).toHaveLength(2);
  for (const frame of frames) expect(await frame.evaluate(() => self.origin)).toBe("null");
});

test("the browser can't request a field from the PII server", async ({ page }) => {
  expect((await page.request.get("/pii/fields/name")).status()).toBe(404);
});

test("the page can't fetch the worker's source", async ({ page }) => {
  await load(page);
  const { status, body } = await page.evaluate(async () => {
    const response = await fetch("/pii/sw.js");
    return { status: response.status, body: await response.text() };
  });
  expect(status).toBe(403);
  expect(body).not.toContain("RAW_KEY");
});

test("the page can't read the worker's source from the HTTP cache", async ({ page }) => {
  await load(page);
  for (const cache of ["force-cache", "only-if-cached"] as const) {
    const body = await page.evaluate(
      (cache) =>
        fetch("/pii/sw.js", { cache, mode: "same-origin" }).then(
          (response) => response.text(),
          () => "",
        ),
      cache,
    );
    expect(body).not.toContain("RAW_KEY");
  }
});

test("the page can't read the worker's source with the Cache API", async ({ page }) => {
  await load(page);
  const { added, matched } = await page.evaluate(async () => {
    const cache = await caches.open("minimal-poc");
    const added = await cache.add("/pii/sw.js").then(
      () => true,
      () => false,
    );
    return { added, matched: (await caches.match("/pii/sw.js")) !== undefined };
  });
  expect(added).toBe(false);
  expect(matched).toBe(false);
});

test("the server forbids caching the worker's source", async ({ page }) => {
  const response = await page.request.get("/pii/sw.js", { headers: { "Sec-Fetch-Dest": "serviceworker" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
});
