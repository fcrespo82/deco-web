/**
 * Ilustrações dos nós Deco, desenhadas em SVG por família de modelo: torre
 * (X20/X50/X55…), cilindro alto com tampa escura (M4/E4/S4) e disco baixo
 * (M5/M9/P9). O LED muda de cor com o estado e "respira" quando online.
 */
import { cx } from "../ui";
import { useArtImages, type Art } from "./images";

export type DecoShape = "tower" | "tall" | "puck";

export function decoShape(model: string): DecoShape {
  const m = model.toUpperCase().replace(/\s+/g, "");
  if (/^(M5|M9|P9|M3W|P7)/.test(m)) return "puck";
  if (/^(M4|M3|E4|E3|S4|S7)/.test(m)) return "tall";
  return "tower";
}

interface Props {
  model: string;
  online: boolean;
  /** Destaca o LED (nó selecionado no mapa). */
  active?: boolean;
  class?: string;
  /** Prefixo único para os ids de gradiente quando há várias na página. */
  uid: string;
}

/** Conteúdo SVG (viewBox 0 0 64 80), para usar dentro de outro <svg>. */
export function DecoShapeSvg({ model, online, active, uid }: Omit<Props, "class">) {
  const shape = decoShape(model);
  const body = `${uid}-body`;
  const top = `${uid}-top`;
  const led = online ? "var(--led-on)" : "var(--led-off)";
  const defs = (
    <defs>
      <linearGradient id={body} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="var(--deco-shade)" />
        <stop offset="0.38" stop-color="var(--deco-light)" />
        <stop offset="0.62" stop-color="var(--deco-mid)" />
        <stop offset="1" stop-color="var(--deco-shade)" />
      </linearGradient>
      <radialGradient id={top} cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stop-color="var(--deco-light)" />
        <stop offset="1" stop-color="var(--deco-mid)" />
      </radialGradient>
    </defs>
  );
  const shadow = <ellipse cx="32" cy="75" rx="24" ry="4" fill="var(--deco-floor)" />;
  const ledEl = (cx: number, cy: number, rx: number, ry: number) => (
    <>
      {online && <ellipse class="deco-led-glow" cx={cx} cy={cy} rx={rx * 2.4} ry={ry * 3} fill={led} opacity={active ? 0.55 : 0.3} />}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={led} class={online ? "deco-led" : ""} />
    </>
  );

  if (shape === "puck") {
    return (
      <g>
        {defs}
        {shadow}
        <path d="M6 46 Q6 40 12 40 H52 Q58 40 58 46 V62 Q58 72 32 72 Q6 72 6 62 Z" fill={`url(#${body})`} />
        <ellipse cx="32" cy="44" rx="26" ry="8" fill={`url(#${top})`} />
        <ellipse cx="32" cy="44" rx="19" ry="5.2" fill="none" stroke="var(--deco-shade)" stroke-width="0.8" opacity="0.6" />
        <path d="M14 66 Q32 71 50 66" fill="none" stroke="var(--deco-shade)" stroke-width="0.8" opacity="0.7" />
        {ledEl(32, 44, 3.2, 1.2)}
      </g>
    );
  }
  if (shape === "tall") {
    return (
      <g>
        {defs}
        {shadow}
        <path d="M17 14 V68 Q17 74 32 74 Q47 74 47 68 V14 Z" fill={`url(#${body})`} />
        <ellipse cx="32" cy="14" rx="15" ry="4.6" fill="var(--deco-cap)" />
        <ellipse cx="32" cy="13.4" rx="11.5" ry="3.2" fill="var(--deco-cap-top)" />
        {ledEl(32, 63, 1.8, 1.2)}
      </g>
    );
  }
  return (
    <g>
      {defs}
      {shadow}
      <path d="M13 12 V67 Q13 74 32 74 Q51 74 51 67 V12 Z" fill={`url(#${body})`} />
      <ellipse cx="32" cy="12" rx="19" ry="5.5" fill={`url(#${top})`} />
      <ellipse cx="32" cy="12" rx="13" ry="3.4" fill="none" stroke="var(--deco-shade)" stroke-width="0.7" opacity="0.7" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect x={22 + i * 4.4} y="64" width="1.6" height="5" rx="0.8" fill="var(--deco-shade)" opacity="0.8" />
      ))}
      {ledEl(32, 12, 2.6, 1)}
    </g>
  );
}

/** Foto escolhida na tela Aparência, com o LED de estado por cima. */
function DecoPhoto({ art, online, class: klass }: { art: Art; online: boolean; class?: string }) {
  return (
    <span class={cx("deco-photo", art.opaque && "is-opaque", !online && "is-off", klass)} aria-hidden="true">
      <img src={art.src} alt="" loading="lazy" decoding="async" />
      <span class={cx("deco-photo-led", online && "deco-led")} />
    </span>
  );
}

export function DecoArt({ class: klass, ...props }: Props) {
  const { deco } = useArtImages();
  const photo = deco(props.model);
  if (photo) return <DecoPhoto art={photo} online={props.online} class={klass} />;
  return (
    <svg viewBox="0 0 64 80" class={cx("block", !props.online && "opacity-70 grayscale", klass)} aria-hidden="true">
      <DecoShapeSvg {...props} />
    </svg>
  );
}
