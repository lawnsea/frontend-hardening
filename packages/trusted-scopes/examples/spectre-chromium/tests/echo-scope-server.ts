// A trusted scope server for tests that use a second scope. A frame's content is
// the scope server's response for its path.
import { serve } from "../ipc.ts";
import { scopeWorker } from "../scope-worker.ts";

const SW = scopeWorker();

serve(async ({ url }) => {
  const { pathname } = new URL(url, "http://localhost");
  const scope = pathname.split("/")[2];
  if (pathname === `/trusted-scopes/${scope}/sw.js`) {
    return { status: 200, headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }, body: SW };
  }
  if (pathname === `/trusted-scopes/${scope}/greeting`) {
    return { status: 200, headers: { "Content-Type": "text/plain" }, body: `Hello from ${scope}` };
  }
  return { status: 404, headers: {} as Record<string, string>, body: "" };
});
