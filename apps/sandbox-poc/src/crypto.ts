// The worker inlines these functions into the frame document with
// Function.prototype.toString, so they must not reference anything outside
// their own bodies except each other.
//
// Ciphertext is base64url(IV || AES-GCM output), with a 12-byte IV.

export async function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.fromBase64(raw, { alphabet: "base64url" }),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return out.toBase64({ alphabet: "base64url", omitPadding: true });
}

export async function decrypt(key: CryptoKey, ciphertext: string): Promise<string> {
  const bytes = Uint8Array.fromBase64(ciphertext, { alphabet: "base64url" });
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, 12) },
    key,
    bytes.subarray(12),
  );
  return new TextDecoder().decode(plaintext);
}
