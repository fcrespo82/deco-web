/**
 * SVG enviado pelo usuário para os nós Deco. Ele precisa ser desenhado no DOM
 * (inline) para que o elemento id="status-led" acompanhe o estado do nó, então
 * a segurança vem de RECONSTRUIR o arquivo por lista de permissões:
 * parse estrito → árvore só com elementos/atributos conhecidos → SVG novo.
 * Nada do texto original é repassado sem passar pelo filtro.
 *
 * O parser aceita só o subconjunto de XML necessário: sem DOCTYPE/ENTITY
 * (impede XXE e "billion laughs"), sem CDATA e sem instruções de processamento
 * além da declaração <?xml?>. Servidor (no envio) e navegador (ao desenhar)
 * usam este mesmo código.
 */

export interface SvgNode { name: string; attrs: Record<string, string>; children: SvgChild[] }
export type SvgChild = SvgNode | string;
export interface SanitizedSvg { svg: string; tree: SvgNode; viewBox: string; warnings: string[] }

export const MAX_SVG_BYTES = 256 * 1024;
const MAX_ELEMENTS = 5000;
const MAX_DEPTH = 32;
const MAX_ATTR = 64 * 1024;
export const STATUS_LED_ID = "status-led";

const ID = /^[A-Za-z_][\w.:-]*$/;

// --- parser ------------------------------------------------------------------

function decode(raw: string, where: string): string {
  return raw.replace(/&([^;\s&<]*);?/g, (all, ent: string) => {
    if (!all.endsWith(";")) throw new Error(`Caractere "&" inválido em ${where}.`);
    const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (ent in named) return named[ent]!;
    const m = /^#(?:x([0-9a-f]{1,6})|([0-9]{1,7}))$/i.exec(ent);
    const code = m ? parseInt(m[1] ?? m[2]!, m[1] ? 16 : 10) : NaN;
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error(`Entidade "&${ent};" não permitida.`);
    return String.fromCodePoint(code);
  });
}

/** Lê o XML do SVG. Lança Error com mensagem para o usuário se sair do subconjunto aceito. */
export function parseSvg(input: string): SvgNode {
  if (new TextEncoder().encode(input).length > MAX_SVG_BYTES) throw new Error(`O SVG passa de ${MAX_SVG_BYTES / 1024} KB.`);
  const text = input.replace(/^﻿/, "");
  let pos = 0;
  let count = 0;
  let root: SvgNode | null = null;
  const stack: SvgNode[] = [];
  const fail = (msg: string): never => { throw new Error(msg); };

  const skipComment = () => {
    const end = text.indexOf("-->", pos + 4);
    if (end < 0) fail("Comentário sem fim no SVG.");
    pos = end + 3;
  };

  while (pos < text.length) {
    const lt = text.indexOf("<", pos);
    const chunk = lt < 0 ? text.slice(pos) : text.slice(pos, lt);
    if (chunk) {
      if (stack.length) {
        stack.at(-1)!.children.push(decode(chunk, "texto"));
      } else if (chunk.trim()) {
        fail("Há conteúdo fora do elemento <svg>.");
      }
    }
    if (lt < 0) break;
    pos = lt;

    if (text.startsWith("<!--", pos)) { skipComment(); continue; }
    if (text.startsWith("<?", pos)) {
      const end = text.indexOf("?>", pos);
      if (end < 0 || root || stack.length || !/^<\?xml[\s?]/.test(text.slice(pos, pos + 6)) || text.slice(0, pos).trim()) {
        fail("Instruções de processamento não são permitidas no SVG.");
      }
      pos = end + 2;
      continue;
    }
    if (text.startsWith("<!", pos)) fail("DOCTYPE, ENTITY e CDATA não são permitidos no SVG.");

    if (text.startsWith("</", pos)) {
      const m = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(text.slice(pos, pos + 200));
      if (!m) fail("Fechamento de elemento inválido no SVG.");
      const open = stack.pop();
      if (!open || open.name !== m![1]) fail(`Elemento </${m![1]}> fechado fora de ordem.`);
      pos += m![0].length;
      continue;
    }

    // Abertura: <nome atributos (/)>
    const nm = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(pos, pos + 200));
    if (!nm) fail("Marcação inválida no SVG.");
    const node: SvgNode = { name: nm![1]!, attrs: {}, children: [] };
    pos += nm![0].length;
    let selfClosing = false;
    for (;;) {
      const ws = /^\s*/.exec(text.slice(pos, pos + 1000))![0];
      pos += ws.length;
      if (text.startsWith("/>", pos)) { selfClosing = true; pos += 2; break; }
      if (text.startsWith(">", pos)) { pos += 1; break; }
      if (!ws) fail(`Atributos de <${node.name}> sem separação.`);
      const an = /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])/.exec(text.slice(pos, pos + 300));
      if (!an) fail(`Atributo inválido em <${node.name}>.`);
      pos += an![0].length;
      const end = text.indexOf(an![2]!, pos);
      if (end < 0) fail(`Valor de atributo sem fim em <${node.name}>.`);
      const raw = text.slice(pos, end);
      if (raw.length > MAX_ATTR) fail(`Atributo ${an![1]} grande demais em <${node.name}>.`);
      if (raw.includes("<")) fail(`"<" dentro de atributo em <${node.name}>.`);
      if (an![1]! in node.attrs) fail(`Atributo ${an![1]} repetido em <${node.name}>.`);
      node.attrs[an![1]!] = decode(raw, `atributo ${an![1]}`);
      pos = end + 1;
    }
    if (++count > MAX_ELEMENTS) fail(`O SVG tem mais de ${MAX_ELEMENTS} elementos.`);
    if (stack.length) stack.at(-1)!.children.push(node);
    else if (root) fail("O SVG deve ter um único elemento raiz.");
    else root = node;
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > MAX_DEPTH) fail(`O SVG passa de ${MAX_DEPTH} níveis de aninhamento.`);
    }
  }
  if (stack.length) fail(`Elemento <${stack.at(-1)!.name}> sem fechamento.`);
  if (!root) fail("Arquivo sem elemento <svg>.");
  if (root!.name !== "svg") fail("O elemento raiz precisa ser <svg>.");
  return root!;
}

// --- listas de permissões ------------------------------------------------------

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const ELEMENTS = new Set([
  "svg", "g", "defs", "use", "symbol", "text", "tspan", ...SHAPES,
  "linearGradient", "radialGradient", "stop", "clipPath", "mask",
  "filter", "feGaussianBlur", "feOffset", "feFlood", "feComposite", "feMerge", "feMergeNode", "feColorMatrix", "feDropShadow", "feBlend",
]);
/** Descartados em silêncio: informativos, sem efeito visual. */
const QUIET = new Set(["title", "desc", "metadata", "style"]);
const TEXT_PARENTS = new Set(["text", "tspan"]);

const PRESENTATION = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "stop-color", "stop-opacity", "clip-path",
  "clip-rule", "mask", "filter", "display", "visibility", "color", "flood-color", "flood-opacity", "lighting-color",
  "color-interpolation-filters", "vector-effect", "paint-order", "shape-rendering",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
];
const STYLE_PROPS = new Set(PRESENTATION);
const ATTRS = new Set([
  ...PRESENTATION, "id", "href",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "width", "height", "d", "points",
  "pathLength", "viewBox", "preserveAspectRatio", "transform", "offset", "dx", "dy", "rotate", "textLength", "lengthAdjust",
  "gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits", "filterUnits", "primitiveUnits",
  "stdDeviation", "in", "in2", "result", "mode", "operator", "k1", "k2", "k3", "k4", "values", "type",
]);
/** Na raiz, posição e tamanho vêm de quem desenha; o resto (viewBox, fill…) vale. */
const ROOT_ATTRS = new Set([...ATTRS].filter((a) => !["x", "y", "width", "height", "id"].includes(a)));

const FORBIDDEN_VALUE = /javascript:|vbscript:|data:|expression\s*\(|@import|\\|<|>/i;
const LOCAL_URL = /url\(\s*(['"]?)#([A-Za-z_][\w.:-]*)\1\s*\)/g;

/** Valor seguro: url() só para id local; nada de esquemas ou CSS ativo. */
function safeValue(name: string, value: string): string | null {
  const v = value.trim();
  if (!v || v.length > MAX_ATTR || FORBIDDEN_VALUE.test(v)) return null;
  if (name === "href") return /^#[A-Za-z_][\w.:-]*$/.test(v) ? v : null;
  if (name === "id") return ID.test(v) ? v : null;
  if (/url\s*\(/i.test(v.replace(LOCAL_URL, ""))) return null;
  return v.replace(/\s*!important\s*$/i, "");
}

function declarations(css: string): [string, string][] {
  return css.split(";").flatMap((decl) => {
    const i = decl.indexOf(":");
    if (i < 0) return [];
    return [[decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim()] as [string, string]];
  });
}

/** Regras ".classe{...}" de <style> (formato do Illustrator); o resto é ignorado com aviso. */
function classRules(css: string, warn: (msg: string) => void): Map<string, [string, string][]> {
  const rules = new Map<string, [string, string][]>();
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const selector = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
    const body = src.slice(open + 1, j - 1);
    i = j;
    const classes = selector.split(",").map((s) => s.trim());
    if (body.includes("{") || !classes.every((c) => /^\.[A-Za-z_][\w-]*$/.test(c))) {
      warn("Regras de <style> que não são \".classe { … }\" foram ignoradas.");
      continue;
    }
    for (const c of classes) rules.set(c.slice(1), [...(rules.get(c.slice(1)) ?? []), ...declarations(body)]);
  }
  return rules;
}

function collectStyle(node: SvgNode, out: string[]) {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.name === "style") out.push(child.children.filter((c): c is string => typeof c === "string").join(""));
    else collectStyle(child, out);
  }
}

// --- sanitização -------------------------------------------------------------

/** Aplica a lista de permissões. Lança Error se o resultado não puder ser usado. */
export function sanitizeTree(root: SvgNode): { tree: SvgNode; viewBox: string; warnings: string[] } {
  const warnings = new Set<string>();
  const warn = (msg: string) => warnings.add(msg);
  const css: string[] = [];
  collectStyle(root, css);
  const rules = classRules(css.join("\n"), warn);

  const clean = (node: SvgNode, isRoot: boolean): SvgNode | null => {
    if (QUIET.has(node.name)) return null;
    if (!ELEMENTS.has(node.name)) {
      warn(node.name.includes(":") ? "Elementos de editor (Inkscape/Sodipodi) foram removidos." : `<${node.name}> foi removido.`);
      return null;
    }
    // Precedência CSS: atributo de apresentação < regra de classe < style="".
    const merged: [string, string][] = [];
    for (const [k, v] of Object.entries(node.attrs)) {
      if (k === "class" || k === "style") continue;
      const name = k === "xlink:href" ? "href" : k;
      if (k.startsWith("xmlns") || k === "xml:space") continue;
      if (name.includes(":")) { warn("Atributos de editor (Inkscape/Sodipodi) foram removidos."); continue; }
      if (/^on/i.test(name)) { warn("Atributos de evento (on…) foram removidos."); continue; }
      merged.push([name, v]);
    }
    for (const c of (node.attrs.class ?? "").split(/\s+/).filter(Boolean)) {
      for (const [k, v] of rules.get(c) ?? []) if (STYLE_PROPS.has(k)) merged.push([k, v]);
    }
    for (const [k, v] of declarations(node.attrs.style ?? "")) {
      if (STYLE_PROPS.has(k)) merged.push([k, v]);
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of merged) {
      if (!(isRoot ? ROOT_ATTRS : ATTRS).has(k)) continue;
      const safe = safeValue(k, v);
      if (safe === null) { warn(`Valores não permitidos em "${k}" foram removidos (só url(#id) local).`); delete attrs[k]; continue; }
      attrs[k] = safe;
    }
    const children: SvgChild[] = [];
    for (const child of node.children) {
      if (typeof child === "string") {
        if (TEXT_PARENTS.has(node.name) && child.trim()) children.push(child);
        continue;
      }
      const c = clean(child, false);
      if (c) children.push(c);
    }
    return { name: node.name, attrs, children };
  };

  const viewBox = root.attrs.viewBox?.trim() ?? "";
  const nums = viewBox.split(/[\s,]+/).map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite) || nums[2]! <= 0 || nums[3]! <= 0) {
    throw new Error('O <svg> precisa de um viewBox válido, por exemplo viewBox="0 0 64 80".');
  }
  const tree = clean(root, true)!;
  tree.attrs.viewBox = nums.join(" ");

  const leds: SvgNode[] = [];
  const walk = (n: SvgNode) => { if (n.attrs.id === STATUS_LED_ID) leds.push(n); n.children.forEach((c) => typeof c !== "string" && walk(c)); };
  walk(tree);
  if (leds.length === 0) throw new Error(`Marque o LED com id="${STATUS_LED_ID}" (num <path>, <circle>, <ellipse>, <rect> ou <g>).`);
  if (leds.length > 1) throw new Error(`Há ${leds.length} elementos com id="${STATUS_LED_ID}"; deixe só um.`);
  if (!SHAPES.has(leds[0]!.name) && leds[0]!.name !== "g") throw new Error(`O id="${STATUS_LED_ID}" precisa estar numa forma (path, circle, ellipse, rect, polygon) ou num <g>.`);
  return { tree, viewBox: tree.attrs.viewBox, warnings: [...warnings] };
}

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function serializeSvg(node: SvgNode, isRoot = true): string {
  const attrs = (isRoot ? ' xmlns="http://www.w3.org/2000/svg"' : "") + Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  const inner = node.children.map((c) => (typeof c === "string" ? escText(c) : serializeSvg(c, false))).join("");
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/** Parse + lista de permissões + SVG reconstruído. */
export function sanitizeSvg(input: string): SanitizedSvg {
  const { tree, viewBox, warnings } = sanitizeTree(parseSvg(input));
  return { svg: serializeSvg(tree) + "\n", tree, viewBox, warnings };
}

// --- ligação ao estado do nó ---------------------------------------------------

/**
 * Prepara a árvore já sanitizada para um nó: ids recebem o prefixo `uid`
 * (vários nós na mesma tela) e o #status-led passa a usar as cores do tema
 * conforme online/offline, com as classes de pulsação e seleção.
 */
export function bindSvgTree(tree: SvgNode, opts: { uid: string; online: boolean; active?: boolean }): SvgNode {
  const prefix = (id: string) => `${opts.uid}-${id}`;
  const color = opts.online ? "var(--led-on)" : "var(--led-off)";
  const ledClass = ["svg-status-led", opts.online && "deco-led", opts.active && "is-active"].filter(Boolean).join(" ");
  const visit = (node: SvgNode, inLed: boolean): SvgNode => {
    const isLed = node.attrs.id === STATUS_LED_ID;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(node.attrs)) {
      if (k === "id") attrs.id = prefix(v);
      else if (k === "href") attrs.href = `#${prefix(v.slice(1))}`;
      else attrs[k] = v.replace(LOCAL_URL, (_m, _q, id: string) => `url(#${prefix(id)})`);
    }
    const led = inLed || isLed;
    if (led && (isLed || SHAPES.has(node.name))) attrs.fill = color;
    if (isLed) { attrs.class = ledClass; attrs["data-online"] = String(opts.online); }
    return { name: node.name, attrs, children: node.children.map((c) => (typeof c === "string" ? c : visit(c, led))) };
  };
  return visit(tree, false);
}
