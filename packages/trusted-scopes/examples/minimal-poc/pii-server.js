import { readFile } from "node:fs/promises";
import { serve } from "./ipc.js";
import { PROFILE } from "./profile-db.js";

// Stand-in for key provisioning, which is out of scope.
const RAW_KEY = "zN8v4aZdXLPA1-DgIWfrRKGijWXSvKGDoxtNOF38MtQ";

// Returns base64url(IV || AES-GCM output), with a 12-byte IV.
async function encrypt(plaintext) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(RAW_KEY, "base64url"), "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return Buffer.concat([iv, new Uint8Array(sealed)]).toString("base64url");
}

// The worker decrypts the PII, so it's served with the key built in.
async function worker() {
  const source = await readFile(new URL("sw.js", import.meta.url), "utf8");
  return `const RAW_KEY = ${JSON.stringify(RAW_KEY)};\n${source}`;
}

serve(async ({ url, from }) => {
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/pii/sw.js") {
    return { status: 200, headers: { "Content-Type": "text/javascript; charset=utf-8" }, body: await worker() };
  }
  const field = pathname.match(/^\/pii\/fields\/(\w+)$/)?.[1];
  if (from === "profile" && field && Object.hasOwn(PROFILE, field)) {
    return { status: 200, headers: { "Content-Type": "text/plain" }, body: await encrypt(PROFILE[field]) };
  }
  // Only the worker answers /pii/<ciphertext>.
  return { status: 404, headers: {}, body: "" };
});
