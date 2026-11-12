// The trusted PII server. It issues single-use secrets to the router, redeems them
// for the PII, and serves the service worker.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { log, options, serve } from "./ipc.ts";
import { PII } from "./profile-db.ts";

export interface PiiOptions {
  // Never answers redemption, so the worker times out.
  hangRedeem?: boolean;
  // Refuses the worker script, so the page stays uncontrolled.
  refuseWorker?: boolean;
}

const SW = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const { hangRedeem, refuseWorker } = options<PiiOptions>();
const TIMEOUT = hangRedeem ? 1500 : 3000;
const secrets = new Map<string, "issued" | "spent">();

const empty = (status: number, headers: Record<string, string> = {}) => ({ status, headers, body: "" });

serve(async ({ method, url, headers, body, from }) => {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  if (pathname === "/secrets" && method === "POST" && from === "router") {
    const secret = randomBytes(32).toString("base64url");
    secrets.set(secret, "issued");
    return { status: 200, headers: {}, body: JSON.stringify({ secret, timeout: TIMEOUT }) };
  }
  if (pathname === "/sw.js") {
    if (refuseWorker) return empty(404);
    return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }, body: SW };
  }
  if (pathname === "/redeem" && method === "DELETE") {
    secrets.set(body, "spent");
    log("redeem-deleted");
    return empty(204);
  }
  if (pathname === "/redeem" && method === "POST") {
    const state = secrets.get(body);
    const cors = { "Access-Control-Allow-Origin": "null" };
    if (state !== "issued") {
      log(`redeem-refused-${state ?? "unknown"}-origin-${headers.origin}`);
      return empty(410, cors);
    }
    if (hangRedeem) {
      log("redeem-hanging");
      return new Promise(() => {});
    }
    secrets.set(body, "spent");
    log(`redeem-ok-origin-${headers.origin}`);
    return { status: 200, headers: { ...cors, "Content-Type": "text/plain" }, body: PII };
  }
  if (pathname === "/invalidate" && method === "POST") {
    secrets.set(body, "spent");
    log("invalidated");
    return empty(204);
  }
  if (pathname === "/__gate") {
    // Only a page the worker doesn't control reaches here. Holds the gate until the
    // secret is spent, or spends it on timeout.
    const secret = searchParams.get("secret")!;
    const start = Date.now();
    while (secrets.get(secret) === "issued" && Date.now() - start < TIMEOUT) {
      await new Promise((r) => setTimeout(r, 20));
    }
    if (secrets.get(secret) === "issued") {
      secrets.set(secret, "spent");
      log("gate-network-invalidated");
    }
    log("gate-network");
    return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" }, body: "" };
  }
  // The worker serves /__frame/*; the network never does.
  return empty(404);
});
