// The trusted scope server for the "pii" scope. The router forwards it only
// requests signed for the scope, and requests for its service worker.
import { readFileSync } from "node:fs";
import { serve } from "./ipc.ts";
import { PII } from "./profile-db.ts";

const SW = readFileSync(new URL("./scope-sw.js", import.meta.url), "utf8");
const FIELDS: Record<string, string> = { "/trusted-scopes/pii/name": PII };

serve(async ({ url }) => {
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/trusted-scopes/pii/sw.js") {
    return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }, body: SW };
  }
  if (Object.hasOwn(FIELDS, pathname)) {
    return { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: FIELDS[pathname] };
  }
  return { status: 404, headers: {} as Record<string, string>, body: "" };
});
