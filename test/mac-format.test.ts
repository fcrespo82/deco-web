import { describe, expect, it } from "vitest";
import { formatMac, formatMacText, MAC_FORMATS } from "../web/src/lib/mac-format.js";
import { parsePreferences } from "../web/src/lib/preferences.js";

describe("formatação de MAC para exibição", () => {
  it("converte os quatro formatos sem depender da entrada", () => {
    const expected = ["AA-BB-CC-DD-EE-FF", "AA:BB:CC:DD:EE:FF", "AABB.CCDD.EEFF", "AABBCCDDEEFF"];
    for (const input of ["aa-bb-cc-dd-ee-ff", "aa:bb:cc:dd:ee:ff", "aabb.ccdd.eeff", "aabbccddeeff"]) {
      MAC_FORMATS.forEach((f, index) => expect(formatMac(input, f.value)).toBe(expected[index]));
    }
  });
  it("preserva IPs, nomes e entradas incompletas", () => {
    for (const text of ["192.168.68.1", "Sala", "AA-BB", "—", ""]) expect(formatMac(text, "colon")).toBe(text);
  });
  it("formata MACs em detalhes de eventos sem modificar o restante", () => {
    expect(formatMacText("192.168.68.3 · aa-bb-cc-dd-ee-ff → 11:22:33:44:55:66", "dot"))
      .toBe("192.168.68.3 · AABB.CCDD.EEFF → 1122.3344.5566");
  });
  it("migra preferências antigas e valida o formato salvo", () => {
    expect(parsePreferences({}).macFormat).toBe("hyphen");
    expect(parsePreferences({ macFormat: "invalid" }).macFormat).toBe("hyphen");
    for (const f of MAC_FORMATS) expect(parsePreferences({ macFormat: f.value }).macFormat).toBe(f.value);
  });
});
