// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/**
 * Client for the TP-Link Deco local API (tested against Deco M9 Plus).
 *
 * Flow: fetch the password key (`form=keys`) and the sign key + seq
 * (`form=auth`) in the clear, then log in with an encrypted envelope to get a
 * `stok` path token and a `sysauth` cookie. Every later call carries both.
 */
import {
  aesDecrypt,
  aesEncrypt,
  publicKeyFromHex,
  buildSignText,
  randomAesDigits,
  rsaEncrypt,
  sessionHash,
} from "./crypto.js";
import { post } from "./http.js";
import { isMutatingOperation } from "./catalog.js";
import {
  DecoApiError,
  DecoAuthExpiredError,
  DecoError,
  DecoLoginError,
  DecoTimeoutError,
} from "./errors.js";
import type { KeyObject } from "node:crypto";

export interface DecoClientOptions {
  host: string;
  username: string;
  password: string;
  timeoutMs?: number;
  rejectUnauthorized?: boolean;
  /** Retries for transient network failures. Mesh roaming causes these. */
  timeoutRetries?: number;
}

/** A single call: which controller, which form, and the JSON payload. */
export interface DecoRequest {
  /** Path under the stok token, e.g. `admin/client` or `admin/device`. */
  endpoint: string;
  /** The `?form=` query value, e.g. `client_list`. */
  form: string;
  operation: string;
  params?: Record<string, unknown>;
}

interface Session {
  aesKey: string;
  aesIv: string;
  aesKeyBytes: Buffer;
  aesIvBytes: Buffer;
  passwordKey: KeyObject;
  signKey: KeyObject;
  seq: number;
  stok: string;
  cookie: string;
}

export class DecoClient {
  private session: Session | null = null;
  private loginInFlight: Promise<void> | null = null;
  /**
   * Serialises every dispatch. The firmware holds one session at a time and the
   * retry paths null out `this.session` mid-flight, so two concurrent calls
   * sharing one session corrupt each other. This promise chain is the mutex:
   * each acquirer waits on the previous one settling before it runs.
   */
  private mutex: Promise<unknown> = Promise.resolve();
  private baseUrl: string;
  private readonly timeoutMs: number;
  private readonly rejectUnauthorized: boolean;
  private readonly timeoutRetries: number;

  constructor(private readonly opts: DecoClientOptions) {
    this.baseUrl = normalizeHost(opts.host);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.rejectUnauthorized = opts.rejectUnauthorized ?? false;
    this.timeoutRetries = opts.timeoutRetries ?? 2;
  }

  get host(): string {
    return this.baseUrl;
  }

  /** True once a session token is held. Does not prove the token is still valid. */
  get isAuthenticated(): boolean {
    return this.session !== null;
  }

  /**
   * Run an authenticated call, logging in on demand. Serialised against every
   * other call and transaction on this client. A stale session is retried
   * exactly once with fresh credentials before the error propagates.
   */
  async call<T = unknown>(request: DecoRequest): Promise<T> {
    return this.lock(() => this.dispatchWithRetry<T>(request));
  }

  /**
   * Run a sequence of dispatches atomically with respect to other callers: the
   * mutex is acquired once for the whole block. `fn` receives a `run` that
   * dispatches WITHOUT re-acquiring the lock — calling the public `call()` from
   * inside would deadlock. Use this for composites like getlist→remove→add that
   * must not interleave with another operation touching the same session.
   */
  async transaction<T>(
    fn: (run: <R = unknown>(request: DecoRequest) => Promise<R>) => Promise<T>,
  ): Promise<T> {
    return this.lock(() => fn((request) => this.dispatchWithRetry(request)));
  }

  /** Serialise `fn` behind every earlier acquirer of the mutex. */
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn);
    // Keep the chain alive whatever the outcome, without leaking a rejection
    // into the next waiter.
    this.mutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * The retry loop, run while already holding the mutex. Reads are retried on a
   * stale session and on transient network failures. Mutating operations are
   * treated conservatively: a write whose response was lost may already have
   * been applied server-side, so it is retried ONLY on a clean 401/403 auth
   * rejection (which proves the firmware refused it before applying), never on
   * an ambiguous empty payload and never on a transient failure.
   */
  private async dispatchWithRetry<T = unknown>(request: DecoRequest): Promise<T> {
    const mutating = isMutatingOperation(request.operation);
    let staleRetried = false;
    let timeoutsSeen = 0;

    for (;;) {
      try {
        await this.ensureLogin();
        return await this.dispatch<T>(request);
      } catch (err) {
        // A stale session is worth exactly one fresh login — but for a mutating
        // request only when the rejection was clean (op provably not applied).
        if (
          err instanceof DecoAuthExpiredError &&
          !staleRetried &&
          (!mutating || err.clean)
        ) {
          staleRetried = true;
          this.session = null;
          continue;
        }
        // Timeouts and dropped connections are routine on a mesh: the client
        // roams between nodes mid-request. Safe to retry a read; a mutating
        // request must not be re-sent, since it may already have landed.
        if (!mutating && isTransient(err) && timeoutsSeen < this.timeoutRetries) {
          timeoutsSeen += 1;
          this.session = null;
          await delay(500 * timeoutsSeen);
          continue;
        }
        throw err;
      }
    }
  }

  /** Drop the local session. The firmware keeps its own until it times out. */
  async logout(): Promise<void> {
    if (!this.session) return;
    try {
      await this.dispatch({
        endpoint: "admin/system",
        form: "logout",
        operation: "logout",
      });
    } catch {
      // A failed logout still means the local session is gone.
    } finally {
      this.session = null;
    }
  }

  // --- session handling -------------------------------------------------

  private async ensureLogin(): Promise<void> {
    if (this.session) return;
    // Collapse concurrent callers onto one handshake.
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<void> {
    const aesKey = randomAesDigits();
    const aesIv = randomAesDigits();
    const passwordKey = await this.fetchPasswordKey();
    const { signKey, seq } = await this.fetchSignKey();

    // The session is assembled first so the envelope helpers can use it; stok
    // and cookie are filled in from the login response below.
    const pending: Session = {
      aesKey,
      aesIv,
      aesKeyBytes: Buffer.from(aesKey, "utf8"),
      aesIvBytes: Buffer.from(aesIv, "utf8"),
      passwordKey,
      signKey,
      seq,
      stok: "",
      cookie: "",
    };

    const encryptedPassword = rsaEncrypt(
      passwordKey,
      Buffer.from(this.opts.password, "utf8"),
    );
    const body = this.encodeEnvelope(pending, {
      operation: "login",
      params: { password: encryptedPassword },
    });

    const res = await post(`${this.baseUrl}/cgi-bin/luci/;stok=/login?form=login`, body, {
      timeoutMs: this.timeoutMs,
      rejectUnauthorized: this.rejectUnauthorized,
    });
    this.pinSchemeFrom(res.finalUrl);

    if (res.status === 403) {
      throw new DecoLoginError(
        "Login refused (HTTP 403). The Deco allows one admin session at a time — " +
          "log out of the Deco app or the web UI, or use a dedicated manager account.",
      );
    }

    const outer = parseJson(res.body, "login response");
    const payload = decodeEnvelope(pending, outer.data);
    const errorCode = Number(payload.error_code ?? 0);
    if (errorCode !== 0) {
      if (errorCode === -5002) {
        const attempts = (payload.result as Record<string, unknown> | undefined)
          ?.attemptsAllowed;
        throw new DecoLoginError(
          `Wrong username or password (error_code ${errorCode}).`,
          attempts as number | string | undefined,
        );
      }
      throw new DecoApiError(`Login failed with error_code ${errorCode}`, errorCode);
    }

    const stok = (payload.result as Record<string, unknown> | undefined)?.stok;
    if (typeof stok !== "string" || !stok) {
      throw new DecoError("Login succeeded but no stok token was returned");
    }
    const cookie = extractSysauth(res.setCookie);
    if (!cookie) {
      throw new DecoError("Login succeeded but no sysauth cookie was returned");
    }

    pending.stok = stok;
    pending.cookie = cookie;
    this.session = pending;
  }

  private async fetchPasswordKey(): Promise<KeyObject> {
    const json = await this.plainCall("keys");
    const keys = (json.result as Record<string, unknown> | undefined)?.password;
    if (!Array.isArray(keys) || keys.length < 2) {
      throw new DecoError("Unexpected response from ?form=keys");
    }
    return publicKeyFromHex(String(keys[0]), String(keys[1]));
  }

  private async fetchSignKey(): Promise<{ signKey: KeyObject; seq: number }> {
    const json = await this.plainCall("auth");
    const result = json.result as Record<string, unknown> | undefined;
    const key = result?.key;
    if (!Array.isArray(key) || key.length < 2 || typeof result?.seq !== "number") {
      throw new DecoError("Unexpected response from ?form=auth");
    }
    return {
      signKey: publicKeyFromHex(String(key[0]), String(key[1])),
      seq: result.seq,
    };
  }

  /** The two handshake endpoints take plain JSON and need no session. */
  private async plainCall(form: string): Promise<Record<string, unknown>> {
    const res = await post(
      `${this.baseUrl}/cgi-bin/luci/;stok=/login?form=${form}`,
      JSON.stringify({ operation: "read" }),
      { timeoutMs: this.timeoutMs, rejectUnauthorized: this.rejectUnauthorized },
    );
    this.pinSchemeFrom(res.finalUrl);
    return parseJson(res.body, `?form=${form} response`);
  }

  // --- request envelope -------------------------------------------------

  private async dispatch<T>(request: DecoRequest): Promise<T> {
    const session = this.session;
    // Nothing was sent, so re-establishing a session and retrying is safe.
    if (!session) throw new DecoAuthExpiredError("No active session", true);

    const body = this.encodeEnvelope(session, {
      operation: request.operation,
      ...(request.params ? { params: request.params } : {}),
    });
    const url =
      `${this.baseUrl}/cgi-bin/luci/;stok=${session.stok}/` +
      `${request.endpoint}?form=${encodeURIComponent(request.form)}`;

    const res = await post(url, body, {
      timeoutMs: this.timeoutMs,
      rejectUnauthorized: this.rejectUnauthorized,
      headers: { Cookie: session.cookie },
    });
    this.pinSchemeFrom(res.finalUrl);

    if (res.status === 401 || res.status === 403) {
      // A clean auth rejection: the firmware refused before applying anything,
      // so even a mutating request is safe to retry after a fresh login.
      throw new DecoAuthExpiredError(`Session rejected with HTTP ${res.status}`, true);
    }

    const refreshed = extractSysauth(res.setCookie);
    if (refreshed) session.cookie = refreshed;

    const outer = parseOuterBody(res.body, `${request.endpoint}?form=${request.form}`);
    // An empty data field is how the firmware signals an expired session.
    if (!outer.data) {
      const outerCode = outer.error_code;
      if (outerCode !== undefined && Number(outerCode) !== 0) {
        throw new DecoApiError(
          `${request.endpoint}?form=${request.form} returned error_code ${outerCode}`,
          outerCode as number,
        );
      }
      throw new DecoAuthExpiredError(
        `${request.endpoint}?form=${request.form} returned an empty payload`,
      );
    }

    const payload = decodeEnvelope(session, outer.data);
    const code = payload.error_code ?? payload.errorcode;
    if (code !== undefined && Number(code) !== 0) {
      throw new DecoApiError(
        `${request.endpoint}?form=${request.form} returned error_code ${code}`,
        code as number,
      );
    }
    return (payload.result ?? payload) as T;
  }

  /**
   * Build the wire body: AES-encrypted JSON in `data`, and a `sign` blob that
   * binds the AES key, the credential hash and `seq + len(data)`.
   */
  private encodeEnvelope(session: Session, payload: Record<string, unknown>): string {
    const data = aesEncrypt(
      session.aesKeyBytes,
      session.aesIvBytes,
      Buffer.from(JSON.stringify(payload), "utf8"),
    );
    const hash = sessionHash(this.opts.username, this.opts.password);
    // Length is measured on the raw base64, before URL encoding.
    const signText = buildSignText(
      session.aesKey,
      session.aesIv,
      hash,
      session.seq,
      data.length,
    );
    const sign = rsaEncrypt(session.signKey, Buffer.from(signText, "utf8"));
    return `sign=${sign}&data=${encodeURIComponent(data)}`;
  }

  /**
   * Some firmwares 307-redirect every http:// call to https://. Once we have
   * followed one, keep using the scheme that worked.
   */
  private pinSchemeFrom(finalUrl: string): void {
    try {
      const scheme = new URL(finalUrl).protocol;
      if (scheme === "https:" && this.baseUrl.startsWith("http://")) {
        this.baseUrl = `https://${this.baseUrl.slice("http://".length)}`;
      }
    } catch {
      // A malformed final URL is not worth failing the request over.
    }
  }
}

function decodeEnvelope(session: Session, data: unknown): Record<string, unknown> {
  if (typeof data !== "string" || !data) {
    throw new DecoAuthExpiredError("Response payload was empty");
  }
  const plain = aesDecrypt(session.aesKeyBytes, session.aesIvBytes, data);
  const trimmed = plain.trim();
  // Some forms answer with a bare human-readable message rather than JSON,
  // e.g. "No root node was registered". Surface it as-is; a JSON parse error
  // would hide what the firmware actually said.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new DecoError(`Firmware replied: ${trimmed.slice(0, 200)}`);
  }
  return parseJson(trimmed, "decrypted payload");
}

/**
 * Read the outer response.
 *
 * Most forms answer with `{"error_code":0,"data":"<base64>"}`, but a few
 * (admin/dhcp, admin/smart_network) hand back the encrypted payload as the
 * whole body with no JSON wrapper. Treat that as the data field.
 */
/** Network hiccups worth retrying, as opposed to the router refusing us. */
export function isTransient(err: unknown): boolean {
  if (err instanceof DecoTimeoutError) return true;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseOuterBody(text: string, context: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseJson(trimmed, context);
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0) {
    return { data: trimmed };
  }
  return parseJson(trimmed, context);
}

function parseJson(text: string, context: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const preview = text.slice(0, 200);
    throw new DecoError(`Could not parse ${context} as JSON: ${preview}`);
  }
}

export function extractSysauth(setCookie: string[]): string | null {
  for (const header of setCookie) {
    const match = /(sysauth=[A-Za-z0-9]+)/.exec(header);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function normalizeHost(host: string): string {
  const withScheme = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, "");
}
