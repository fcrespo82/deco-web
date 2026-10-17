import { afterEach, describe, expect, it } from "vitest";
import { subnetOf } from "../src/core/ipmath.js";
import { NotFoundError, ValidationError } from "../src/db/errors.js";
import { InventoryRepo } from "../src/db/inventory.js";
import { IpRangeRepo } from "../src/db/ipranges.js";
import { Store } from "../src/db/store.js";
import { bucketSamples } from "../src/server/history.js";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function repos() {
  const store = new Store(":memory:");
  stores.push(store);
  return { inv: new InventoryRepo(store.db), ranges: new IpRangeRepo(store.db) };
}
const A = "AA-AA-AA-AA-AA-01";
const B = "AA-AA-AA-AA-AA-02";
const lan = subnetOf("192.168.68.1", "255.255.255.0");

describe("InventoryRepo", () => {
  it("cria com MACs normalizados e valida campos", () => {
    const { inv } = repos();
    const d = inv.create({ alias: " PC do João ", type: "pc", tags: ["casa", "casa", " "], macs: ["aa:aa:aa:aa:aa:01"] });
    expect(d).toMatchObject({ alias: "PC do João", type: "pc", tags: ["casa"], macs: [A], approved: false });
    expect(() => inv.create({ alias: "", macs: [A] })).toThrow(ValidationError);
    expect(() => inv.create({ alias: "x", macs: [] })).toThrow(/ao menos um MAC/);
    expect(() => inv.create({ alias: "x", type: "geladeira", macs: [B] })).toThrow(/Tipo inválido/);
    expect(() => inv.create({ alias: "x", macs: ["zz"] })).toThrow(/MAC inválido/);
  });

  it("agrupa MACs: mover para outro dispositivo apaga o que ficou vazio", () => {
    const { inv } = repos();
    const pc = inv.create({ alias: "PC", macs: [A] });
    const wifi = inv.create({ alias: "PC (Wi-Fi)", macs: [B] });
    const merged = inv.attachMac(pc.id, B);
    expect(merged.macs).toEqual([A, B]);
    expect(() => inv.get(wifi.id)).toThrow(NotFoundError);
    expect(inv.byMac().get(B)?.id).toBe(pc.id);
  });

  it("separar MAC; o último MAC não pode ser removido", () => {
    const { inv } = repos();
    const pc = inv.create({ alias: "PC", macs: [A, B] });
    expect(inv.detachMac(pc.id, B).macs).toEqual([A]);
    expect(() => inv.detachMac(pc.id, A)).toThrow(/único MAC/);
  });

  it("upsert por MAC cria e depois atualiza o mesmo dispositivo", () => {
    const { inv } = repos();
    const created = inv.upsertForMac(A, { alias: "TV", type: "tv" });
    const updated = inv.upsertForMac(A, { owner: "Ana" });
    expect(updated).toMatchObject({ id: created.id, alias: "TV", owner: "Ana", type: "tv" });
  });

  it("update parcial não apaga campos ausentes", () => {
    const { inv } = repos();
    const d = inv.create({ alias: "NAS", type: "servidor", notes: "Synology", macs: [A] });
    expect(inv.update(d.id, { approved: true })).toMatchObject({ type: "servidor", notes: "Synology", approved: true });
    expect(inv.update(d.id, { notes: null }).notes).toBeNull();
  });

  it("excluir remove os MACs junto", () => {
    const { inv } = repos();
    const d = inv.create({ alias: "x", macs: [A] });
    inv.delete(d.id);
    expect(inv.findByMac(A)).toBeNull();
  });
});

describe("IpRangeRepo", () => {
  it("cria, ordena e recusa sobreposição", () => {
    const { ranges } = repos();
    ranges.create({ name: "IoT", spec: ".100+", kind: "dynamic" }, lan);
    const trusted = ranges.create({ name: "Confiáveis", spec: ".8/29", kind: "static", types: ["pc", "servidor"] }, lan);
    expect(trusted.label).toBe(".8/29");
    expect(ranges.list().map((r) => r.name)).toEqual(["Confiáveis", "IoT"]);
    expect(() => ranges.create({ name: "X", spec: ".12-.20", kind: "static" }, lan)).toThrow(/Sobrepõe a faixa "Confiáveis"/);
  });

  it("valida tipo, especificação e tipos de dispositivo", () => {
    const { ranges } = repos();
    expect(() => ranges.create({ name: "X", spec: ".8/29", kind: "outro" }, lan)).toThrow(/static/);
    expect(() => ranges.create({ name: "X", spec: ".9/29", kind: "static" }, lan)).toThrow(/alinhado/);
    expect(() => ranges.create({ name: "X", spec: ".8/29", kind: "static", types: ["geladeira"] }, lan)).toThrow(/inválido/);
  });

  it("edição parcial mantém o resto e pode mover a faixa sem colidir consigo mesma", () => {
    const { ranges } = repos();
    const r = ranges.create({ name: "Servidores", spec: ".20-.39", kind: "static" }, lan);
    const moved = ranges.update(r.id, { spec: ".24-.39" }, lan);
    expect(moved).toMatchObject({ name: "Servidores", kind: "static", label: ".24–.39" });
  });
});

describe("bucketSamples", () => {
  const sample = (iso: string, n: number) => ({ takenAt: iso, onlineClients: n, nodesOnline: 6, nodesTotal: 6, byBand: {} });

  it("agrupa em baldes com média e máximo, sem baldes vazios", () => {
    const from = Date.parse("2026-10-17T00:00:00Z");
    const to = from + 4 * 3600_000;
    const { bucketMs, points } = bucketSamples(
      [sample("2026-10-17T00:01:00Z", 10), sample("2026-10-17T00:02:00Z", 20), sample("2026-10-17T03:00:00Z", 5)],
      from,
      to,
      4,
    );
    expect(bucketMs).toBe(3600_000);
    expect(points).toEqual([
      { t: "2026-10-17T00:00:00.000Z", avg: 15, max: 20 },
      { t: "2026-10-17T03:00:00.000Z", avg: 5, max: 5 },
    ]);
  });
});
