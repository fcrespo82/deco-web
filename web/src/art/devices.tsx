/**
 * "Retrato" de cada aparelho: uma categoria inferida do inventário, do tipo
 * que o Deco dá e do nome/fabricante, com ícone e gradiente próprios.
 */
import type { ComponentType } from "preact";
import {
  Cast,
  Cctv,
  CircleQuestionMark,
  Gamepad2,
  House,
  Laptop,
  Lightbulb,
  Monitor,
  Plug,
  Printer,
  Projector,
  Router,
  Server,
  Smartphone,
  Speaker,
  Tablet,
  Tv,
  Watch,
} from "lucide-preact";
import type { ClientView } from "../api";
import { cx } from "../ui";
import { useArtImages } from "./images";

export type Category =
  | "phone"
  | "tablet"
  | "laptop"
  | "desktop"
  | "tv"
  | "media"
  | "speaker"
  | "camera"
  | "light"
  | "plug"
  | "iot"
  | "printer"
  | "console"
  | "projector"
  | "watch"
  | "network"
  | "server"
  | "unknown";

type Icon = ComponentType<{ class?: string; size?: number; x?: number; y?: number; color?: string; "stroke-width"?: number }>;

export const CATEGORY: Record<Category, { label: string; icon: Icon; from: string; to: string }> = {
  phone: { label: "Celular", icon: Smartphone, from: "#6366f1", to: "#a855f7" },
  tablet: { label: "Tablet", icon: Tablet, from: "#8b5cf6", to: "#d946ef" },
  laptop: { label: "Notebook", icon: Laptop, from: "#0ea5e9", to: "#6366f1" },
  desktop: { label: "Computador", icon: Monitor, from: "#0369a1", to: "#0ea5e9" },
  tv: { label: "TV", icon: Tv, from: "#f43f5e", to: "#fb923c" },
  media: { label: "Mídia", icon: Cast, from: "#e11d48", to: "#f59e0b" },
  speaker: { label: "Alto-falante", icon: Speaker, from: "#f59e0b", to: "#facc15" },
  camera: { label: "Câmera", icon: Cctv, from: "#334155", to: "#64748b" },
  light: { label: "Lâmpada", icon: Lightbulb, from: "#f59e0b", to: "#fde047" },
  plug: { label: "Tomada", icon: Plug, from: "#059669", to: "#2dd4bf" },
  iot: { label: "Casa", icon: House, from: "#0d9488", to: "#22d3ee" },
  printer: { label: "Impressora", icon: Printer, from: "#475569", to: "#94a3b8" },
  console: { label: "Videogame", icon: Gamepad2, from: "#16a34a", to: "#84cc16" },
  projector: { label: "Projetor", icon: Projector, from: "#db2777", to: "#f472b6" },
  watch: { label: "Relógio", icon: Watch, from: "#9333ea", to: "#ec4899" },
  network: { label: "Rede", icon: Router, from: "#0f766e", to: "#0891b2" },
  server: { label: "Servidor", icon: Server, from: "#1e293b", to: "#475569" },
  unknown: { label: "Desconhecido", icon: CircleQuestionMark, from: "#6b7280", to: "#9ca3af" },
};

const INVENTORY: Record<string, Category> = {
  pc: "desktop",
  notebook: "laptop",
  celular: "phone",
  tablet: "tablet",
  tv: "tv",
  impressora: "printer",
  servidor: "server",
  rede: "network",
};

const DECO: Record<string, Category> = {
  computer: "laptop",
  laptop: "laptop",
  desktop: "desktop",
  mobile: "phone",
  phone: "phone",
  tablet: "tablet",
  "smart plug": "plug",
  "ip camera": "camera",
  camera: "camera",
  "audio & video": "speaker",
  "media player": "media",
  tv: "tv",
  "smart tv": "tv",
  "game console": "console",
  projector: "projector",
  printer: "printer",
  "smart speaker": "speaker",
  "smart home": "iot",
  "smart light": "light",
  router: "network",
  network: "network",
  nas: "server",
  wearable: "watch",
};

const BY_NAME: [RegExp, Category][] = [
  [/iphone|galaxy|pixel|redmi|xiaomi|motorola|\bmoto|android|celular/i, "phone"],
  [/ipad|tab\b|tablet|kindle/i, "tablet"],
  [/macbook|notebook|laptop|thinkpad/i, "laptop"],
  [/imac|desktop|\bpc\b|workstation/i, "desktop"],
  [/chromecast|roku|fire ?tv|apple ?tv|mi ?box|tv ?box/i, "media"],
  [/\btv\b|bravia|webos|tizen/i, "tv"],
  [/echo|alexa|homepod|sonos|nest (mini|audio)|soundbar/i, "speaker"],
  [/\bcam|câmera|camera|doorbell|\bring\b/i, "camera"],
  [/lamp|bulb|l[aâ]mpada|hue|light|wiz/i, "light"],
  [/plug|tomada|socket|tapo p/i, "plug"],
  [/printer|impressora|epson|laserjet|deskjet|brother|canon/i, "printer"],
  [/playstation|ps[45]\b|xbox|switch|nintendo|steam ?deck/i, "console"],
  [/watch|rel[oó]gio|\bband\b/i, "watch"],
  [/\bnas\b|synology|qnap|server|servidor|proxmox|raspberry|homeassistant|home assistant/i, "server"],
  [/\besp|tuya|sonoff|shelly|aqara|zigbee|smart/i, "iot"],
];

type Like = Pick<ClientView, "name" | "deviceType" | "vendor" | "suggestedType"> & { device?: { type: string | null; alias: string } | null };

export function categoryOf(c: Like): Category {
  const inv = c.device?.type ?? c.suggestedType;
  if (inv && INVENTORY[inv]) return INVENTORY[inv]!;
  const text = `${c.device?.alias ?? ""} ${c.name} ${c.vendor ?? ""}`;
  for (const [re, cat] of BY_NAME) if (re.test(text)) return cat;
  const deco = c.deviceType && DECO[c.deviceType.toLowerCase()];
  if (deco) return deco;
  if (inv === "iot") return "iot";
  return "unknown";
}

/** Iniciais para o selo do fabricante: "Samsung" → "S", "TP-Link" → "TP". */
export function vendorMark(vendor: string | null): string | null {
  if (!vendor) return null;
  const parts = vendor.split(/[\s-]+/).filter(Boolean);
  return parts.length > 1 && parts[0]!.length <= 3 ? parts[0]!.slice(0, 2).toUpperCase() : vendor.slice(0, 1).toUpperCase();
}

/** Gradientes das categorias, para referenciar como fill="url(#cat-phone)". */
export function CategoryGradients() {
  return (
    <defs>
      {(Object.keys(CATEGORY) as Category[]).map((k) => (
        <linearGradient id={`cat-${k}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color={CATEGORY[k].from} />
          <stop offset="1" stop-color={CATEGORY[k].to} />
        </linearGradient>
      ))}
    </defs>
  );
}

const SIZES = {
  sm: "size-8 rounded-[10px] [&>svg]:size-4",
  md: "size-11 rounded-[13px] [&>svg]:size-5",
  lg: "size-16 rounded-[18px] [&>svg]:size-7",
  xl: "size-24 rounded-[26px] [&>svg]:size-11",
} as const;

/** Avatar quadrado arredondado, com selo do fabricante e ponto de status. */
export function DeviceArt({
  category,
  size = "md",
  online = true,
  vendor,
  deviceId,
  class: klass,
}: {
  category: Category;
  size?: keyof typeof SIZES;
  online?: boolean;
  vendor?: string | null;
  /** Dispositivo do inventário, para usar a foto dele (tela Aparência). */
  deviceId?: number | null;
  class?: string;
}) {
  const meta = CATEGORY[category];
  const Icon = meta.icon;
  const mark = size !== "sm" ? vendorMark(vendor ?? null) : null;
  const { images, device } = useArtImages();
  const photo = device(category, deviceId);
  const own = photo && deviceId != null && images?.devices[String(deviceId)] === photo.src;
  return (
    <span
      class={cx(
        "device-art relative inline-flex shrink-0 items-center justify-center text-white",
        SIZES[size],
        photo && "bg-white ring-1 ring-line",
        !online && "opacity-45 grayscale",
        klass,
      )}
      style={photo ? undefined : { backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
      title={meta.label}
    >
      {photo ? (
        // Foto do próprio aparelho preenche; imagem de categoria (recorte de produto) fica inteira.
        <img src={photo.src} alt="" loading="lazy" decoding="async" class={cx("size-full rounded-[inherit]", own ? "object-cover" : "object-contain p-[12%]")} />
      ) : (
        <Icon stroke-width={1.75} />
      )}
      {mark && (
        <span class="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-fg px-1 text-[9px] font-bold leading-none text-bg">
          {mark}
        </span>
      )}
    </span>
  );
}
