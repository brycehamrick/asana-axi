import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runtime configuration: auth token plus optional default GIDs.
 *
 * Precedence: real environment variables always win over `./.env` values.
 * The token is only ever read - it is never logged, rendered, or written
 * anywhere. `redact()` exists so error paths can scrub accidental leakage
 * (e.g. an HTTP error body echoing request headers).
 */

export interface AsanaConfig {
  /** Personal access token (required for every API call). */
  readonly token: string;
  /** Optional default workspace GID (ASANA_WORKSPACE_ID). */
  readonly workspaceId?: string;
  /** Optional default project GID (ASANA_PROJECT_ID). */
  readonly projectId?: string;
}

export interface ConfigInput {
  env?: NodeJS.ProcessEnv;
  /** Working directory to look for a `.env` file in (default: cwd). */
  cwd?: string;
  /** Injectable file reader for tests. */
  readFile?: (path: string) => string | undefined;
}

/** Parse a minimal `.env` payload: KEY=VALUE lines, `#` comments, optional quotes. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one matching surrounding quote pair.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(input: ConfigInput): Record<string, string> {
  const readFile =
    input.readFile ??
    ((path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    });
  const content = readFile(join(input.cwd ?? process.cwd(), ".env"));
  return content === undefined ? {} : parseDotEnv(content);
}

export class MissingTokenError extends Error {
  constructor() {
    super(
      "ASANA_ACCESS_TOKEN is not set (environment or ./.env)",
    );
    this.name = "MissingTokenError";
  }
}

/** Load config from env, falling back to a `./.env` in the working directory. */
export function loadConfig(input: ConfigInput = {}): AsanaConfig {
  const env = input.env ?? process.env;
  const file = readEnvFile(input);

  const pick = (key: string): string | undefined => {
    const fromEnv = env[key];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    const fromFile = file[key];
    if (fromFile !== undefined && fromFile !== "") return fromFile;
    return undefined;
  };

  const token = pick("ASANA_ACCESS_TOKEN");
  if (!token) {
    throw new MissingTokenError();
  }
  const workspaceId = pick("ASANA_WORKSPACE_ID");
  const projectId = pick("ASANA_PROJECT_ID");

  const config: AsanaConfig = {
    token,
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  };
  return config;
}

/** Replace every occurrence of `secret` with `***` so it never reaches output. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("***");
}
