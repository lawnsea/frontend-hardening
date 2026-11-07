import { defineConfig } from "vite";
import { router } from "./router.js";

export default defineConfig({ publicDir: "tests/public", plugins: [router()] });
