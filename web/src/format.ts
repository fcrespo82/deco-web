import type { Band } from "./api";

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const dtf = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** "há 3 minutos", "agora". */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "agora";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

/** Duração desde `iso` até agora: "3 h 12 min", "2 d 4 h". */
export function since(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function dateTime(iso: string | null): string {
  return iso ? dtf.format(new Date(iso)) : "—";
}

/** O firmware reporta KB/s; mostramos em bits, como se fala de banda. */
export function rate(kBps: number): string {
  if (!kBps) return "0";
  const kbps = kBps * 8;
  if (kbps < 1000) return `${Math.round(kbps)} Kbps`;
  const mbps = kbps / 1000;
  return `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mbps`;
}

export const BAND_LABEL: Record<Band, string> = {
  "2.4GHz": "2,4 GHz",
  "5GHz": "5 GHz",
  "6GHz": "6 GHz",
  wired: "Cabo",
};

export const NETWORK_LABEL: Record<string, string> = {
  main: "Principal",
  iot: "IoT",
  guest: "Convidados",
};

export const WIFI_KIND_LABEL: Record<string, string> = {
  host: "Principal",
  guest: "Convidados",
  iot: "IoT",
};

export const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** O firmware classifica em inglês; traduz os tipos conhecidos. */
const DEVICE_TYPE_LABEL: Record<string, string> = {
  computer: "Computador",
  desktop: "Desktop",
  laptop: "Notebook",
  mobile: "Celular",
  phone: "Celular",
  tablet: "Tablet",
  "smart plug": "Tomada inteligente",
  "ip camera": "Câmera IP",
  camera: "Câmera",
  "audio & video": "Áudio e vídeo",
  "media player": "Media player",
  tv: "TV",
  "smart tv": "TV",
  "game console": "Videogame",
  printer: "Impressora",
  "smart speaker": "Alto-falante inteligente",
  "smart home": "Casa inteligente",
  router: "Roteador",
  nas: "NAS",
  "smart light": "Lâmpada inteligente",
  wearable: "Vestível",
  unknown: "Desconhecido",
  other: "Outro",
};

export const deviceType = (t: string | null) => (t ? (DEVICE_TYPE_LABEL[t.toLowerCase()] ?? t) : null);

/** "1.11.1 Build 26081714 Rel. 32981" → "1.11.1". */
export const shortFirmware = (fw: string) => fw.split(" ")[0] ?? fw;
