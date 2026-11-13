// The trusted scope server for the "pii" scope. It gives the profile server the
// PII encrypted with AES-256-GCM under a per-session key, and gives the pii scope
// frame that key.
import { createCipheriv, randomBytes } from "node:crypto";
import { serve } from "./ipc.ts";
import { PII } from "./profile-db.ts";
import { scopeWorker } from "./scope-worker.ts";

// The pii scope frame decrypts each frame's path, base64url(nonce || ciphertext ||
// tag), with AES-256-GCM and the session key.
const DECRYPT = `(() => {
  const fromBase64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  let key;
  return async (path, fetchSigned) => {
    key ??= fetchSigned("/session-key")
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((raw) => crypto.subtle.importKey("raw", fromBase64url(raw), "AES-GCM", false, ["decrypt"]));
    const sealed = fromBase64url(path.slice(1));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, 12) }, await key, sealed.subarray(12));
    return new TextDecoder().decode(plaintext);
  };
})()`;

const SW = scopeWorker({ frameContent: DECRYPT });
const sessionKeys = new Map<string, Buffer>();

const encrypt = (key: Buffer, plaintext: string) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
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
