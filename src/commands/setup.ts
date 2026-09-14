import {
  installSessionStartHooks,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import type { AxiStructuredOutput } from "../render.js";
import { AxiError } from "axi-sdk-js";
import { parseFlags, unknownSubcommandError } from "../args.js";

export const SETUP_HELP = `usage: asana-axi setup <subcommand> [flags]
subcommands[2]:
  hooks, status
flags{hooks}:
  --scope <user|project> (default: user)
flags{status}:
  --scope <user|project> (default: user)
examples:
  asana-axi setup hooks
  asana-axi setup hooks --scope project
  asana-axi setup status`;

const SUBCOMMANDS = ["hooks", "status", "uninstall"] as const;

/**
 * Install agent SessionStart ambient context (AXI principle 7) through the
 * SDK's managed hooks: Claude Code, Codex, and OpenCode. No token needed.
 */
export async function setupCommand(
  args: string[],
): Promise<AxiStructuredOutput> {
  const sub = args[0];
  if (!sub || sub === "--help") {
    return { help_text: SETUP_HELP };
  }
  const rest = args.slice(1);

  switch (sub) {
    case "hooks":
    case "uninstall":
    case "status": {
      const { flags } = parseFlags(
        rest,
        { "--scope": "value" },
        `setup ${sub}`,
      );
      const scopeFlag = flags["--scope"];
      if (
        typeof scopeFlag === "string" &&
        scopeFlag !== "user" &&
        scopeFlag !== "project"
      ) {
        throw new AxiError(
          `Invalid --scope ${JSON.stringify(scopeFlag)} - expected user or project`,
          "VALIDATION_ERROR",
          ["Example: asana-axi setup hooks --scope project"],
        );
      }
      const scope = scopeFlag === "project" ? "project" : "user";
      const options = {
        marker: "asana-axi",
        binaryNames: ["asana-axi"],
        scope: scope as "user" | "project",
      };

      if (sub === "hooks") {
        installSessionStartHooks(options);
        return {
          setup: "hooks",
          scope,
          result: "installed or already up to date",
          help: [
            "New agent sessions now start with the asana-axi dashboard as ambient context",
            "Run `asana-axi setup status` to verify",
          ],
        };
      }
      if (sub === "status") {
        const status = sessionStartHookStatus(options);
        return {
          setup: "status",
          scope,
          agents: status,
        };
      }
      uninstallSessionStartHooks(options);
      return {
        setup: "hooks",
        scope,
        result: "removed",
        help: ["Re-run `asana-axi setup hooks` to reinstall"],
      };
    }
    default:
      throw unknownSubcommandError("setup", sub, [...SUBCOMMANDS], "setup");
  }
}
