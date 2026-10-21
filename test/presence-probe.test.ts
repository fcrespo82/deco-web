import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { parseArp, presenceTargets, probePresence, withPanelClients, type ProbeDeps } from "../src/core/presence-probe.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import type { Snapshot } from "../src/deco-client/types.js";
import { silentLogger } from "../src/log.js";
import { buildClients } from "../src/server/views.js";

const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.68.12    0x1         0x2         bc:24:11:5e:f8:b8     *        eth0
192.168.68.33    0x1         0x2         bc:24:11:4f:96:21     *        eth0
192.168.68.40    0x1         0x0         00:00:00:00:00:00     *        eth0
192.168.68.50    0x1         0x2         aa:aa:aa:aa:aa:aa     *        eth0
`;

function fakeDeps(arp: string, local: { mac: string; ip: string }[] = []) {
  const sent: string[] = [];
  const deps: ProbeDeps = {
    sendProbe: (ip) => sent.push(ip),
    readArp: () => arp,
    localInterfaces: () => local,
    wait: async () => undefined,
  };
  return { deps, sent };
}

const snap = (over: Partial<Snapshot> = {}): Snapshot =>
  ({ takenAt: "2026-10-21T00:00:00.000Z", nodes: [], clients: [], reservations: [], reservationMax: 200, ...over }) as Snapshot;

describe("presença vista pelo painel", () => {
  it("lê só entradas completas do /proc/net/arp", () => {
    const m = parseArp(ARP);
    expect(m.get("192.168.68.12")).toBe("BC-24-11-5E-F8-B8");
    expect(m.has("192.168.68.40")).toBe(false);
  });

  it("confirma pelo MAC: IP respondido por outro aparelho não conta", async () => {
    const { deps, sent } = fakeDeps(ARP);
    const hits = await probePresence(
      [
        { mac: "BC-24-11-5E-F8-B8", ips: ["192.168.68.12"] },
        { mac: "3C-52-A1-DC-0E-71", ips: ["192.168.68.50"] }, // .50 responde com outro MAC
        { mac: "BC-24-11-4F-96-21", ips: ["192.168.68.22", "192.168.68.33"] }, // ainda no IP antigo
      ],
      deps,
    );
    expect(sent).toEqual(["192.168.68.12", "192.168.68.50", "192.168.68.22", "192.168.68.33"]);
    expect(hits).toEqual([
      { mac: "BC-24-11-5E-F8-B8", ip: "192.168.68.12", self: false },
      { mac: "BC-24-11-4F-96-21", ip: "192.168.68.33", self: false },
    ]);
  });

  it("reconhece o próprio host sem sondar", async () => {
    const { deps, sent } = fakeDeps("", [{ mac: "bc:24:11:5e:f8:b8", ip: "192.168.68.12" }]);
    const hits = await probePresence([{ mac: "BC-24-11-5E-F8-B8", ips: ["192.168.68.12"] }], deps);
    expect(sent).toEqual([]);
    expect(hits).toEqual([{ mac: "BC-24-11-5E-F8-B8", ip: "192.168.68.12", self: true }]);
  });

  it("só confere reservados/cadastrados que o Deco não listou", () => {
    const s = snap({
      clients: [{ mac: "AA-AA-AA-AA-AA-01", name: "listado", ip: "192.168.68.9", deviceType: "", band: "wired", network: "main", nodeMac: null, upKBps: 0, downKBps: 0 }],
      reservations: [
        { mac: "AA-AA-AA-AA-AA-01", ip: "192.168.68.9" },
        { mac: "AA-AA-AA-AA-AA-02", ip: "192.168.68.10" },
      ],
    });
    const targets = presenceTargets(s, (mac) => (mac === "AA-AA-AA-AA-AA-03" ? "192.168.68.77" : null), ["AA-AA-AA-AA-AA-03", "AA-AA-AA-AA-AA-04"]);
    expect(targets).toEqual([
      { mac: "AA-AA-AA-AA-AA-02", ips: ["192.168.68.10"] },
      { mac: "AA-AA-AA-AA-AA-03", ips: ["192.168.68.77"] },
    ]);
  });

  it("não acrescenta o próprio host fora da rede do Deco (container com rede própria)", () => {
    const out = withPanelClients(snap(), [{ mac: "02-42-AC-11-00-02", ip: "172.17.0.2", self: true }], (ip) => ip.startsWith("192.168.68."), () => "x");
    expect(out.clients).toEqual([]);
  });
});

describe("integração com o poller", () => {
  const opened: { app: App; dir: string }[] = [];
  afterEach(async () => {
    for (const { app, dir } of opened.splice(0)) {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aparelho reservado fora da lista do Deco aparece online, visto pelo painel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deco-web-probe-"));
    const api = new MockDecoApi();
    // Uma reserva do fixture que o Deco do mock não lista como cliente.
    const raw = await api.fetchSnapshot();
    const listed = new Set(raw.clients.map((c) => c.mac));
    const hidden = raw.reservations.find((r) => !listed.has(r.mac))!;
    const mac = hidden.mac.toLowerCase().replace(/-/g, ":");
    const { deps } = fakeDeps(`IP address HW type Flags HW address Mask Device\n${hidden.ip} 0x1 0x2 ${mac} * eth0\n`);
    const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, { api, probe: deps });
    opened.push({ app, dir });

    await app.poller.pollNow();
    const clients = buildClients(app.poller.cache.snapshot, app.store.clientSeen(), app.inventory.byMac());
    const c = clients.find((x) => x.mac === hidden.mac)!;
    expect(c).toMatchObject({ online: true, ip: hidden.ip, viaPanel: true });
    // Listados pelo Deco não ganham a marca.
    expect(clients.filter((x) => x.viaPanel).map((x) => x.mac)).toEqual([hidden.mac]);
  });

  it("Wi-Fi omitido pelo Deco não vira cabo (nem na tela, nem no histórico)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deco-web-probe-"));
    const api = new MockDecoApi();
    const first = await api.fetchSnapshot();
    const wifi = first.clients.find((c) => c.band === "2.4GHz")!;
    const arp = `IP address HW type Flags HW address Mask Device\n${wifi.ip} 0x1 0x2 ${wifi.mac.toLowerCase().replace(/-/g, ":")} * eth0\n`;
    const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, {
      api,
      probe: { sendProbe: () => {}, readArp: () => arp, localInterfaces: () => [], wait: async () => {} },
    });
    opened.push({ app, dir });
    app.inventory.upsertForMac(wifi.mac, { alias: "tomada", type: "iot" });

    await app.poller.pollNow(); // o Deco lista: 2,4 GHz
    // Próxima leitura: o Deco omite o aparelho (como acontece de verdade).
    api.mutate((raw) => {
      const list = (raw.clientList as { client_list: { mac: string }[] }).client_list;
      (raw.clientList as { client_list: unknown[] }).client_list = list.filter((c) => c.mac.toUpperCase() !== wifi.mac);
      for (const v of Object.values(raw.clientsByNode as Record<string, { client_list: { mac: string }[] | object }>)) {
        if (Array.isArray(v.client_list)) v.client_list = v.client_list.filter((c) => c.mac.toUpperCase() !== wifi.mac);
      }
    });
    await app.poller.pollNow();

    const c = buildClients(app.poller.cache.snapshot, app.store.clientSeen(), app.inventory.byMac()).find((x) => x.mac === wifi.mac)!;
    expect(c).toMatchObject({ online: true, viaPanel: true, band: null, network: null });
    expect(app.store.clientSeen().get(wifi.mac)?.lastBand).toBe("2.4GHz");
  });
});
