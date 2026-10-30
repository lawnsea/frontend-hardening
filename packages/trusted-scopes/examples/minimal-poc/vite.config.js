import { defineConfig } from "vite";
import { server } from "./server.js";

// Without a fallback, /pii/<ciphertext> gets a 404 when the worker isn't active,
// instead of index.html.
export default defineConfig({ appType: "mpa", plugins: [server()] });
