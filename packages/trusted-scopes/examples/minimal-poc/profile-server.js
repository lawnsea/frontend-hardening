import { request, serve } from "./ipc.js";

function page({ name, address }) {
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

serve(async () => {
  const [name, address] = await Promise.all(["name", "address"].map((field) => request("pii", `/pii/fields/${field}`)));
  return {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: page({ name: name.body, address: address.body }),
  };
});
