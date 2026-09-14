import { AsanaClient, type FetchLike } from "./asana.js";
import { loadConfig, MissingTokenError, type AsanaConfig } from "./config.js";
import { tokenMissingError } from "./errors.js";

/**
 * Per-invocation dependencies, threaded from `main()` into every command via
 * the SDK's resolveContext. Keeping deps (instead of a live client) lets
 * token-free commands like `setup hooks` run without any ASANA_ACCESS_TOKEN,
 * while API commands pay config loading exactly once through `openClient()`.
 */

export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetchImpl?: FetchLike;
}

export interface OpenedClient {
  config: AsanaConfig;
  client: AsanaClient;
}

const memo = new WeakMap<CliDeps, OpenedClient>();

/** Load config + construct the API client once per invocation. */
export function openClient(deps: CliDeps): OpenedClient {
  const cached = memo.get(deps);
  if (cached) return cached;
  let config: AsanaConfig;
  try {
    config = loadConfig({ env: deps.env, cwd: deps.cwd });
  } catch (error) {
    // Surface the missing-token case as a typed AUTH_REQUIRED AxiError so
    // every command reports it uniformly.
    if (error instanceof MissingTokenError) {
      throw tokenMissingError();
    }
    throw error;
  }
  const client = new AsanaClient({
    token: config.token,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const opened: OpenedClient = { config, client };
  memo.set(deps, opened);
  return opened;
}
