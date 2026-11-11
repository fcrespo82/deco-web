/**
 * SVG enviado pelo usuário para um modelo Deco, desenhado inline para que o
 * elemento id="status-led" acompanhe o nó. O servidor já guarda só a versão
 * reconstruída; aqui ela passa de novo pelo mesmo sanitizador (defesa em
 * profundidade) e vira vnodes do Preact — nunca innerHTML.
 */
import { h, type ComponentChildren, type VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import { bindSvgTree, sanitizeSvg, type SvgChild, type SvgNode } from "../../../src/core/svg-sanitize.js";

export interface DecoSvg { tree: SvgNode; viewBox: string }

// A URL do manifesto muda a cada troca (?v=), então o cache por URL nunca fica velho.
const cache = new Map<string, Promise<DecoSvg | null>>();

function load(src: string): Promise<DecoSvg | null> {
  let p = cache.get(src);
  if (!p) {
    p = fetch(src, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        const { tree, viewBox } = sanitizeSvg(text);
        return { tree, viewBox };
      })
      .catch((e: unknown) => {
        console.warn("SVG do Deco ignorado:", e);
        return null;
      });
    cache.set(src, p);
  }
  return p;
}

/** Árvore pronta do SVG; null enquanto carrega ou se o arquivo não servir. */
export function useDecoSvg(src: string | null): DecoSvg | null {
  const [doc, setDoc] = useState<DecoSvg | null>(null);
  useEffect(() => {
    setDoc(null);
    if (!src) return;
    let alive = true;
    void load(src).then((d) => alive && setDoc(d));
    return () => { alive = false; };
  }, [src]);
  return doc;
}

function toVNode(child: SvgChild): ComponentChildren {
  if (typeof child === "string") return child;
  return h(child.name, { ...child.attrs }, ...child.children.map(toVNode));
}

/** Conteúdo do SVG (filhos da raiz), para dentro de um <svg viewBox={doc.viewBox}>. */
export function DecoSvgContent({ doc, uid, online, active }: { doc: DecoSvg; uid: string; online: boolean; active?: boolean }): VNode {
  const bound = bindSvgTree(doc.tree, { uid, online, active });
  const { viewBox: _viewBox, preserveAspectRatio: _par, ...rootAttrs } = bound.attrs;
  return h("g", rootAttrs, ...bound.children.map(toVNode)) as VNode;
}
