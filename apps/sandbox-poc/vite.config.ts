import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

// Trusted worker scripts. Requests with a Service-Worker header for any other
// URL are rejected, so untrusted code can't register a worker it controls.
const WORKER_SCRIPTS = new Set(["/sw.js"]);

// Stands in for the application server. It holds plaintext PII.
function server(): Plugin {
  let profile = { name: "Ada Lovelace", ssn: "078-05-1120" };

  return {
    name: "sandbox-poc-server",
    configureServer(dev) {
      dev.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = new URL(req.url!, "http://localhost").pathname;

        if (req.headers["service-worker"] && !WORKER_SCRIPTS.has(path)) {
          return end(res, 403);
        }
        if (path === "/sw.js") {
          req.url = "/src/sw.ts";
          return next();
        }
        // Sandbox frames carry secrets, so only the worker may serve them.
        if (path.startsWith("/sandbox/")) return end(res, 404);
        if (path === "/api/profile") {
          if (req.method === "PUT") profile = JSON.parse(await body(req));
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(profile));
        }
        next();
      });
    },
  };
}

function end(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.end();
}

async function body(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text;
}

export default defineConfig({
  plugins: [server()],
  build: { target: "esnext" },
});
