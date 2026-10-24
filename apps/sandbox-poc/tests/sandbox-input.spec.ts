import { expect, test, type Page } from "@playwright/test";

const SSN = "078-05-1120";

async function frameInput(page: Page) {
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const frame = page.frames().find((f) => new URL(f.url()).pathname === "/sandbox/input")!;
  return frame.locator("input");
}

const hostValue = (page: Page) =>
  page.locator("sandbox-input").evaluate((el) => (el as HTMLInputElement).value);

test("the frame shows plaintext and the host sees only ciphertext", async ({ page }) => {
  await page.goto("/");
  await expect(await frameInput(page)).toHaveValue(SSN);

  expect(await hostValue(page)).not.toBe("");
  expect(await hostValue(page)).not.toContain(SSN);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(SSN);
});

test("edits reach the server as plaintext and the host as ciphertext", async ({ page }) => {
  await page.goto("/");
  const input = await frameInput(page);
  await expect(input).toHaveValue(SSN);
  const before = await hostValue(page);

  await input.fill("123-45-6789");
  await expect.poll(() => hostValue(page)).not.toBe(before);
  expect(await hostValue(page)).not.toContain("123-45-6789");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("form[data-saved]")).toBeAttached();
  // Playwright's request context bypasses the worker, so this reads the server.
  expect((await (await page.request.get("/api/profile")).json()).ssn).toBe("123-45-6789");

  await page.request.put("/api/profile", { data: { name: "Ada Lovelace", ssn: SSN } });
});

// The element's frame sits in a closed shadow root, so the host loads its own
// copy without a sandbox attribute.
test("the host can't read a sandbox frame's document", async ({ page }) => {
  await page.goto("/");
  await expect(await frameInput(page)).toHaveValue(SSN);
  const result = await page.evaluate(async () => {
    const iframe = document.createElement("iframe");
    iframe.src = "/sandbox/input";
    const loaded = new Promise((resolve) => iframe.addEventListener("load", resolve));
    document.body.append(iframe);
    await loaded;
    try {
      return { contentDocument: iframe.contentDocument, document: String(iframe.contentWindow!.document) };
    } catch (e) {
      return { contentDocument: iframe.contentDocument, document: (e as Error).name };
    }
  });
  expect(result).toEqual({ contentDocument: null, document: "SecurityError" });
});

test("the worker serves sandbox frames only to navigations", async ({ page }) => {
  await page.goto("/");
  await expect(await frameInput(page)).toHaveValue(SSN);
  expect(await page.evaluate(async () => (await fetch("/sandbox/input")).status)).toBe(404);
});

test("the server never serves sandbox frames", async ({ request }) => {
  expect((await request.get("/sandbox/input")).status()).toBe(404);
});

test("the server rejects worker script requests for unexpected URLs", async ({ request }) => {
  const headers = { "Service-Worker": "script" };
  expect((await request.get("/src/main.ts", { headers })).status()).toBe(403);
  expect((await request.get("/sw.js", { headers })).status()).toBe(200);
});
