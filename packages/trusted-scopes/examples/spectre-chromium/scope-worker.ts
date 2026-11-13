// Builds a scope service worker's source from scope-sw.js, its templates, and the
// scope's hooks.
import { workerSource } from "./templates.ts";

// By default, a frame's content is the scope server's response for its path.
const FETCH_PATH = `async (path, fetchSigned) => {
  const response = await fetchSigned(path);
  return response.ok ? response.text() : "";
}`;

export function scopeWorker({ frameContent = FETCH_PATH }: { frameContent?: string } = {}): string {
  return workerSource(
    "scope-sw.js",
    ["scope-frame.html", "scope-member-frame.html"],
    `const FRAME_CONTENT = ${JSON.stringify(frameContent)};\n`,
  );
}
