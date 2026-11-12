// Plays the L7 router and the trusted PII server. `node server.ts` serves the
// example at http://localhost:5176/profile.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { headScript } from "./head.ts";
import { EVIL_PAGE, PROFILE_PAGE, UNTRUSTED_JS } from "./profile.ts";

export const PII = "Roberta Jean Oppenheimer";

const SW = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

export interface Example {
  url: string;
  // What the server saw, in order, including what the page's scripts report.
  log: string[];
  close(): Promise<void>;
}

export interface Options {
  // Never answers redemption, so the worker times out.
  hangRedeem?: boolean;
  // Refuses the worker script, so the page stays uncontrolled.
  refuseWorker?: boolean;
}

export async function startExample(port: number, opts: Options = {}): Promise<Example> {
  const secrets = new Map<string, "issued" | "spent">();
  const log: string[] = [];
  const body = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let b = "";
      req.on("data", (c) => (b += c)).on("end", () => r(b));
    });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    const dest = req.headers["sec-fetch-dest"];
    // Only the trusted worker script can be registered.
    if (dest === "serviceworker" && url.pathname !== "/sw.js") {
      log.push(`serviceworker-refused-${url.pathname}`);
      return res.writeHead(403).end();
    }
    if (url.pathname === "/sw.js") {
      if (dest !== "serviceworker" || opts.refuseWorker) return res.writeHead(404).end();
      return res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }).end(SW);
    }
    if (url.pathname === "/profile") {
      if (dest !== "document") {
        log.push(`profile-refused-${dest}`);
        return res.writeHead(403).end();
      }
      const secret = randomBytes(32).toString("base64url");
      secrets.set(secret, "issued");
      log.push("profile-served");
      const timeout = opts.hangRedeem ? 1500 : 3000;
      return res
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Content-Security-Policy": `frame-src http://localhost:${port}/__frame/; require-trusted-types-for 'script'; trusted-types default`,
        })
        .end(
          `<!doctype html><html><head><meta charset="utf-8"><script>${headScript(secret)}</script>` +
            `<script src="/__gate?secret=${secret}&timeout=${timeout}"></script>` +
            PROFILE_PAGE.replace("<!doctype html>", ""),
        );
    }
    if (url.pathname === "/__gate") {
      // Only a page the worker doesn't control reaches here. Holds the gate until
      // the secret is spent, or spends it on timeout.
      const secret = url.searchParams.get("secret")!;
      const start = Date.now();
      while (secrets.get(secret) === "issued" && Date.now() - start < Number(url.searchParams.get("timeout"))) {
        await new Promise((r) => setTimeout(r, 20));
      }
      if (secrets.get(secret) === "issued") {
        secrets.set(secret, "spent");
        log.push("gate-network-invalidated");
      }
      log.push("gate-network");
      return res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }).end();
    }
    if (url.pathname === "/redeem" && req.method === "DELETE") {
      secrets.set(await body(req), "spent");
      log.push("redeem-deleted");
      return res.writeHead(204).end();
    }
    if (url.pathname === "/redeem" && req.method === "POST") {
      const secret = await body(req);
      const state = secrets.get(secret);
      const cors = { "Access-Control-Allow-Origin": "null" };
      if (state !== "issued") {
        log.push(`redeem-refused-${state ?? "unknown"}-origin-${req.headers.origin}`);
        return res.writeHead(410, cors).end();
      }
      if (opts.hangRedeem) {
        log.push("redeem-hanging");
        return;
      }
      secrets.set(secret, "spent");
      log.push(`redeem-ok-origin-${req.headers.origin}`);
      return res.writeHead(200, { ...cors, "Content-Type": "text/plain" }).end(PII);
    }
    if (url.pathname === "/invalidate" && req.method === "POST") {
      secrets.set(await body(req), "spent");
      log.push("invalidated");
      return res.writeHead(204).end();
    }
    if (url.pathname === "/untrusted.js") {
      return res.writeHead(200, { "Content-Type": "text/javascript" }).end(UNTRUSTED_JS);
    }
    if (url.pathname === "/evil") {
      return res.writeHead(200, { "Content-Type": "text/html" }).end(EVIL_PAGE);
    }
    if (url.pathname === "/log") {
      log.push(url.search.slice(1));
      return res.writeHead(204).end();
    }
    log.push(`not-found-${url.pathname}`);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(port, "localhost", r));
  return {
    url: `http://localhost:${port}`,
    log,
    close: () =>
      new Promise((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startExample(5176);
  console.log(`${url}/profile`);
}
