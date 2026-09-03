import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function siteWorker() {
  return {
    name: "tessera-site-worker",
    apply: "build" as const,
    async closeBundle() {
      const outputDirectory = resolve(process.cwd(), "dist", "server");
      await mkdir(outputDirectory, { recursive: true });
      await Promise.all([
        copyFile(
          resolve(process.cwd(), "server", "site-worker.mjs"),
          resolve(outputDirectory, "index.js"),
        ),
        copyFile(
          resolve(process.cwd(), "server", "site-wrangler.json"),
          resolve(outputDirectory, "wrangler.json"),
        ),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [react(), sites(), siteWorker()],
  build: {
    outDir: "dist/client",
  },
  server: {
    host: "127.0.0.1",
    port: 5178,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4311",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4178,
  },
});
