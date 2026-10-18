import { describe, expect, it } from "vitest";
import { macInfo, shortVendor } from "../src/core/oui.js";
import { suggestType } from "../src/core/suggest-type.js";

describe("macInfo (base do IEEE, local)", () => {
  it("bloco de 24 bits, com e sem separador", () => {
    expect(macInfo("BC-24-11-00-00-01")).toEqual({ vendor: "Proxmox Server Solutions GmbH", vendorShort: "Proxmox Server Solutions", randomized: false });
    expect(macInfo("a4:83:e7:12:34:56").vendorShort).toBe("Apple");
    expect(macInfo("24-0A-C4-00-00-01").vendorShort).toBe("Espressif");
  });

  it("bloco de 36 bits vence o de 24 bits que o contém", () => {
    expect(macInfo("00-1B-C5-00-00-AA").vendor).toBe("Converging Systems Inc.");
    expect(macInfo("00-1B-C5-00-1F-AA").vendor).toBe("OpenRB.com, Direct SIA");
  });

  it("MAC administrado localmente: aleatório, sem fabricante", () => {
    for (const mac of ["02-00-00-00-00-01", "DE-F9-6A-00-00-01", "BA-D1-5A-00-00-01", "8A-D3-DF-00-00-01"]) {
      expect(macInfo(mac)).toEqual({ vendor: null, vendorShort: null, randomized: true });
    }
  });

  it("prefixo não registrado e MAC inválido", () => {
    expect(macInfo("00-00-00-00-00-00").randomized).toBe(false);
    expect(macInfo("xx").vendor).toBeNull();
  });
});

describe("shortVendor", () => {
  it.each([
    ["Apple, Inc.", "Apple"],
    ["TP-LINK TECHNOLOGIES CO.,LTD.", "TP-LINK"],
    ["Espressif Inc.", "Espressif"],
    ["Samsung Electronics Co.,Ltd", "Samsung"],
    ["Intel Corporate", "Intel Corporate"],
  ])("%s → %s", (full, short) => expect(shortVendor(full)).toBe(short));
});

describe("suggestType", () => {
  const s = (name: string | null, decoType: string | null, vendor: string | null = null) => suggestType({ name, decoType, vendor });

  it("pelos nomes e categorias que o Deco dá", () => {
    expect(s("iPhone", "Mobile")).toBe("celular");
    expect(s("iPad-de-Joao", "Tablet")).toBe("tablet");
    expect(s("P110", "Smart Plug")).toBe("iot");
    expect(s("LED João", "Smart Light")).toBe("iot");
    expect(s("C200", "IP Camera")).toBe("iot");
    expect(s("Sala-de-TV", "Media Player")).toBe("tv");
    expect(s("Samsung", "Projector")).toBe("tv");
    expect(s("BTV13", "Audio & Video")).toBe("tv");
    expect(s("HPIFDBC49", null)).toBe("impressora");
    expect(s("Ender3V3-4D83", "Computer")).toBe("impressora");
    expect(s("OmniBook3-Tha^s", "Computer")).toBe("notebook");
    expect(s("nas-fcrespo82", "Network")).toBe("servidor");
    expect(s("cachyos", "Computer")).toBe("pc");
    expect(s("proxmox", "Computer", "REALTEK SEMICONDUCTOR CORP.")).toBe("servidor");
    expect(s("homeassistant", "Computer")).toBe("servidor");
    expect(s("adguard2", "Computer")).toBe("servidor");
  });

  it("pelo fabricante", () => {
    expect(s("traefik", "Computer", "Proxmox Server Solutions GmbH")).toBe("servidor");
    expect(s("iot_device_78E7", "Other")).toBe("iot");
    expect(s(null, "Other", "Espressif Inc.")).toBe("iot");
    expect(s(null, null, "Seiko Epson Corporation")).toBe("impressora");
    expect(s(null, null, "Philips Lighting BV")).toBe("iot");
  });

  it("Smart TV não vira IoT", () => {
    expect(s("TV da sala", "Smart TV")).toBe("tv");
  });

  it("sem pista: null", () => {
    expect(s("abc", "Other")).toBeNull();
    expect(s(null, null)).toBeNull();
  });
});
