// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/**
 * Shaping firmware responses into something an agent can reason about:
 * decoding the base64 names, and keeping Wi-Fi passphrases out of the
 * transcript unless the operator has explicitly asked for them.
 */

/** Older firmware wrapped names it could not decode as `<Error Decoding foo>`. */
const LEGACY_DECODE_ERROR = /^<Error Decoding (.*)>$/;

/** Control characters mean we decoded bytes that were never text. */
function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

/**
 * Canonicalise a MAC to the form the firmware stores: uppercase, dash-separated.
 * The input validation accepts both `:` and `-` separators, but the firmware
 * keeps reservations as `A4-50-46-4A-29-0B`, so a MAC typed with colons would
 * otherwise fail to match an existing entry (a false negative) and be written in
 * a shape the firmware does not expect. Only the separator and case are touched;
 * this does not validate the MAC (the zod schema already did).
 */
export function canonicalMac(s: string): string {
  return s.toUpperCase().replace(/:/g, "-");
}

/**
 * Client and node names come back base64 encoded. Some firmwares send them in
 * the clear, so fall back to the raw value rather than mangling it.
 */
export function decodeName(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return value;

  const unwrap = (s: string) => {
    const match = LEGACY_DECODE_ERROR.exec(s);
    return match ? match[1] : s;
  };

  try {
    const decoded = Buffer.from(value, "base64");
    // Round-trip check: only trust the decode if it re-encodes to the original,
    // otherwise this was never base64 to begin with.
    if (decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      return unwrap(value);
    }
    const text = decoded.toString("utf8");
    // A valid base64 name re-encodes cleanly AND decodes to real text. Bytes
    // that are not valid UTF-8 produce the U+FFFD replacement character; a plain
    // name like "network1" is coincidentally valid base64 but decodes to
    // garbage, so reject on control chars or replacement chars and keep the
    // original. Some ambiguity is inherent to base64 and cannot be fully removed.
    if (hasControlChars(text) || text.includes("\uFFFD")) return unwrap(value);
    return unwrap(text);
  } catch {
    return unwrap(value);
  }
}

/**
 * Does a key name a secret whose value must be kept out of an agent's context?
 *
 * Pattern-based rather than an exact denylist: firmware invents many spellings
 * (`wpa_psk`, `sae_password`, `wireless_password`, ...) and an exact list leaks
 * every one it does not enumerate. Broad on purpose — under-redaction leaks a
 * passphrase, while over-redaction only hides a field the agent can live
 * without. SSIDs and other display names contain none of these tokens, so they
 * stay visible.
 */
function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    /pass|pwd|psk|pmk|passphrase|secret|sae/.test(k) ||
    /(^|_)keys?(_|$)/.test(k) ||
    k === "sysauth"
  );
}

/** Keys that hold a base64 display name. */
const NAME_KEYS = new Set(["name", "custom_nickname", "nickname", "ssid", "client_name"]);

/**
 * Walk a decoded payload: decode names, and redact secrets unless allowed.
 * SSIDs are names, not secrets, so they survive redaction.
 */
export function normalize(value: unknown, revealSecrets: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item, revealSecrets));
  }
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    // Redact a secret whatever its type - string, object or array. An empty
    // string or null means "not set", so leave it rather than invent a secret.
    const isSet = raw !== "" && raw !== null && raw !== undefined;
    if (!revealSecrets && isSecretKey(key) && isSet) {
      out[key] = "[redacted - set DECO_REVEAL_SECRETS=1 to include]";
      continue;
    }
    if (NAME_KEYS.has(lower)) {
      out[key] = decodeName(raw);
      continue;
    }
    out[key] = normalize(raw, revealSecrets);
  }
  return out;
}

/**
 * Render the client throughput counters, which the firmware reports in KB/s,
 * as the bit rates people actually talk about. 3 KB/s is 24 Kbps.
 */
export function humanRate(kilobytesPerSecond: unknown): string | undefined {
  if (
    typeof kilobytesPerSecond !== "number" ||
    !Number.isFinite(kilobytesPerSecond)
  ) {
    return undefined;
  }
  const units = ["Kbps", "Mbps", "Gbps"];
  let value = kilobytesPerSecond * 8;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}
