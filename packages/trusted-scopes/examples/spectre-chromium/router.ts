// The trusted L7 router. It runs the trusted scope servers and the untrusted
// profile server as subprocesses, creates a session for each profile page load,
// issues and redeems single-use keys, verifies signed scope requests, and injects
// the trusted head script into the profile page. `node router.ts` serves the
// example at http://localhost:5176/profile.
import { fork, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { headScript } from "./head.ts";
import type { Request, Response } from "./ipc.ts";
import type { ProfileOptions } from "./profile-server.ts";

const CONTROLLER_SW = readFileSync(new URL("./controller-sw.js", import.meta.url), "utf8");

// The trusted server for each scope.
const SCOPE_SERVERS: Record<string, string> = { pii: "pii-server.ts" };
// What the controller frame's MAC signs. It isn't a scope, so it can't sign scope requests.
const CONTROLLER = "controller";

export interface Example {
  url: string;
  // Every browser request, as "request <path>", and every event, in order.
  log: string[];
  close(): Promise<void>;
}

export interface Options {
  // Never answers redemption, so the controller worker times out.
  hangRedeem?: boolean;
  // Refuses the controller worker script, so the page stays uncontrolled.
  refuseWorker?: boolean;
  // More trusted scope servers, by scope, as paths relative to this file.
  scopes?: Record<string, string>;
  profile?: ProfileOptions;
}

export async function startExample(port: number, opts: Options = {}): Promise<Example> {
  const origin = `http://localhost:${port}`;
  const timeout = opts.hangRedeem ? 1500 : 3000;
  const log: string[] = [];
  // Each key's state and the session it was issued for.
  const keys = new Map<string, { state: "issued" | "spent"; session: string }>();
  // Each session's MAC key.
  const sessions = new Map<string, Buffer>();
  const pending = new Map<number, (response: Response) => void>();
  let nextId = 0;

  const start = (name: string, file: string, options: object = {}) => {
    const child = fork(fileURLToPath(new URL(file, import.meta.url)), [JSON.stringify(options)]);
    child.on("message", async (message: { id?: number; response?: Response; log?: string; fetch?: { server: string; url: string } }) => {
      if (message.log) log.push(message.log);
      if (message.response) {
        pending.get(message.id!)!(message.response);
        pending.delete(message.id!);
      }
      // Relays a request from one server to another.
      if (message.fetch) {
        const target = scopeServers.get(message.fetch.server);
        const reply = target
          ? await request(target, { method: "GET", url: message.fetch.url, headers: {}, body: "", from: name })
          : empty(404);
        child.send({ id: message.id, reply });
      }
    });
    return child;
  };
  const profileServer = start("profile", "profile-server.ts", opts.profile);
  const scopeServers = new Map(
    Object.entries({ ...SCOPE_SERVERS, ...opts.scopes }).map(([scope, file]) => [scope, start(scope, file)]),
  );
  const request = (child: ChildProcess, req: Request) =>
    new Promise<Response>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.send({ id, request: req });
    });
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let b = "";
      req.on("data", (c) => (b += c)).on("end", () => r(b));
    });
  const send = (res: ServerResponse, { status, headers, body }: Response) => res.writeHead(status, headers).end(body);
  const empty = (status: number, headers: Record<string, string> = {}): Response => ({ status, headers, body: "" });

  // The MAC for scope in a session: <session ID>.<scope>.<HMAC of the scope with the
  // session's key>.
  const macFor = (sessionId: string, scope: string) =>
    `${sessionId}.${scope}.${createHmac("sha256", sessions.get(sessionId)!).update(scope).digest("base64url")}`;

  // Whether a Trusted-Scope-Signature header is a MAC for scope.
  const signedFor = (header: string | string[] | undefined, scope: string) => {
    if (typeof header !== "string") return false;
    const [sessionId, signedScope, mac] = header.split(".");
    const key = sessions.get(sessionId);
    if (!key || signedScope !== scope || !mac) return false;
    const expected = createHmac("sha256", key).update(scope).digest();
    const actual = Buffer.from(mac, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  const handle = async (req: IncomingMessage): Promise<Response> => {
    const url = req.url!;
    const { pathname, searchParams } = new URL(url, origin);
    const dest = req.headers["sec-fetch-dest"];
    const scopeMatch = pathname.match(/^\/trusted-scopes\/([a-z0-9-]+)(\/.*)$/);
    const scopeWorker = scopeMatch?.[2] === "/sw.js";
    // Only the trusted workers can be registered.
    if ((dest === "serviceworker") !== (pathname === "/sw.js" || scopeWorker)) {
      if (dest === "serviceworker") log.push(`serviceworker-refused-${pathname}`);
      return empty(403);
    }
    const forwarded: Request = { method: req.method!, url, headers: req.headers, body: await readBody(req) };

    if (pathname === "/sw.js") {
      if (opts.refuseWorker) return empty(404);
      return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }, body: CONTROLLER_SW };
    }

    if (pathname === "/profile") {
      if (dest !== "document") return empty(403);
      const session = randomBytes(16).toString("base64url");
      sessions.set(session, randomBytes(32));
      const psk = randomBytes(32).toString("base64url");
      keys.set(psk, { state: "issued", session });
      const page = await request(profileServer, { ...forwarded, session });
      log.push("profile-served");
      return {
        status: page.status,
        headers: {
          ...page.headers,
          "Cache-Control": "no-store",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Content-Security-Policy": `frame-src ${origin}/controller-frame ${origin}/trusted-scopes/; require-trusted-types-for 'script'; trusted-types default`,
        },
        // The head script and the parser-blocking script come first, so they run
        // before any of the profile page's markup is parsed.
        body:
          `<!doctype html><html><head><meta charset="utf-8"><script>${headScript(psk)}</script>` +
          `<script src="/controller-frame-ready?psk=${psk}&timeout=${timeout}"></script>` +
          page.body,
      };
    }

    const psk = pathname.match(/^\/psk\/([\w-]+)$/)?.[1];
    if (psk && req.method === "GET") {
      const cors = { "Access-Control-Allow-Origin": "null" };
      const state = keys.get(psk)?.state;
      if (state !== "issued") {
        log.push(`psk-refused-${state ?? "unknown"}-origin-${req.headers.origin}`);
        return empty(410, cors);
      }
      if (opts.hangRedeem) {
        log.push("psk-hanging");
        return new Promise(() => {});
      }
      const key = keys.get(psk)!;
      key.state = "spent";
      log.push(`psk-redeemed-origin-${req.headers.origin}`);
      // The controller frame's MAC, which /scope-mac accepts.
      return { status: 200, headers: { ...cors, "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: macFor(key.session, CONTROLLER) };
    }
    if (psk && req.method === "DELETE") {
      const key = keys.get(psk);
      if (key) key.state = "spent";
      log.push("psk-revoked");
      return empty(204);
    }

    if (pathname === "/controller-frame-ready") {
      // Only a page the controller worker doesn't control reaches here. Holds the
      // script until the key is spent, or revokes it on timeout.
      const key = keys.get(searchParams.get("psk")!);
      const start = Date.now();
      while (key?.state === "issued" && Date.now() - start < timeout) {
        await new Promise((r) => setTimeout(r, 20));
      }
      if (key?.state === "issued") {
        key.state = "spent";
        log.push("gate-network-revoked");
      }
      log.push("gate-network");
      return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" }, body: "" };
    }

    const macScope = pathname.match(/^\/scope-mac\/([a-z0-9-]+)$/)?.[1];
    if (macScope) {
      const cors = {
        "Access-Control-Allow-Origin": "null",
        "Access-Control-Allow-Headers": "Trusted-Scope-Signature",
        "Access-Control-Allow-Methods": "GET",
      };
      if (req.method === "OPTIONS") return empty(204, cors);
      const header = req.headers["trusted-scope-signature"];
      if (!signedFor(header, CONTROLLER)) {
        log.push(`scope-mac-refused-${macScope}`);
        return empty(403, cors);
      }
      if (!scopeServers.has(macScope)) {
        log.push(`scope-mac-unknown-${macScope}`);
        return empty(404, cors);
      }
      log.push(`scope-mac-issued-${macScope}`);
      const sessionId = (header as string).split(".")[0];
      return { status: 200, headers: { ...cors, "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: macFor(sessionId, macScope) };
    }

    if (scopeMatch) {
      const [, scope] = scopeMatch;
      const server = scopeServers.get(scope);
      if (!server) return empty(404);
      if (scopeWorker) return request(server, forwarded);
      // Scope frames have opaque origins, so their signed requests are preflighted.
      const cors = {
        "Access-Control-Allow-Origin": "null",
        "Access-Control-Allow-Headers": "Trusted-Scope-Signature",
        "Access-Control-Allow-Methods": "GET",
      };
      if (req.method === "OPTIONS") return empty(204, cors);
      const header = req.headers["trusted-scope-signature"];
      if (!signedFor(header, scope)) {
        log.push(`scope-refused-${pathname}`);
        return empty(403);
      }
      log.push(`scope-forwarded-${pathname}`);
      const response = await request(server, { ...forwarded, session: (header as string).split(".")[0] });
      return { ...response, headers: { ...response.headers, ...cors } };
    }

    return request(profileServer, forwarded);
  };

  const server = createServer(async (req, res) => {
    log.push(`request ${req.url}`);
    send(res, await handle(req));
  });
  await new Promise<void>((r) => server.listen(port, "localhost", r));

  return {
    url: origin,
    log,
    close: () =>
      new Promise((r) => {
        [profileServer, ...scopeServers.values()].forEach((child) => child.kill());
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startExample(5176);
  console.log(`${url}/profile`);
}
