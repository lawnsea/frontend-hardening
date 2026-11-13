// The trusted scope server for the "pii" scope. It gives the profile server the
// PII encrypted with a per-session key, and gives the pii scope frame that key.
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "./ipc.ts";
import { PII } from "./profile-db.ts";
import { scopeWorker } from "./scope-worker.ts";

// @noble/ciphers' ChaCha20-Poly1305, in dependency order.
const NOBLE = new URL(".", import.meta.resolve("@noble/ciphers/chacha.js"));
const MODULES = Object.fromEntries(
  ["utils.js", "_arx.js", "_poly1305.js", "chacha.js"].map((file) => [file, readFileSync(new URL(file, NOBLE), "utf8")]),
);

// The pii scope frame decrypts each frame's path, base64url(nonce || ciphertext ||
// tag), with the session key.
const DECRYPT = `(() => {
  const fromBase64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  let key;
  return async (path, fetchSigned, modules) => {
    key ??= fetchSigned("/session-key").then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then(fromBase64url);
    const sealed = fromBase64url(path.slice(1));
    const cipher = modules["chacha.js"].chacha20poly1305(await key, sealed.subarray(0, 12));
    return new TextDecoder().decode(cipher.decrypt(sealed.subarray(12)));
  };
})()`;

const SW = scopeWorker({ modules: MODULES, frameContent: DECRYPT });
const sessionKeys = new Map<string, Buffer>();

const encrypt = (key: Buffer, plaintext: string) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  return Buffer.concat([nonce, cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
};

const empty = (status: number) => ({ status, headers: {} as Record<string, string>, body: "" });

serve(async ({ url, from, session }) => {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  if (pathname === "/trusted-scopes/pii/sw.js") {
    return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }, body: SW };
  }
  // The profile server asks for the PII for the session the router gave it.
  if (pathname === "/trusted-scopes/pii/ciphertext" && from === "profile") {
    const id = searchParams.get("session");
    if (!id) return empty(400);
    if (!sessionKeys.has(id)) sessionKeys.set(id, randomBytes(32));
    return { status: 200, headers: { "Content-Type": "text/plain" }, body: encrypt(sessionKeys.get(id)!, PII) };
  }
  // The router forwards this only with the scope's MAC, and passes its session.
  if (pathname === "/trusted-scopes/pii/session-key" && session) {
    const key = sessionKeys.get(session);
    if (!key) return empty(404);
    return { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: key.toString("base64url") };
  }
  return empty(404);
});
