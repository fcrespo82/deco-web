/**
 * Proteção simples da UI por senha (UI_PASSWORD).
 *
 * Login correto gera um cookie `expiraEm.assinatura` (HMAC-SHA256 com um
 * segredo aleatório guardado no SQLite — não é a senha). Sem UI_PASSWORD a UI
 * fica aberta, o que só faz sentido numa LAN confiável. OIDC fica para depois.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dw_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function newSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

export class SessionSigner {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  issue(ttlMs = SESSION_TTL_MS): string {
    const expires = String(this.now() + ttlMs);
    return `${expires}.${this.sign(expires)}`;
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const [expires, signature] = token.split(".");
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    if (!safeEqual(signature, this.sign(expires))) return false;
    return Number(expires) > this.now();
  }
}

export function checkPassword(given: unknown, expected: string): boolean {
  // Compara HMACs de tamanho fixo para não vazar o tamanho da senha pelo tempo.
  const key = "deco-web-password-check";
  const h = (s: string) => createHmac("sha256", key).update(s).digest("hex");
  return typeof given === "string" && safeEqual(h(given), h(expected));
}

/** Limita tentativas de login erradas por IP numa janela de tempo. */
export class LoginRateLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(ip: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(ip) ?? []).filter((t) => t > cutoff);
    this.failures.set(ip, list);
    return list;
  }

  blocked(ip: string): boolean {
    return this.recent(ip).length >= this.max;
  }

  fail(ip: string): void {
    this.recent(ip).push(this.now());
  }

  succeed(ip: string): void {
    this.failures.delete(ip);
  }
}
