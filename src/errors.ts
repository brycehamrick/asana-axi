import { AxiError } from "axi-sdk-js";
import { MissingTokenError } from "./config.js";

/**
 * Map Asana REST failures (and local precondition failures) to typed
 * AxiErrors with next-step suggestions, per AXI principle 6.
 *
 * VALIDATION_ERROR maps to exit code 2 (SDK-owned rule); everything else
 * exits 1. All messages are single-line and scrubbed by the caller.
 */

const PAT_URL = "https://app.asana.com/0/my-apps";

export function tokenMissingError(): AxiError {
  return new AxiError(
    "ASANA_ACCESS_TOKEN is not set - asana-axi needs a personal access token",
    "AUTH_REQUIRED",
    [
      `Create a token at ${PAT_URL} and export ASANA_ACCESS_TOKEN=<token>`,
      "Or put ASANA_ACCESS_TOKEN=<token> in a ./.env file",
      "Run `asana-axi me` after setting it to verify auth",
    ],
  );
}

export function networkError(detail: string): AxiError {
  return new AxiError(
    `Could not reach the Asana API: ${detail}`,
    "NETWORK_ERROR",
    ["Check network connectivity and re-run the command"],
  );
}

export function rateLimitedError(afterSeconds: number): AxiError {
  return new AxiError(
    `Asana API rate limit exceeded - retry after ${afterSeconds}s`,
    "RATE_LIMITED",
    [`Wait ${Math.ceil(afterSeconds)}s and re-run the command`],
  );
}

/** Map an HTTP status + Asana error payload to an AxiError. */
export function mapAsanaHttpError(
  status: number,
  messages: string[],
  path: string,
): AxiError {
  const first = messages[0] ?? `HTTP ${status} on ${path}`;
  const message = first.length > 300 ? `${first.slice(0, 300)}...` : first;

  if (status === 401) {
    return new AxiError(`Unauthorized: ${message}`, "AUTH_REQUIRED", [
      `Regenerate the personal access token at ${PAT_URL}`,
      "Update ASANA_ACCESS_TOKEN (environment or ./.env) and re-run",
    ]);
  }
  if (status === 403) {
    return new AxiError(`Forbidden: ${message}`, "FORBIDDEN", [
      "The token's account may not have access to this workspace/project",
      "Run `asana-axi me` to see which workspaces the token can reach",
    ]);
  }
  if (status === 404 || status === 410) {
    return new AxiError(`Not found: ${message}`, "NOT_FOUND", [
      "Check the GID - find the right one with `asana-axi task search`, `project list`, or `workspace list`",
    ]);
  }
  if (status === 400 || status === 422) {
    return new AxiError(`Invalid request: ${message}`, "VALIDATION_ERROR", [
      "Fix the flagged field and re-run",
      "Run `asana-axi <command> --help` for the accepted flags",
    ]);
  }
  if (status === 429) {
    return rateLimitedError(1);
  }
  if (status >= 500) {
    return new AxiError(`Asana server error (HTTP ${status}): ${message}`, "SERVER_ERROR", [
      "Re-run the command - transient Asana outages usually clear",
    ]);
  }
  return new AxiError(`Asana API error (HTTP ${status}): ${message}`, "API_ERROR", [
    "Re-run the command or run `asana-axi <command> --help`",
  ]);
}

/** Normalize any thrown value into an AxiError (wraps unknown errors). */
export function toAxiError(error: unknown): AxiError {
  if (error instanceof MissingTokenError) return tokenMissingError();
  if (error instanceof AxiError) return error;
  if (error instanceof Error) {
    return new AxiError(error.message, "UNKNOWN");
  }
  return new AxiError(String(error), "UNKNOWN");
}
