import { afterEach, describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/core/breaker.js";
import { DecoGateway } from "../src/core/gateway.js";
import { Poller } from "../src/core/poller.js";
import { DecoLoginError } from "../src/deco-client/errors.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { Store } from "../src/db/store.js";
import { silentLogger } from "../src/log.js";

function setup(opts: { now?: () => Date } = {}) {
  let t = new Date("2026-10-17T12:00:00Z").getTime();
  const now = opts.now ?? (() => new Date(t));
  const advance = (ms: number) => (t += ms);
  const store = new Store(":memory:");
  const api = new MockDecoApi({ now });
  const breaker = new CircuitBreaker({ now: () => now().getTime() });
  const gateway = new DecoGateway(api, breaker);
  const poller = new Poller({ gateway, store, intervalMs: 60_000, logger: silentLogger, now });
  return { store, api, breaker, gateway, poller, advance };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});

describe("Poller + Store", () => {
  it("atualiza cache, persiste e emite snapshot com o anterior", async () => {
    const { store, poller, advance } = setup();
    cleanup.push(() => store.close());
    const seen: [number, number | null][] = [];
    poller.on("snapshot", (next, prev) => seen.push([next.clients.length, prev?.clients.length ?? null]));

    await poller.pollNow();
    advance(60_000);
    await poller.pollNow();

    expect(seen).toEqual([[28, null], [28, 28]]);
    expect(poller.cache.snapshot?.clients).toHaveLength(28);
    expect(poller.cache.lastError).toBeNull();
    expect(store.samples("2000-01-01")).toHaveLength(2);
    expect(store.latestSnapshot()?.takenAt).toBe(poller.cache.fetchedAt);
  });

  it("pollNow concorrente reaproveita o poll em andamento", async () => {
    const { store, api, poller } = setup();
    cleanup.push(() => store.close());
    await Promise.all([poller.pollNow(), poller.pollNow(), poller.pollNow()]);
    expect(api.calls).toBe(1);
  });

  it("registra first/last seen de clientes", async () => {
    const { store, api, poller, advance } = setup();
    cleanup.push(() => store.close());
    await poller.pollNow();
    const mac = api.raw.clientList && (api.raw.clientList as any).client_list[0].mac;

    advance(60_000);
    api.mutate((raw) => {
      (raw.clientList as any).client_list = (raw.clientList as any).client_list.slice(1);
    });
    await poller.pollNow();

    const seen = store.clientSeen().get(mac)!;
    expect(seen.firstSeen).toBe("2026-10-17T12:00:00.000Z");
    expect(seen.lastSeen).toBe("2026-10-17T12:00:00.000Z");
    const other = [...store.clientSeen().values()].find((c) => c.mac !== mac)!;
    expect(other.lastSeen).toBe("2026-10-17T12:01:00.000Z");
  });

  it("calcula 'online desde' dos nós e zera quando caem", async () => {
    const { store, api, poller, advance } = setup();
    cleanup.push(() => store.close());
    await poller.pollNow();
    const nodes = (api.raw.deviceList as any).device_list;
    const mac = nodes[0].mac;
    expect(store.nodeSeen().get(mac)?.onlineSince).toBe("2026-10-17T12:00:00.000Z");

    advance(60_000);
    api.mutate((raw) => {
      (raw.deviceList as any).device_list = nodes.slice(1);
    });
    await poller.pollNow();
    expect(store.nodeSeen().get(mac)?.onlineSince).toBeNull();

    advance(60_000);
    api.mutate((raw) => {
      (raw.deviceList as any).device_list = nodes;
    });
    await poller.pollNow();
    expect(store.nodeSeen().get(mac)?.onlineSince).toBe("2026-10-17T12:02:00.000Z");
  });

  it("em falha mantém o último snapshot e pula polls com breaker aberto", async () => {
    const { store, api, poller, advance } = setup();
    cleanup.push(() => store.close());
    await poller.pollNow();
    api.failNext(new DecoLoginError("Wrong username or password", 9));

    advance(60_000);
    await poller.pollNow();
    expect(poller.cache.snapshot?.clients).toHaveLength(28);
    expect(poller.cache.lastError?.message).toMatch(/Wrong/);
    expect(poller.cache.breaker).toBe("open");

    advance(30_000);
    await poller.pollNow(); // dentro do backoff: não toca no Deco
    expect(api.calls).toBe(2);
  });

  it("carrega o último snapshot do SQLite ao iniciar", async () => {
    const first = setup();
    await first.poller.pollNow();
    const again = new Poller({
      gateway: first.gateway,
      store: first.store,
      intervalMs: 60_000,
      logger: silentLogger,
    });
    expect(again.cache.snapshot?.clients).toHaveLength(28);
    first.store.close();
  });

  it("aplica migrações de forma idempotente e poda amostras antigas", async () => {
    const { store, poller, advance } = setup();
    cleanup.push(() => store.close());
    await poller.pollNow();
    advance(60_000);
    await poller.pollNow();
    expect(store.db.pragma("user_version", { simple: true })).toBe(1);
    expect(store.pruneSamples("2026-10-17T12:00:30Z")).toBe(1);
    expect(store.samples("2000-01-01")).toHaveLength(1);
  });
});
