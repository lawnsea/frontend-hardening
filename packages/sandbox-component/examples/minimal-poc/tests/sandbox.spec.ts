import { expect, test } from "@playwright/test";

const PLAINTEXT = "seatec astronomy";

test("the frame shows the plaintext and the page sees only ciphertext", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);

  expect(await page.locator("iframe").getAttribute("src")).toMatch(/^\/sandbox\?[\w-]+$/);
  expect(await page.content()).not.toContain(PLAINTEXT);
});

test("the page gets the ciphertext on every load but registers only once", async ({ page }) => {
  await page.addInitScript(() => {
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (...args) {
      sessionStorage.setItem("registrations", String(Number(sessionStorage.getItem("registrations")) + 1));
      return register.apply(this, args);
    };
  });
  const registrations = () => page.evaluate(() => sessionStorage.getItem("registrations"));

  await page.goto("/index.html");
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);
  expect(await registrations()).toBe("1");

  await page.reload();
  // The worker's scope is /sandbox, so it never controls the page.
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);
  expect(await page.locator("iframe").count()).toBe(1);
  expect(await registrations()).toBe("1");
});

test("the frame has an opaque origin", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);

  const frame = page.frames().find((f) => new URL(f.url()).pathname === "/sandbox")!;
  expect(await frame.evaluate(() => self.origin)).toBe("null");
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument)).toBeNull();
});
