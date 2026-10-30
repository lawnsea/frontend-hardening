import { defineConfig } from "vite";
import { router } from "./router.js";

export default defineConfig({ plugins: [router()] });
