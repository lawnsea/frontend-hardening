import { defineConfig } from "vite";

// Without a fallback, /sandbox gets a 404 when the worker isn't active,
// instead of index.html.
export default defineConfig({ appType: "mpa" });
