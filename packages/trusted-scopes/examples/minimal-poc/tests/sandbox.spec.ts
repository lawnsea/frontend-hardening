import { expect, test, type Page } from "@playwright/test";

const PLAINTEXT = "setec astronomy";

async function load(page: Page): Promise<void> {
  await page.goto("/index.html");
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);
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

test("the iframe contains the plaintext", async ({ page }) => {
  await load(page);
});

test("the page can't access the iframe's JS scope", async ({ page }) => {
  await load(page);
  expect(await errorFromPage(page, (frame) => frame.eval("1"))).toBe("SecurityError");
  expect(await errorFromPage(page, (frame) => frame.crypto)).toBe("SecurityError");
});

test("the page can't access the iframe's DOM", async ({ page }) => {
  await load(page);
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument)).toBeNull();
  expect(await errorFromPage(page, (frame) => frame.document)).toBe("SecurityError");
});

test("the iframe has a null origin", async ({ page }) => {
  await load(page);
  const frame = page.frames().find((f) => new URL(f.url()).pathname === "/sandbox")!;
  expect(await frame.evaluate(() => self.origin)).toBe("null");
});
