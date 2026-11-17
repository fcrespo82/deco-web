export const MAC_FORMATS = [
  { value: "hyphen", label: "Hífens", example: "AA-BB-CC-DD-EE-FF" },
  { value: "colon", label: "Dois-pontos", example: "AA:BB:CC:DD:EE:FF" },
  { value: "dot", label: "Pontos (Cisco)", example: "AABB.CCDD.EEFF" },
  { value: "plain", label: "Sem separador", example: "AABBCCDDEEFF" },
] as const;
export type MacFormat = typeof MAC_FORMATS[number]["value"];

/** Somente apresentação: nunca altera a identidade enviada à API. */
export function formatMac(value: string, format: MacFormat): string {
  if (!/^(?:[\da-f]{12}|(?:[\da-f]{2}[:-]){5}[\da-f]{2}|(?:[\da-f]{4}\.){2}[\da-f]{4})$/i.test(value)) return value;
  const hex = value.replace(/[-:.]/g, "").toUpperCase();
  if (format === "plain") return hex;
  if (format === "dot") return hex.match(/.{4}/g)!.join(".");
  return hex.match(/.{2}/g)!.join(format === "colon" ? ":" : "-");
}

export function formatMacText(value: string, format: MacFormat): string {
  return value.replace(/\b(?:[\da-f]{2}[:-]){5}[\da-f]{2}\b|\b(?:[\da-f]{4}\.){2}[\da-f]{4}\b|\b[\da-f]{12}\b/gi, mac => formatMac(mac, format));
}
