import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),
 server:{host:'127.0.0.1',port:5174,strictPort:true},
 build:{outDir:'../../poc-dist',emptyOutDir:true,assetsInlineLimit:0,rollupOptions:{input:{index:fileURLToPath(new URL('index.html',import.meta.url)),jointjs:fileURLToPath(new URL('jointjs.html',import.meta.url)),interface:fileURLToPath(new URL('interface.html',import.meta.url)),reactflow:fileURLToPath(new URL('reactflow.html',import.meta.url))}}},
});
