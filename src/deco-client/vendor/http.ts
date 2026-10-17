// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/**
 * Minimal HTTP(S) POST helper built on node:https.
 *
 * Written by hand rather than using fetch because the Deco needs three things
 * fetch makes awkward: accepting the router's self-signed certificate without
 * disabling TLS checks process-wide, reading every Set-Cookie header, and
 * following the firmware's http->https redirect while keeping the cookie.
 */
import http from "node:http";
import https from "node:https";
import { DecoTimeoutError } from "./errors.js";

export interface PostOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  rejectUnauthorized: boolean;
  maxRedirects?: number;
}

export interface PostResult {
  status: number;
  setCookie: string[];
  body: string;
  /** Final URL after redirects, so the caller can pin the working scheme. */
  finalUrl: string;
}

export async function post(
  url: string,
  body: string,
  opts: PostOptions,
): Promise<PostResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = url;

  for (let hop = 0; ; hop++) {
    const result = await postOnce(current, body, opts);
    const location = result.redirectTo;
    if (!location || hop >= maxRedirects) {
      return {
        status: result.status,
        setCookie: result.setCookie,
        body: result.body,
        finalUrl: current,
      };
    }
    current = new URL(location, current).toString();
  }
}

interface RawResult {
  status: number;
  setCookie: string[];
  body: string;
  redirectTo?: string;
}

function postOnce(url: string, body: string, opts: PostOptions): Promise<RawResult> {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body).toString(),
          ...opts.headers,
        },
        // The Deco ships a self-signed certificate; scoped to this request only.
        ...(target.protocol === "https:"
          ? { rejectUnauthorized: opts.rejectUnauthorized }
          : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          resolve({
            status,
            setCookie: res.headers["set-cookie"] ?? [],
            body: Buffer.concat(chunks).toString("utf8"),
            redirectTo:
              status >= 300 && status < 400 && location ? location : undefined,
          });
        });
      },
    );

    req.setTimeout(opts.timeoutMs, () => {
      req.destroy(new DecoTimeoutError(`Request to ${target.host} timed out`));
    });
    req.on("error", reject);
    req.end(body);
  });
}
