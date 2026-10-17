// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/**
 * Crypto envelope for the TP-Link Deco local API.
 *
 * Every authenticated request is an AES-128-CBC encrypted JSON body, signed
 * with an RSA PKCS#1 v1.5 blob that carries the AES key/iv, a session hash and
 * a sequence number bound to the payload length. Two distinct RSA keys are in
 * play: a 1024-bit key that encrypts the password at login, and a 512-bit key
 * that signs every request.
 *
 * TP-Link splits RSA plaintext into (modulusBytes - 11) blocks and concatenates
 * the hex of each encrypted block, which is not what a normal RSA library does.
 */
import crypto from "node:crypto";

/** PKCS#1 v1.5 padding overhead, in bytes. */
const PKCS1_HEADER_BYTES = 11;

/** The firmware requires AES key and iv to be 16 ASCII digits with no leading zero. */
const AES_DIGITS = 16;

/** Strip leading zero bytes: JWK requires a minimal big-endian integer encoding. */
function normalizeHex(hex: string): string {
  const stripped = hex.replace(/^(00)+/, "");
  const even = stripped.length % 2 ? `0${stripped}` : stripped;
  return even.length === 0 ? "00" : even;
}

/** Build a public key from the hex modulus/exponent pair the router hands out. */
export function publicKeyFromHex(nHex: string, eHex: string): crypto.KeyObject {
  const toB64Url = (hex: string) =>
    Buffer.from(normalizeHex(hex), "hex").toString("base64url");
  return crypto.createPublicKey({
    key: { kty: "RSA", n: toB64Url(nHex), e: toB64Url(eHex) },
    format: "jwk",
  });
}

/**
 * RSA encrypt, TP-Link style: chunk the plaintext to the key's block size and
 * concatenate the hex of each encrypted block.
 */
export function rsaEncrypt(key: crypto.KeyObject, plaintext: Buffer): string {
  const modulusBytes = (key.asymmetricKeyDetails?.modulusLength ?? 0) / 8;
  if (!modulusBytes) throw new Error("RSA key has no usable modulus length");

  const chunkSize = modulusBytes - PKCS1_HEADER_BYTES;
  const parts: string[] = [];
  for (let i = 0; i < plaintext.length; i += chunkSize) {
    const block = plaintext.subarray(i, i + chunkSize);
    parts.push(
      crypto
        .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, block)
        .toString("hex"),
    );
  }
  return parts.join("");
}

/** AES-128-CBC encrypt with PKCS#7 padding, returned base64 as the wire format expects. */
export function aesEncrypt(key: Buffer, iv: Buffer, plaintext: Buffer): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
}

/** AES-128-CBC decrypt of a base64 response body. */
export function aesDecrypt(key: Buffer, iv: Buffer, ciphertextB64: string): string {
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  const raw = Buffer.from(ciphertextB64, "base64");
  return Buffer.concat([decipher.update(raw), decipher.final()]).toString("utf8");
}

/** A random 16-digit decimal string, no leading zero — used as both AES key and iv. */
export function randomAesDigits(): string {
  const min = 10n ** BigInt(AES_DIGITS - 1);
  const span = 10n ** BigInt(AES_DIGITS) - min;
  // 8 random bytes give far more entropy than the 10^15 span needs.
  const draw = BigInt(`0x${crypto.randomBytes(8).toString("hex")}`);
  return (min + (draw % span)).toString();
}

/** Session hash folded into every signature. */
export function sessionHash(username: string, password: string): string {
  return crypto.createHash("md5").update(`${username}${password}`).digest("hex");
}

/**
 * Build the plaintext that gets RSA-signed on every request.
 *
 * The `s` field is `seq + dataLen`, where dataLen is the length of the base64
 * `data` string measured BEFORE URL encoding. This binding is the single most
 * error-prone detail of the protocol, so it lives in one pure, tested function.
 */
export function buildSignText(
  aesKey: string,
  aesIv: string,
  hash: string,
  seq: number,
  dataLen: number,
): string {
  return `k=${aesKey}&i=${aesIv}&h=${hash}&s=${seq + dataLen}`;
}
