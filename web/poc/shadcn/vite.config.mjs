import {defineConfig} from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('..',import.meta.url)),
 cacheDir:fileURLToPath(new URL('../../../node_modules/.vite-deco-shadcn',import.meta.url)),
 plugins:[preact(),tailwindcss(),{name:'ensure-preact-only',generateBundle(){const reactModules=[...this.getModuleIds()].filter(id=>/node_modules\/(react|react-dom)\//.test(id));if(reactModules.length)throw Error('React runtime encontrado: '+reactModules.join(', '));}}],
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 server:{host:'127.0.0.1',port:5175,strictPort:true},
 build:{outDir:'../../poc-shadcn-dist',emptyOutDir:true,assetsInlineLimit:0,rollupOptions:{input:{shadcn:fileURLToPath(new URL('index.html',import.meta.url)),jointjs:fileURLToPath(new URL('../jointjs.html',import.meta.url))}}},
});
