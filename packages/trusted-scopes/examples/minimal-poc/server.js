import { readFile } from "node:fs/promises";

// Stand-in for key provisioning, which is out of scope.
const RAW_KEY = "zN8v4aZdXLPA1-DgIWfrRKGijWXSvKGDoxtNOF38MtQ";

export const PROFILE = {
  name: "Roberta Jean Oppenheimer",
  address: "1701D Enterprise Loop\nHollywood, CA 90068",
};

// Plays the PII server. Returns base64url(IV || AES-GCM output), with a 12-byte IV.
async function encrypt(plaintext) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(RAW_KEY, "base64url"), "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return Buffer.concat([iv, new Uint8Array(sealed)]).toString("base64url");
}

// Plays the web server, which gets the PII from the PII server already encrypted.
async function profile() {
  const name = await encrypt(PROFILE.name);
  const address = await encrypt(PROFILE.address);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>minimal-poc</title>
    <script type="module">
      // The worker must be active before it can serve the frames.
      function activated(registration) {
        const worker = registration.installing ?? registration.waiting;
        return new Promise((resolve) =>
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated") resolve(worker);
          }),
        );
      }

      const scope = "/pii/";
      const registration =
        (await navigator.serviceWorker.getRegistrations()).find(
          (r) => r.scope === new URL(scope, location.href).href,
        ) ??
        (await navigator.serviceWorker.register("/pii/sw.js", { scope }));
      if (!registration.active) await activated(registration);

      for (const field of document.querySelectorAll("[data-pii]")) {
        const iframe = document.createElement("iframe");
        iframe.src = \`/pii/\${field.dataset.pii}\`;
        field.append(iframe);
      }
    </script>
  </head>
  <body>
    <h1>Profile</h1>
    <dl>
      <dt>Name:</dt>
      <dd data-pii="${name}"></dd>
      <dt>Address:</dt>
      <dd data-pii="${address}"></dd>
      <dt>Theme:</dt>
      <dd>Dark</dd>
    </dl>
  </body>
</html>
`;
}

// The PII server holds the key, so it serves the worker with the key built in.
async function worker() {
  const source = await readFile(new URL("sw.js", import.meta.url), "utf8");
  return `const RAW_KEY = ${JSON.stringify(RAW_KEY)};\n${source}`;
}

export function server() {
  return {
    name: "minimal-poc-server",
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const { pathname } = new URL(req.url, "http://localhost");
        if (pathname === "/profile") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(await profile());
        } else if (pathname === "/pii/sw.js") {
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.end(await worker());
        } else {
          next();
        }
      });
    },
  };
}
