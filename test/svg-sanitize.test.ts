import { describe, expect, it } from "vitest";
import { bindSvgTree, MAX_SVG_BYTES, parseSvg, sanitizeSvg, type SvgNode } from "../src/core/svg-sanitize.js";

const LED = '<circle id="status-led" cx="32" cy="12" r="2" fill="#0f0"/>';
const svg = (body: string, root = 'viewBox="0 0 64 80"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}${LED}</svg>`;

function find(node: SvgNode, pred: (n: SvgNode) => boolean): SvgNode[] {
  const out = pred(node) ? [node] : [];
  for (const c of node.children) if (typeof c !== "string") out.push(...find(c, pred));
  return out;
}

describe("sanitização de SVG enviado", () => {
  it("aceita um desenho comum e preserva geometria, gradiente e url(#id) local", () => {
    const { svg: out, viewBox, warnings } = sanitizeSvg(svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<path d="M13 12 V67 Z" fill="url(#g)" stroke="#333" stroke-width="0.7" transform="translate(1 2)"/>',
    ));
    expect(viewBox).toBe("0 0 64 80");
    expect(warnings).toEqual([]);
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('d="M13 12 V67 Z"');
    expect(out).toContain('id="status-led"');
  });

  it.each([
    ["script", '<script>alert(1)</script>', "<script"],
    ["foreignObject", '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>', "foreignObject"],
    ["image externa", '<image href="https://evil.example/a.png"/>', "<image"],
    ["link", '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>', "javascript"],
    ["animação", '<rect width="1" height="1"><set attributeName="fill" to="red"/></rect>', "<set"],
  ])("remove %s", (_label, body, banned) => {
    const { svg: out, warnings } = sanitizeSvg(svg(body));
    expect(out).not.toContain(banned);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("remove eventos e valores com esquemas ou URLs externas", () => {
    const { svg: out } = sanitizeSvg(svg(
      '<rect width="1" height="1" onclick="alert(1)" fill="url(https://evil.example/x)"/>' +
      '<use href="https://evil.example/s.svg#x"/><use xlink:href="data:image/svg+xml,AAAA"/>' +
      '<rect width="1" height="1" style="fill:url(http://evil.example/a);stroke:#123;behavior:url(x.htc)"/>' +
      '<rect width="1" height="1" fill="javascript&#58;alert(1)"/>',
    ));
    expect(out).not.toMatch(/onclick|evil|data:|javascript|behavior/i);
    expect(out).toContain('stroke="#123"');
  });

  it.each([
    ["DOCTYPE/ENTITY (XXE, billion laughs)", '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 1 1">&x;</svg>'],
    ["CDATA", `<svg viewBox="0 0 1 1"><![CDATA[<script>x</script>]]>${LED}</svg>`],
    ["instrução de processamento", `<svg viewBox="0 0 1 1"><?xml-stylesheet href="x.css"?>${LED}</svg>`],
    ["entidade desconhecida", `<svg viewBox="0 0 1 1"><text>&nbsp;</text>${LED}</svg>`],
    ["raiz que não é svg", "<html><body/></html>"],
    ["XML mal formado", `<svg viewBox="0 0 1 1"><g>${LED}</svg>`],
    ["sem viewBox", `<svg width="10" height="10">${LED}</svg>`],
  ])("recusa %s", (_label, input) => {
    expect(() => sanitizeSvg(input)).toThrow();
  });

  it("recusa arquivo grande ou aninhado demais", () => {
    expect(() => sanitizeSvg(svg(`<desc>${"a".repeat(MAX_SVG_BYTES)}</desc>`))).toThrow(/KB/);
    expect(() => sanitizeSvg(svg("<g>".repeat(40) + "</g>".repeat(40)))).toThrow(/aninhamento/);
  });

  it("exige exatamente um id=status-led numa forma ou grupo", () => {
    expect(() => sanitizeSvg('<svg viewBox="0 0 64 80"><rect width="1" height="1"/></svg>')).toThrow(/status-led/);
    expect(() => sanitizeSvg(svg(LED))).toThrow(/só um/);
    expect(() => sanitizeSvg('<svg viewBox="0 0 64 80"><defs id="status-led"/></svg>')).toThrow(/forma/);
    expect(() => sanitizeSvg('<svg viewBox="0 0 64 80"><g id="status-led"><circle r="1"/></g></svg>')).not.toThrow();
  });

  it("aceita exportações do Inkscape e do Illustrator", () => {
    const inkscape = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Created with Inkscape -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="64mm" height="80mm" viewBox="0 0 64 80">
  <sodipodi:namedview id="nv" inkscape:zoom="2"/>
  <metadata><rdf/></metadata>
  <g inkscape:label="Camada 1" inkscape:groupmode="layer">
    <rect style="fill:#cccccc;stroke:none;stroke-width:0.5" width="30" height="60" x="17" y="10"/>
    <ellipse id="status-led" style="fill:#00ff00" cx="32" cy="63" rx="1.8" ry="1.2"/>
  </g>
</svg>`;
    const a = sanitizeSvg(inkscape);
    expect(a.svg).not.toMatch(/inkscape|sodipodi|metadata|width="64mm"/);
    expect(a.svg).toContain('fill="#cccccc"');

    const illustrator = `<svg viewBox="0 0 64 80"><defs><style>.cls-1{fill:#456;}.cls-2,.cls-3{stroke:#000}@media print{.cls-1{fill:red}}</style></defs>
      <path class="cls-1 cls-2" d="M0 0h10v10z"/><circle id="status-led" class="cls-3" cx="1" cy="1" r="1"/></svg>`;
    const b = sanitizeSvg(illustrator);
    expect(b.svg).toContain('fill="#456"');
    expect(b.svg).toContain('stroke="#000"');
    expect(b.svg).not.toMatch(/class=|<style|red/);
    expect(b.warnings.join(" ")).toMatch(/style/);
  });

  it("é idempotente: o que o servidor guarda passa igual pelo navegador", () => {
    const once = sanitizeSvg(svg('<g transform="scale(2)"><text x="1" y="2">Deco &amp; &lt;x&gt;</text></g>')).svg;
    expect(sanitizeSvg(once).svg).toBe(once);
    expect(once).toContain("Deco &amp; &lt;x&gt;");
  });
});

describe("ligação do #status-led ao nó", () => {
  const tree = sanitizeSvg(svg(
    '<defs><radialGradient id="g"/><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>' +
    '<path id="body" d="M0 0" fill="url(#g)" clip-path="url(#c)"/><use href="#body"/>',
  )).tree;

  it("prefixa ids e referências para vários nós na mesma tela", () => {
    const bound = bindSvgTree(tree, { uid: "n1", online: true });
    const ids = find(bound, (n) => !!n.attrs.id).map((n) => n.attrs.id);
    expect(ids.every((id) => id!.startsWith("n1-"))).toBe(true);
    const body = find(bound, (n) => n.attrs.id === "n1-body")[0]!;
    expect(body.attrs.fill).toBe("url(#n1-g)");
    expect(body.attrs["clip-path"]).toBe("url(#n1-c)");
    expect(find(bound, (n) => n.name === "use")[0]!.attrs.href).toBe("#n1-body");
  });

  it("usa as cores do tema conforme online/offline e marca a seleção", () => {
    const on = find(bindSvgTree(tree, { uid: "a", online: true, active: true }), (n) => n.attrs.id === "a-status-led")[0]!;
    expect(on.attrs.fill).toBe("var(--led-on)");
    expect(on.attrs.class).toBe("svg-status-led deco-led is-active");
    const off = find(bindSvgTree(tree, { uid: "b", online: false }), (n) => n.attrs.id === "b-status-led")[0]!;
    expect(off.attrs.fill).toBe("var(--led-off)");
    expect(off.attrs.class).toBe("svg-status-led");
  });

  it("num <g>, pinta as formas de dentro", () => {
    const g = sanitizeSvg('<svg viewBox="0 0 8 8"><g id="status-led"><circle r="1" fill="#0f0"/><rect width="1" height="1"/></g></svg>').tree;
    const shapes = find(bindSvgTree(g, { uid: "x", online: false }), (n) => n.name === "circle" || n.name === "rect");
    expect(shapes.map((s) => s.attrs.fill)).toEqual(["var(--led-off)", "var(--led-off)"]);
  });

  it("não altera a árvore original (cache compartilhado entre nós)", () => {
    bindSvgTree(tree, { uid: "z", online: true });
    expect(find(tree, (n) => n.attrs.id === "status-led")[0]!.attrs.fill).toBe("#0f0");
  });
});

describe("parser", () => {
  it("decodifica entidades permitidas e numéricas", () => {
    const root = parseSvg('<svg viewBox="0 0 1 1"><text>&#65;&#x42;&quot;</text></svg>');
    expect((root.children[0] as SvgNode).children[0]).toBe('AB"');
  });
});
