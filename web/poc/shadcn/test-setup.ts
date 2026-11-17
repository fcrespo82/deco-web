import {afterEach,beforeAll,vi} from 'vitest';
import {configure,waitFor} from '@testing-library/dom';
configure({getElementError:message=>new Error(message??'Elemento não encontrado')});
import {readFileSync} from 'node:fs';
beforeAll(()=>{new Function(readFileSync('node_modules/.cache/deco-poc/shadcn-test.js','utf8'))();});
afterEach(async()=>{await window.__decoPocTest.act(()=>window.__decoPocTest.unmount());await waitFor(()=>{if(document.body.style.pointerEvents==='none')throw Error('Aguardando limpeza dos portais Radix');});document.body.innerHTML='';});
// jsdom has no layout/scrolling; these APIs are used by Radix positioning.
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
window.HTMLElement.prototype.scrollIntoView=vi.fn();
window.HTMLElement.prototype.hasPointerCapture=()=>false;
window.HTMLElement.prototype.setPointerCapture=()=>{};
window.HTMLElement.prototype.releasePointerCapture=()=>{};
