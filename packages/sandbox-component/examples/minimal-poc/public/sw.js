// Stand-in for key provisioning, which is out of scope.
const RAW_KEY = "zN8v4aZdXLPA1-DgIWfrRKGijWXSvKGDoxtNOF38MtQ";

addEventListener("install", () => skipWaiting());
addEventListener("activate", (event) => event.waitUntil(activate()));
addEventListener("fetch", (event) => {
  const { pathname } = new URL(event.request.url);
  if (pathname === "/sandbox") {
    event.respondWith(sandbox());
  } else if (pathname === "/index.html") {
    event.waitUntil(sendSecret(event.resultingClientId));
    event.respondWith(fetch(event.request));
  }
});

async function activate() {
  await clients.claim();
  for (const client of await clients.matchAll({ type: "window" })) await sendSecret(client.id);
}

// The client for a navigation doesn't exist until its response arrives, so
// this resolves after the fetch handler forwards the request.
async function sendSecret(clientId) {
  const client = await clients.get(clientId);
  client?.postMessage(await encrypt("seatec astronomy"));
}

// Returns base64url(IV || AES-GCM output), with a 12-byte IV.
async function encrypt(plaintext) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.fromBase64(RAW_KEY, { alphabet: "base64url" }),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return out.toBase64({ alphabet: "base64url", omitPadding: true });
}

function sandbox() {
  const html = `<!doctype html>
<meta charset="utf-8">
<body>
  <script type="module">
    const RAW_KEY = ${JSON.stringify(RAW_KEY)};
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.fromBase64(RAW_KEY, { alphabet: "base64url" }),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const bytes = Uint8Array.fromBase64(location.search.slice(1), { alphabet: "base64url" });
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) },
      key,
      bytes.subarray(12),
    );
    const span = document.createElement("span");
    span.textContent = new TextDecoder().decode(plaintext);
    document.body.append(span);
  </script>
</body>
`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts",
    },
  });
}
