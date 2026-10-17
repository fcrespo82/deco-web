import { describe, expect, it } from "vitest";
import { LiveDecoApi, type SessionClient } from "../src/deco-client/live.js";
import { DecoLoginError } from "../src/deco-client/errors.js";
import { loadFixture } from "../src/deco-client/mock.js";
import type { DecoRequest } from "../src/deco-client/vendor/client.js";

const raw = loadFixture();

/** Cliente falso que responde a partir da fixture e registra as chamadas. */
function fakeClient(fail?: (req: DecoRequest) => Error | undefined) {
  const calls: string[] = [];
  let logouts = 0;
  const client: SessionClient = {
    async call<T>(req: DecoRequest): Promise<T> {
      const mac = (req.params as { device_mac?: string } | undefined)?.device_mac;
      calls.push(`${req.form}${mac && mac !== "default" ? `:${mac}` : ""}`);
      const err = fail?.(req);
      if (err) throw err;
      const byForm: Record<string, unknown> = {
        device_list: raw.deviceList,
        client_list: mac === "default" ? raw.clientList : raw.clientsByNode[mac!],
        addr_reservation: raw.reservations,
        internet: raw.internet,
        wan_ipv4: raw.wan,
        wlan: raw.wlan,
        performance: raw.performance,
      };
      return byForm[req.form] as T;
    },
    async logout() {
      logouts += 1;
    },
  };
  return { client, calls, logouts: () => logouts };
}

describe("LiveDecoApi", () => {
  it("lê tudo no primeiro poll e faz logout", async () => {
    const fake = fakeClient();
    const api = new LiveDecoApi({ host: "h", username: "admin", password: "p", client: fake.client });
    const snap = await api.fetchSnapshot();
    expect(snap.clients.every((c) => c.nodeMac)).toBe(true);
    expect(snap.wifi).not.toBeNull();
    expect(fake.calls.filter((c) => c.startsWith("client_list:"))).toHaveLength(6);
    expect(fake.logouts()).toBe(1);
  });

  it("leitura detalhada só a cada N polls, reaproveitando a anterior", async () => {
    const fake = fakeClient();
    const api = new LiveDecoApi({ host: "h", username: "admin", password: "p", detailEvery: 3, client: fake.client });
    const first = await api.fetchSnapshot();
    fake.calls.length = 0;

    const second = await api.fetchSnapshot();
    expect(fake.calls).toEqual(["device_list", "client_list", "addr_reservation", "internet", "wan_ipv4"]);
    expect(second.detailTakenAt).toBe(first.detailTakenAt);
    expect(second.clients.every((c) => c.nodeMac)).toBe(true);

    await api.fetchSnapshot();
    fake.calls.length = 0;
    await api.fetchSnapshot(); // 3 polls depois do detalhado
    expect(fake.calls).toContain("wlan");
    expect(fake.logouts()).toBe(4);
  });

  it("faz logout mesmo quando uma leitura central falha", async () => {
    const fake = fakeClient((req) => (req.form === "addr_reservation" ? new Error("ECONNRESET") : undefined));
    const api = new LiveDecoApi({ host: "h", username: "admin", password: "p", client: fake.client });
    await expect(api.fetchSnapshot()).rejects.toThrow("ECONNRESET");
    expect(fake.logouts()).toBe(1);
  });

  it("falha numa leitura opcional não derruba o snapshot", async () => {
    const fake = fakeClient((req) => (req.form === "wlan" ? new Error("error_code 1") : undefined));
    const api = new LiveDecoApi({ host: "h", username: "admin", password: "p", client: fake.client });
    const snap = await api.fetchSnapshot();
    expect(snap.wifi).toBeNull();
    expect(snap.clients).toHaveLength(28);
  });

  it("erro de login numa leitura opcional não é engolido", async () => {
    const fake = fakeClient((req) =>
      req.form === "internet" ? new DecoLoginError("Wrong username or password", 8) : undefined,
    );
    const api = new LiveDecoApi({ host: "h", username: "admin", password: "p", client: fake.client });
    await expect(api.fetchSnapshot()).rejects.toBeInstanceOf(DecoLoginError);
    expect(fake.logouts()).toBe(1);
  });
});
