// The server defines RAW_KEY above this line when it serves the worker at /pii/sw.js.

addEventListener("install", () => skipWaiting());
addEventListener("fetch", (event) => {
  const { pathname } = new URL(event.request.url);
  if (pathname.startsWith("/pii/")) {
    event.respondWith(frame(pathname.slice("/pii/".length)));
  }
});

async function decrypt(ciphertext) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.fromBase64(RAW_KEY, { alphabet: "base64url" }),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const bytes = Uint8Array.fromBase64(ciphertext, { alphabet: "base64url" });
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return new TextDecoder().decode(plaintext);
}

async function frame(ciphertext) {
  const html = `<!doctype html>
<meta charset="utf-8">
<body style="white-space: pre-line">${await decrypt(ciphertext)}</body>
`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox",
    },
  });
}
