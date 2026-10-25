import { expect, test } from "@playwright/test";

const PLAINTEXT = "seatec astronomy";

test("the frame shows the plaintext and the page sees only ciphertext", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);

  expect(await page.locator("iframe").getAttribute("src")).toMatch(/^\/sandbox\?[\w-]+$/);
  expect(await page.content()).not.toContain(PLAINTEXT);
});

test("the frame has an opaque origin", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.frameLocator("iframe").locator("span")).toHaveText(PLAINTEXT);

  const frame = page.frames().find((f) => new URL(f.url()).pathname === "/sandbox")!;
  expect(await frame.evaluate(() => self.origin)).toBe("null");
  expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument)).toBeNull();
});
