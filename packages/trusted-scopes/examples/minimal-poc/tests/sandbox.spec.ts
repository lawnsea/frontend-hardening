import { expect, test, type Page } from "@playwright/test";
import { PROFILE } from "../server.js";

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
