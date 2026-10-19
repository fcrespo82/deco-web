/** Peças das ilustrações para dentro de um <svg> (mapa e bolhas). */
import { DecoShapeSvg } from "./DecoArt";
import { CATEGORY, type Category } from "./devices";
import type { Art } from "./images";

/** Recorte circular reutilizável (unidades relativas à própria imagem). */
export function PhotoDefs() {
  return (
    <defs>
      <clipPath id="avatar-clip" clipPathUnits="objectBoundingBox">
        <circle cx="0.5" cy="0.5" r="0.5" />
      </clipPath>
    </defs>
  );
}

/** Avatar circular centrado em (0,0): foto, se houver, ou gradiente + ícone. */
export function SvgAvatar({ category, r, art, own, ring = true }: { category: Category; r: number; art: Art | null; own?: boolean; ring?: boolean }) {
  const stroke = ring ? { stroke: "var(--surface)", "stroke-width": 2 } : {};
  if (art) {
    // Foto do aparelho preenche o círculo; imagem de categoria fica inteira, com margem.
    const inset = own ? r : r * 0.72;
    return (
      <>
        <circle r={r} fill="#fff" {...stroke} />
        <image
          href={art.src}
          x={-inset}
          y={-inset}
          width={inset * 2}
          height={inset * 2}
          preserveAspectRatio={own ? "xMidYMid slice" : "xMidYMid meet"}
          clip-path={own ? "url(#avatar-clip)" : undefined}
        />
      </>
    );
  }
  const Icon = CATEGORY[category].icon;
  const icon = Math.max(10, Math.min(22, r * 0.9));
  return (
    <>
      <circle r={r} fill={`url(#cat-${category})`} {...stroke} />
      <Icon x={-icon / 2} y={-icon / 2} size={icon} color="white" stroke-width={r < 16 ? 2 : 1.9} />
    </>
  );
}

/** Deco desenhado ou foto, numa caixa 60×75 com o centro do aparelho em (0,0). */
export function SvgDeco({ model, online, active, uid, art }: { model: string; online: boolean; active?: boolean; uid: string; art: Art | null }) {
  if (art) {
    return (
      <g class={online ? "" : "topo-photo-off"}>
        {art.opaque && <rect x="-31" y="-47" width="62" height="72" rx="14" class="topo-photo-pedestal" />}
        <image
          href={art.src}
          x="-28"
          y="-46"
          width="56"
          height="70"
          preserveAspectRatio="xMidYMid meet"
          style={art.opaque ? undefined : { filter: "drop-shadow(0 6px 6px rgb(15 23 42 / 0.25))" }}
        />
        {online && <circle cx="18" cy="18" r="9" fill="var(--led-on)" opacity="0.35" class="deco-led-glow" />}
        <circle cx="18" cy="18" r="4" fill={online ? "var(--led-on)" : "var(--led-off)"} stroke="var(--surface)" stroke-width="1.5" class={online ? "deco-led" : ""} />
      </g>
    );
  }
  return (
    <svg x="-30" y="-48" width="60" height="75" viewBox="0 0 64 80" overflow="visible">
      <DecoShapeSvg model={model} online={online} active={active} uid={uid} />
    </svg>
  );
}
