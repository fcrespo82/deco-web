import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/core/breaker.js";
import { DecoGateway, CircuitOpenError } from "../src/core/gateway.js";
import { classifyError, DecoLoginError } from "../src/deco-client/errors.js";
import { MockDecoApi } from "../src/deco-client/mock.js";

const auth = (attemptsLeft: number | null = null) => ({ kind: "auth" as const, message: "senha", attemptsLeft });
const other = { kind: "other" as const, message: "timeout", attemptsLeft: null };

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("CircuitBreaker", () => {
  it("abre com backoff exponencial e fecha após o prazo", () => {
    const c = clock();
    const b = new CircuitBreaker({ baseDelayMs: 1000, maxDelayMs: 5000, now: c.now });

    b.recordFailure(other);
    expect(b.permit()).toEqual({ ok: false, status: "open", retryAt: 1000 });
    c.advance(1000);
    expect(b.permit().ok).toBe(true);

    b.recordFailure(other); // 2ª seguida: 2000
    expect(b.state.openUntil).toBe(1000 + 2000);
    c.advance(2000);
    b.recordFailure(other); // 3ª: 4000
    expect(b.state.openUntil).toBe(3000 + 4000);
    c.advance(4000);
    b.recordFailure(other); // 4ª: 8000 limitado a 5000
    expect(b.state.openUntil).toBe(7000 + 5000);
  });

  it("sucesso zera o backoff", () => {
    const c = clock();
    const b = new CircuitBreaker({ baseDelayMs: 1000, now: c.now });
    b.recordFailure(other);
    b.recordFailure(other);
    c.advance(10_000);
    b.recordSuccess();
    expect(b.state.consecutiveFailures).toBe(0);
    b.recordFailure(other);
    expect(b.state.openUntil).toBe(10_000 + 1000);
  });

  it("trava após maxAuthFailures falhas de senha, mesmo depois do prazo", () => {
    const c = clock();
    const b = new CircuitBreaker({ baseDelayMs: 1000, maxAuthFailures: 3, now: c.now });
    b.recordFailure(auth());
    c.advance(1_000_000);
    b.recordFailure(auth());
    c.advance(1_000_000);
    expect(b.status).toBe("closed");
    b.recordFailure(auth());
    c.advance(1_000_000_000);
    expect(b.status).toBe("locked");
    expect(b.permit()).toEqual({ ok: false, status: "locked", retryAt: null });
  });

  it("trava na hora se o firmware disser que restam poucas tentativas", () => {
    const b = new CircuitBreaker({ minAttemptsLeft: 5 });
    b.recordFailure(auth(4));
    expect(b.status).toBe("locked");
  });

  it("falhas de rede ou sessão ocupada não contam para o travamento", () => {
    const c = clock();
    const b = new CircuitBreaker({ maxAuthFailures: 1, now: c.now });
    b.recordFailure(other);
    b.recordFailure({ kind: "busy", message: "403", attemptsLeft: null });
    expect(b.state.authFailures).toBe(0);
    expect(b.status).not.toBe("locked");
  });

  it("reset destrava e o estado persistido é restaurado", () => {
    const saved: unknown[] = [];
    const b = new CircuitBreaker({ maxAuthFailures: 1, onChange: (s) => saved.push(s) });
    b.recordFailure(auth());
    const restored = new CircuitBreaker({ initial: b.state });
    expect(restored.status).toBe("locked");
    restored.reset();
    expect(restored.status).toBe("closed");
    expect(saved).toHaveLength(1);
  });
});

describe("classifyError", () => {
  it("separa senha errada, sessão ocupada e outros", () => {
    expect(classifyError(new DecoLoginError("Wrong username or password", 7))).toMatchObject({
      kind: "auth",
      attemptsLeft: 7,
    });
    expect(classifyError(new DecoLoginError("Login refused (HTTP 403). ..."))).toMatchObject({ kind: "busy" });
    expect(classifyError(new Error("ECONNRESET"))).toMatchObject({ kind: "other" });
  });
});

describe("DecoGateway", () => {
  it("não chama o Deco de novo depois de falha de login enfileirada", async () => {
    const api = new MockDecoApi().failNext(new DecoLoginError("Wrong username or password", 9));
    const gw = new DecoGateway(api, new CircuitBreaker({ baseDelayMs: 60_000 }));

    const results = await Promise.allSettled([gw.fetchSnapshot(), gw.fetchSnapshot(), gw.fetchSnapshot()]);

    expect(api.calls).toBe(1);
    expect(results[0]).toMatchObject({ status: "rejected", reason: expect.any(DecoLoginError) });
    expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(CircuitOpenError) });
    expect(results[2]).toMatchObject({ status: "rejected", reason: expect.any(CircuitOpenError) });
  });

  it("serializa chamadas concorrentes", async () => {
    const api = new MockDecoApi({ latencyMs: 5 });
    let active = 0;
    let peak = 0;
    const original = api.fetchSnapshot.bind(api);
    api.fetchSnapshot = async () => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        return await original();
      } finally {
        active -= 1;
      }
    };
    const gw = new DecoGateway(api, new CircuitBreaker());
    await Promise.all([gw.fetchSnapshot(), gw.fetchSnapshot(), gw.fetchSnapshot()]);
    expect(peak).toBe(1);
    expect(api.calls).toBe(3);
  });

  it("espera a pausa mínima entre sessões consecutivas", async () => {
    let clock = 1_000;
    const sleeps: number[] = [];
    const gw = new DecoGateway(new MockDecoApi(), new CircuitBreaker(), {
      minGapMs: 10_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await gw.fetchSnapshot(); // primeira: sem espera
    clock += 3_000;
    await gw.fetchSnapshot(); // 3 s depois: espera 7 s
    clock += 20_000;
    await gw.fetchSnapshot(); // 20 s depois: sem espera
    expect(sleeps).toEqual([7_000]);
  });
});
