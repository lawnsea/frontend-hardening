import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVERS = { profile: "profile-server.js", pii: "pii-server.js" };

// Picks the server for a browser request by its path, or null to let Vite serve it.
function route(pathname) {
  if (pathname === "/profile") return "profile";
  if (pathname.startsWith("/pii/")) return "pii";
  return null;
}

// A Vite plugin that plays the L7 router. It runs each server as a subprocess,
// forwards requests to it over IPC, and relays requests between servers.
export function router() {
  return {
    name: "minimal-poc-router",
    configureServer(vite) {
      const servers = {};
      const pending = new Map();
      let nextId = 0;

      function request(name, req) {
        const id = nextId++;
        return new Promise((resolve) => {
          pending.set(id, resolve);
          servers[name].send({ id, request: req });
        });
      }

      for (const [name, file] of Object.entries(SERVERS)) {
        const child = fork(fileURLToPath(new URL(file, import.meta.url)));
        child.on("message", async (message) => {
          if (message.response) {
            pending.get(message.id)(message.response);
            pending.delete(message.id);
          } else if (message.fetch) {
            const { server, url } = message.fetch;
            child.send({ id: message.id, reply: await request(server, { method: "GET", url, headers: {} }) });
          }
        });
        servers[name] = child;
      }
      vite.httpServer?.once("close", () => Object.values(servers).forEach((child) => child.kill()));

      vite.middlewares.use(async (req, res, next) => {
        const name = route(new URL(req.url, "http://localhost").pathname);
        if (!name) return next();
        const { status, headers, body } = await request(name, {
          method: req.method,
          url: req.url,
          headers: req.headers,
        });
        res.writeHead(status, headers);
        res.end(body);
      });
    },
  };
}
