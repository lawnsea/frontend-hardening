// The L7 router. It runs the PII server and the profile server as subprocesses,
// routes the browser's requests to them, and injects the trusted head script into
// the profile page. `node router.ts` serves the example at
// http://localhost:5176/profile.
import { fork, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { headScript } from "./head.ts";
import type { Request, Response } from "./ipc.ts";
import type { PiiOptions } from "./pii-server.ts";
import type { ProfileOptions } from "./profile-server.ts";

export interface Example {
  url: string;
  // Every browser request, as "request <path>", and every server event, in order.
  log: string[];
  close(): Promise<void>;
}

export interface Options {
  pii?: PiiOptions;
  profile?: ProfileOptions;
}

// Picks the server for a request by its path.
function route(pathname: string): "pii" | "profile" {
  if (["/sw.js", "/redeem", "/invalidate", "/__gate"].includes(pathname) || pathname.startsWith("/__frame/")) {
    return "pii";
  }
  return "profile";
}

export async function startExample(port: number, opts: Options = {}): Promise<Example> {
  const log: string[] = [];
  const pending = new Map<number, (response: Response) => void>();
  let nextId = 0;

  const start = (file: string, options: object) => {
    const child = fork(fileURLToPath(new URL(file, import.meta.url)), [JSON.stringify(options)]);
    child.on("message", (message: { id?: number; response?: Response; log?: string }) => {
      if (message.log) log.push(message.log);
      if (message.response) {
        pending.get(message.id!)!(message.response);
        pending.delete(message.id!);
      }
    });
    return child;
  };
  const servers: Record<"pii" | "profile", ChildProcess> = {
    pii: start("pii-server.ts", opts.pii ?? {}),
    profile: start("profile-server.ts", opts.profile ?? {}),
  };
  const request = (name: "pii" | "profile", req: Request) =>
    new Promise<Response>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      servers[name].send({ id, request: req });
    });
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let b = "";
      req.on("data", (c) => (b += c)).on("end", () => r(b));
    });

  const server = createServer(async (req, res) => {
    const url = req.url!;
    const { pathname } = new URL(url, "http://localhost");
    const dest = req.headers["sec-fetch-dest"];
    log.push(`request ${url}`);
    // Only the trusted worker script can be registered.
    if ((dest === "serviceworker") !== (pathname === "/sw.js")) return res.writeHead(403).end();
    const forwarded: Request = { method: req.method!, url, headers: req.headers, body: await readBody(req) };

    if (pathname === "/profile") {
      if (dest !== "document") return res.writeHead(403).end();
      const issued = await request("pii", { method: "POST", url: "/secrets", headers: {}, body: "", from: "router" });
      const { secret, timeout } = JSON.parse(issued.body);
      const page = await request("profile", forwarded);
      log.push("profile-served");
      return res
        .writeHead(page.status, {
          ...page.headers,
          "Cache-Control": "no-store",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Content-Security-Policy": `frame-src http://localhost:${port}/__frame/; require-trusted-types-for 'script'; trusted-types block-srcdoc`,
        })
        .end(
          // The head script and the gate come first, so they run before any of the
          // profile page's markup is parsed.
          `<!doctype html><html><head><meta charset="utf-8"><script>${headScript(secret)}</script>` +
            `<script src="/__gate?secret=${secret}&timeout=${timeout}"></script>` +
            page.body,
        );
    }
    const { status, headers, body } = await request(route(pathname), forwarded);
    res.writeHead(status, headers).end(body);
  });
  await new Promise<void>((r) => server.listen(port, "localhost", r));

  return {
    url: `http://localhost:${port}`,
    log,
    close: () =>
      new Promise((r) => {
        Object.values(servers).forEach((child) => child.kill());
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startExample(5176);
  console.log(`${url}/profile`);
}
