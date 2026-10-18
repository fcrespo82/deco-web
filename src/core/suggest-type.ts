/**
 * Sugestão de tipo para o inventário, a partir do que se sabe de um aparelho
 * sem cadastro: o nome e a categoria que o Deco dá, e o fabricante do MAC.
 * É só uma sugestão: a UI pré-preenche e a pessoa confirma.
 */
import type { DeviceType } from "../db/inventory.js";

export interface TypeHints {
  name: string | null;
  /** Categoria do Deco: Mobile, Smart Plug, IP Camera... */
  decoType: string | null;
  vendor: string | null;
}

const RULES: [DeviceType, (h: { name: string; deco: string; vendor: string }) => boolean][] = [
  // VMs e containers do Proxmox (prefixo BC:24:11).
  ["servidor", (h) => /proxmox/.test(h.vendor)],
  [
    "impressora",
    (h) =>
      /printer/.test(h.deco) ||
      /printer|impressora|^hpi|^npi|epson|brother|canon|ender|bambu|prusa|creality|^3d/.test(h.name) ||
      /seiko epson|brother industries|canon|creality|bambu|prusa/.test(h.vendor),
  ],
  ["tablet", (h) => /tablet/.test(h.deco) || /ipad|\btab\b|galaxy tab|kindle|fire hd/.test(h.name)],
  ["celular", (h) => /mobile|phone/.test(h.deco) || /iphone|android|galaxy|pixel|redmi|motorola|\bmoto\b/.test(h.name)],
  [
    "iot",
    (h) =>
      /camera|plug|light|bulb|sensor|iot|thermostat|doorbell|smart home|smart switch|hub/.test(h.deco) ||
      /iot_device|tapo|shelly|sonoff|tuya|^esp|^c2\d\d$|^p1\d\d$|^l5\d\d$|cam/.test(h.name) ||
      /espressif|tuya|shelly|sonoff|itead|signify|philips lighting|wyze|ring llc|ezviz|hikvision|dahua|xiaomi communications|beijing xiaomi/.test(h.vendor),
  ],
  [
    "tv",
    (h) =>
      /tv|projector|media|audio|video|streaming|speaker|game|console/.test(h.deco) ||
      /\btv\b|-tv|chromecast|roku|appletv|apple-tv|firetv|fire-tv|playstation|xbox/.test(h.name),
  ],
  ["notebook", (h) => /laptop|notebook/.test(h.deco) || /macbook|notebook|laptop|omnibook|thinkpad|zenbook|vivobook|ideapad|latitude|\bxps\b/.test(h.name)],
  [
    "servidor",
    (h) =>
      /server|nas/.test(h.deco) ||
      /\bnas\b|^nas-|server|servidor|proxmox|^pve|adguard|pihole|pi-hole|homeassistant|home-assistant|hassio|truenas|unraid|docker|portainer|traefik/.test(h.name),
  ],
  ["rede", (h) => /network|router|access point|repeater|switch/.test(h.deco)],
  ["pc", (h) => /computer|desktop|pc/.test(h.deco)],
];

export function suggestType(hints: TypeHints): DeviceType | null {
  const h = {
    name: (hints.name ?? "").toLowerCase(),
    deco: (hints.decoType ?? "").toLowerCase(),
    vendor: (hints.vendor ?? "").toLowerCase(),
  };
  return RULES.find(([, test]) => test(h))?.[0] ?? null;
}
