import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
const preactRuntimeOnly:Plugin={name:"preact-runtime-only",generateBundle(){
 const modules=[...this.getModuleIds()].filter(id=>/node_modules\/(react|react-dom)\//.test(id));
 if(modules.length)throw Error("Runtime React inesperado no frontend: "+modules.join(", "));
}};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [preact(), tailwindcss(), preactRuntimeOnly],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    // Em dev, a API roda em `npm run dev` (porta 8080).
    proxy: { "/api": "http://localhost:8080" },
  },
});
