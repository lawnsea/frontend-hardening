import { decrypt, encrypt, importKey } from "./crypto.ts";
import { frameMain } from "./frame.ts";

declare const self: ServiceWorkerGlobalScope;

// Stand-in for key provisioning, which is out of scope. See
// packages/sandbox-component/docs/design.md.
const RAW_KEY = "zN8v4aZdXLPA1-DgIWfrRKGijWXSvKGDoxtNOF38MtQ";
const key = importKey(RAW_KEY);
const PII_FIELDS = ["ssn"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/sandbox/")) {
    event.respondWith(sandbox(event.request, url));
  } else if (url.pathname === "/api/profile") {
    event.respondWith(profile(event.request));
  }
});

async function sandbox(request: Request, url: URL): Promise<Response> {
  // The CSP sandbox directive applies only to documents, so serving a fetch
  // would hand the key to the caller.
  if (request.mode !== "navigate" || url.pathname !== "/sandbox/input") {
    return new Response(null, { status: 404 });
  }
  return new Response(frameDocument(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts",
    },
  });
}

function frameDocument(): string {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; }
  input { box-sizing: border-box; width: 100%; font: inherit; }
</style>
<input>
<script>
${importKey}
${encrypt}
${decrypt}
(${frameMain})(${JSON.stringify(RAW_KEY)});
</script>
`;
}

async function profile(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const data = await (await fetch(request)).json();
    for (const field of PII_FIELDS) data[field] = await encrypt(await key, data[field]);
    return Response.json(data);
  }
  if (request.method === "PUT") {
    const data = await request.json();
    for (const field of PII_FIELDS) data[field] = await decrypt(await key, data[field]);
    return fetch(request.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }
  return fetch(request);
}
