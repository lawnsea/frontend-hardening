// Runs a server module as a subprocess of the router. The router forwards it
// requests over IPC, and it can send requests to the other servers the same way.

const pending = new Map();
let nextId = 0;

// handle takes { method, url, headers, from } and returns { status, headers, body },
// where from names the server that sent the request, or is undefined for the browser.
export function serve(handle) {
  process.on("message", async (message) => {
    if (message.request) {
      process.send({ id: message.id, response: await handle(message.request) });
    } else if (message.reply) {
      pending.get(message.id)(message.reply);
      pending.delete(message.id);
    }
  });
  process.on("disconnect", () => process.exit());
}

// Sends a GET request for url to the named server, through the router.
export function request(server, url) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    process.send({ id, fetch: { server, url } });
  });
}
