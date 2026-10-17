// Vendored from https://github.com/fullo/deco-mcp @ 94b0463 (MIT, (c) Francesco Fullone). See THIRD_PARTY_NOTICES.md.
/** Errors the Deco client raises, so callers can react to auth loss vs. real failures. */

export class DecoError extends Error {
  constructor(message?: string) {
    super(message);
    // Set the concrete class name so logs and stack traces read "DecoApiError:"
    // rather than the inherited "Error:". `this.constructor` is the subclass.
    this.name = this.constructor.name;
  }
}

/** Credentials rejected. `attemptsAllowed` is what the firmware reports as remaining. */
export class DecoLoginError extends DecoError {
  constructor(message: string, readonly attemptsAllowed?: number | string) {
    super(message);
  }
}

/**
 * The session went stale — empty payload, 401 or 403. Recoverable by logging in
 * again, which the client does once before giving up.
 *
 * `clean` distinguishes the two ways this is raised, which matters for mutating
 * requests. A 401/403 is a *clean* rejection: the firmware refused the request
 * before applying it, so re-issuing it after a fresh login is safe. An empty
 * payload is *ambiguous*: the write may already have been applied server-side
 * and only the response was lost, so a mutating request must NOT be retried.
 */
export class DecoAuthExpiredError extends DecoError {
  constructor(message: string, readonly clean = false) {
    super(message);
  }
}

/** The firmware answered with a non-zero error_code. */
export class DecoApiError extends DecoError {
  constructor(message: string, readonly errorCode: number | string) {
    super(message);
  }
}

/** A tool tried a mutating call while the server is in read-only mode. */
export class DecoWriteBlockedError extends DecoError {}

export class DecoTimeoutError extends DecoError {}
