/**
 * Gera fixtures/snapshot.json a partir do probe-output.json, anonimizado para
 * poder ir para o git: MACs (mantém o OUI do fabricante), IDs de dispositivo,
 * IP público, nomes de clientes/nós e SSIDs são trocados de forma
 * determinística, preservando as relações (pai/filho, cliente↔nó, reserva↔MAC).
 *
 * Uso: node scripts/make-fixture.js [probe-output.json] [fixtures/snapshot.json]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [input = "probe-output.json", output = "fixtures/snapshot.json"] = process.argv.slice(2);
const probe = JSON.parse(readFileSync(input, "utf8"));
const salt = "deco-web-fixture";

const hex = (value, len) =>
  createHash("sha256").update(salt + value).digest("hex").slice(0, len);

const MAC = /\b([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})[-:]([0-9A-Fa-f]{2})\b/g;
function anonMac(text) {
  return text.replace(MAC, (whole, a, b, c) => {
    const tail = hex(whole.toUpperCase().replace(/:/g, "-"), 6).toUpperCase();
    return [a, b, c, tail.slice(0, 2), tail.slice(2, 4), tail.slice(4, 6)]
      .join("-")
      .toUpperCase();
  });
}

const ID_KEYS = new Set(["device_id", "parent_device_id", "hw_id", "oem_id", "owner_id"]);
const PUBLIC_IPS = new Map();
const publicIp = (ip) => {
  if (!PUBLIC_IPS.has(ip)) PUBLIC_IPS.set(ip, `203.0.113.${10 + PUBLIC_IPS.size}`);
  return PUBLIC_IPS.get(ip);
};

function walk(value, key) {
  if (Array.isArray(value)) return value.map((v) => walk(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [anonMac(k), walk(v, k)]));
  }
  if (typeof value !== "string") return value;
  if (ID_KEYS.has(key) && value) return hex(value, value.length).toUpperCase();
  if ((key === "ip" || key === "gateway") && !value.startsWith("192.168.") && value !== "0.0.0.0") {
    return publicIp(value);
  }
  return anonMac(value);
}

const ok = (key) => {
  const entry = probe.forms[key];
  if (!entry?.ok) throw new Error(`${key} não está no probe`);
  return entry.result;
};

const raw = walk({
  deviceList: ok("admin/device?form=device_list"),
  clientList: ok("admin/client?form=client_list"),
  clientsByNode: Object.fromEntries(
    Object.entries(probe.clientsByNode).filter(([, v]) => v.ok).map(([mac, v]) => [mac, v.result]),
  ),
  reservations: ok("admin/client?form=addr_reservation"),
  internet: ok("admin/network?form=internet"),
  wan: ok("admin/network?form=wan_ipv4"),
  wlan: ok("admin/wireless?form=wlan"),
  performance: ok("admin/network?form=performance"),
});

// Nomes legíveis mas genéricos, numerados por tipo.
const perType = new Map();
for (const c of raw.clientList.client_list) {
  const type = c.client_type || "Dispositivo";
  const n = (perType.get(type) ?? 0) + 1;
  perType.set(type, n);
  c.name = `${type} ${n}`;
}
const byMac = new Map(raw.clientList.client_list.map((c) => [c.mac, c.name]));
for (const list of Object.values(raw.clientsByNode)) {
  for (const c of Array.isArray(list.client_list) ? list.client_list : []) c.name = byMac.get(c.mac) ?? c.name;
}
const rooms = ["Sala", "Escritório", "Quarto", "Cozinha", "Garagem", "Varanda", "Lavanderia"];
raw.deviceList.device_list.forEach((n, i) => {
  if (n.custom_nickname) n.custom_nickname = rooms[i % rooms.length];
  if (n.nickname) n.nickname = rooms[i % rooms.length];
});
for (const band of Object.values(raw.wlan)) {
  if (!band || typeof band !== "object") continue;
  for (const [kind, net] of Object.entries(band)) {
    if (net && typeof net === "object" && "ssid" in net) {
      net.ssid = kind === "host" ? "Casa" : `Casa_${kind}`;
    }
  }
}
raw.wan.wan.user_info = { username: "usuario@provedor" };

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(raw, null, 2) + "\n");
console.log(`Fixture gravada em ${output}`);
