import { AxiError } from "axi-sdk-js";

/**
 * Strict flag parsing: unknown flags fail loud with exit code 2
 * (VALIDATION_ERROR), per AXI principle 6. Supports `--flag value`,
 * `--flag=value`, and boolean flags. Flags always come after the
 * subcommand (the SDK already rejects flags before the top-level command).
 */

export type FlagKind = "value" | "boolean";

export interface FlagSpec {
  [flag: string]: FlagKind;
}

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseFlags(
  args: string[],
  spec: FlagSpec,
  context: string,
): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const normalized: Record<string, string> = {};
  for (const [flag, kind] of Object.entries(spec)) {
    normalized[flag.toLowerCase()] = kind === "boolean" ? "boolean" : "value";
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const bare =
        eq === -1 ? arg.toLowerCase() : arg.slice(0, eq).toLowerCase();
      const kind = normalized[bare];
      if (kind === undefined) {
        throw unknownFlagError(bare, spec, context);
      }
      if (kind === "boolean") {
        if (eq !== -1) {
          const value = arg.slice(eq + 1).toLowerCase();
          if (value !== "true" && value !== "false") {
            throw new AxiError(
              `Flag ${bare} is boolean - ${JSON.stringify(arg.slice(eq + 1))} is not true/false`,
              "VALIDATION_ERROR",
              [`Run \`asana-axi ${context} --help\` for the accepted flags`],
            );
          }
          flags[bare] = value === "true";
        } else {
          flags[bare] = true;
        }
      } else {
        let value: string | undefined;
        if (eq !== -1) {
          value = arg.slice(eq + 1);
        } else {
          i += 1;
          value = args[i];
        }
        if (value === undefined) {
          throw new AxiError(
            `Flag ${bare} requires a value`,
            "VALIDATION_ERROR",
            [`Example: ${bare} <value>`],
          );
        }
        // An explicit empty string is a meaningful value (e.g. --assignee ""
        // unassigns); only a missing argument is an error.
        flags[bare] = value;
      }
    } else {
      positionals.push(arg);
    }
    i += 1;
  }

  return { flags, positionals };
}

function unknownFlagError(
  flag: string,
  spec: FlagSpec,
  context: string,
): AxiError {
  const known = Object.keys(spec)
    .map((f) => `${f}${spec[f] === "boolean" ? "" : " <value>"}`)
    .join(", ");
  return new AxiError(
    `Unknown flag: ${flag}`,
    "VALIDATION_ERROR",
    [
      `Known flags: ${known === "" ? "(none)" : known}`,
      `Run \`asana-axi ${context} --help\` for usage`,
    ],
  );
}

/** Read a value flag or undefined - never the string "undefined". */
export function flagValue(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (typeof value !== "string") return undefined;
  return value;
}

export function flagBoolean(
  flags: Record<string, string | boolean>,
  name: string,
): boolean {
  return flags[name] === true;
}

/** Parse a --limit flag: integer, 1..500, with a helpful default. */
export function parseLimit(
  flags: Record<string, string | boolean>,
  fallback: number,
): number {
  const raw = flagValue(flags, "--limit");
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new AxiError(
      `Invalid --limit ${JSON.stringify(raw)} - expected an integer 1..500`,
      "VALIDATION_ERROR",
      ["Example: --limit 50"],
    );
  }
  return parsed;
}

/** Split a comma-separated list flag into trimmed, non-empty parts. */
export function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Require exactly one positional argument (a GID-shaped one for us) and
 * reject extras - a stray second token is almost always a mistake.
 */
export function requireGid(
  positionals: string[],
  context: string,
): string {
  if (positionals.length === 0) {
    throw new AxiError(
      `Missing <gid> argument`,
      "VALIDATION_ERROR",
      [`Run \`asana-axi ${context} <gid>\``],
    );
  }
  const gid = positionals[0];
  if (positionals.length > 1) {
    throw new AxiError(
      `This command takes a single <gid>: asana-axi ${context} <gid>`,
      "VALIDATION_ERROR",
      [`Run \`asana-axi ${context} --help\` for usage`],
    );
  }
  return gid as string;
}

export function rejectPositionals(positionals: string[], context: string): void {
  if (positionals.length > 0) {
    throw new AxiError(
      `Unexpected argument: ${JSON.stringify(positionals[0])}`,
      "VALIDATION_ERROR",
      [`Run \`asana-axi ${context} --help\` for usage`],
    );
  }
}

export function unknownSubcommandError(
  resource: string,
  sub: string,
  known: string[],
  helpCommand: string,
): AxiError {
  const suggestion = closest(sub, known);
  return new AxiError(
    `Unknown ${resource} subcommand: ${sub}`,
    "VALIDATION_ERROR",
    [
      ...(suggestion ? [`Did you mean \`${suggestion}\`?`] : []),
      `Known subcommands: ${known.join(", ")}`,
      `Run \`asana-axi ${helpCommand} --help\``,
    ],
  );
}

/** Tiny Levenshtein "did you mean" - same job the SDK does for top-level commands. */
export function closest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(
      input.toLowerCase(),
      candidate.toLowerCase(),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // Only suggest when reasonably close (within half the length).
  if (best === undefined || bestDistance > Math.ceil(best.length / 2)) {
    return undefined;
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1, // insertion
        (previous[j] as number) + 1, // deletion
        (previous[j - 1] as number) + cost, // substitution
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}
