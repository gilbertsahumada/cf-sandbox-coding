import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: "web",
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web", import.meta.url)) } },
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: Object.fromEntries(
      ["/session", "/github", "/sandboxes", "/health"].map((path) => [
        path,
        { target: "http://127.0.0.1:8787", changeOrigin: false },
      ]),
    ),
  },
});
