import { runAxiCli } from "axi-sdk-js";
import { readNearestPackageJson } from "axi-sdk-js";
import { fileURLToPath } from "node:url";
import { closest, type CliDeps } from "./exports.js";
import { homeCommand } from "./commands/home.js";
import { meCommand, ME_HELP } from "./commands/me.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { taskCommand, TASK_HELP } from "./commands/task.js";
import { projectCommand, PROJECT_HELP } from "./commands/project.js";
import { workspaceCommand, WORKSPACE_HELP } from "./commands/workspace.js";
import { tagCommand, TAG_HELP } from "./commands/tag.js";

// The SDK prints this verbatim as the home header on every no-arg invocation
// (the SessionStart hook target), so it stays ONE sentence per the AXI spec.
// Anything longer belongs in TOP_HELP, which an agent only pays for on --help.
export const DESCRIPTION =
  "Agent-ergonomic Asana CLI over the REST API, with token-efficient TOON output and idempotent mutations.";

export const TOP_HELP = `usage: asana-axi [command] [args] [flags]
commands[7]:
  (none)=dashboard, task, project, workspace, tag, me, setup
flags[2]:
  --help, -v/-V/--version
auth[1]:
  ASANA_ACCESS_TOKEN env var or ./.env entry (personal access token)
  ASANA_WORKSPACE_ID and ASANA_PROJECT_ID optionally pin defaults
examples:
  asana-axi
  asana-axi task list --project <gid|name>
  asana-axi task view <gid> --comments
  asana-axi task create --name "Fix login" --project <gid|name> --section Backlog
  asana-axi me
  asana-axi setup hooks`;

const COMMAND_HELP: Record<string, string> = {
  task: TASK_HELP,
  project: PROJECT_HELP,
  workspace: WORKSPACE_HELP,
  tag: TAG_HELP,
  me: ME_HELP,
  setup: SETUP_HELP,
};

export interface MainOptions extends CliDeps {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

function readVersion(): string {
  try {
    const identity = readNearestPackageJson(
      fileURLToPath(import.meta.url),
    );
    return identity.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function main(options: MainOptions = {}): Promise<void> {
  const { argv, stdout, env, cwd, fetchImpl } = options;
  const deps: CliDeps = { ...(env ? { env } : {}), ...(cwd ? { cwd } : {}), ...(fetchImpl ? { fetchImpl } : {}) };

  await runAxiCli({
    description: DESCRIPTION,
    version: readVersion(),
    topLevelHelp: TOP_HELP,
    ...(argv ? { argv } : {}),
    ...(stdout ? { stdout } : {}),
    home: (args) => homeCommand(args, deps),
    commands: {
      task: (args) => taskCommand(args, deps),
      project: (args) => projectCommand(args, deps),
      workspace: (args) => workspaceCommand(args, deps),
      tag: (args) => tagCommand(args, deps),
      me: (args) => meCommand(args, deps),
      setup: (args) => setupCommand(args),
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    renderUnknownCommand,
  });
}

/**
 * SDK hook for unknown top-level commands: same VALIDATION_ERROR/exit-2
 * shape as the SDK default, plus a did-you-mean when the typo is close.
 */
export function renderUnknownCommand(command: string): string {
  const known = [
    "task",
    "project",
    "workspace",
    "tag",
    "me",
    "setup",
    "update",
  ];
  const suggestion = closest(command, known);
  const lines = [`error: Unknown command: ${command}`];
  if (suggestion) {
    lines.push(`help: Did you mean \`asana-axi ${suggestion}\`?`);
  }
  lines.push("help: Run `asana-axi --help` to see available commands");
  return `${lines.join("\n")}\n`;
}
