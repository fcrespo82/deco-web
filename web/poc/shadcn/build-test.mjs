// Test the browser bundle with the SAME aliases and React-runtime guard as
// production; Node externalization must not silently load React for Radix.
import {build} from 'vite';
import config from './vite.config.mjs';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const result=await build({...config,configFile:false,logLevel:'error',build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('test-harness.tsx',import.meta.url)),name:'DecoPocTest',formats:['iife']}}});
const chunk=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk'&&item.isEntry);
await mkdir('node_modules/.cache/deco-poc',{recursive:true});
await writeFile('node_modules/.cache/deco-poc/shadcn-test.js',chunk.code);
console.log('Bundle de testes criado com Preact/compat; runtime React ausente.');
