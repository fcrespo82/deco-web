import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [preact(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // Em dev, a API roda em `npm run dev` (porta 8080).
    proxy: { "/api": "http://localhost:8080" },
  },
});
