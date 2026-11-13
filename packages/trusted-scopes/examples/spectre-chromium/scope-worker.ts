// Builds a scope service worker's source from scope-sw.js and the scope's hooks.
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./scope-sw.js", import.meta.url), "utf8");

// By default, a frame's content is the scope server's response for its path.
const FETCH_PATH = `async (path, fetchSigned) => {
  const response = await fetchSigned(path);
  return response.ok ? response.text() : "";
}`;

export function scopeWorker({ modules = {}, frameContent = FETCH_PATH }: { modules?: Record<string, string>; frameContent?: string } = {}): string {
  return `const SCOPE_MODULES = ${JSON.stringify(modules)};\nconst FRAME_CONTENT = ${JSON.stringify(frameContent)};\n${SOURCE}`;
}
