import { AxiError } from "axi-sdk-js";
import type { AxiStructuredOutput } from "../render.js";
import {
  flagValue,
  parseFlags,
  parseLimit,
  rejectPositionals,
  requireGid,
  unknownSubcommandError,
} from "../args.js";
import { openClient, type CliDeps } from "../context.js";
import { gidOf, isGid, nameOf, stripNulls, type WorkspaceRecord } from "../render.js";
import { listWorkspaces } from "../resolve.js";

export const WORKSPACE_HELP = `usage: asana-axi workspace <subcommand> [flags]
subcommands[2]:
  list, view <gid>
flags{list}:
  --limit <n> (default 30)
flags{view}:
  (none)
examples:
  asana-axi workspace list
  asana-axi workspace view 1200000000000003`;

const SUBCOMMANDS = ["list", "view"] as const;

export async function workspaceCommand(
  args: string[],
  deps: CliDeps | undefined,
): Promise<AxiStructuredOutput> {
  const sub = args[0];
  if (!sub || sub === "--help") {
    return { help_text: WORKSPACE_HELP };
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listWorkspacesCommand(rest, deps ?? {});
    case "view":
      return viewWorkspace(rest, deps ?? {});
    default:
      throw unknownSubcommandError("workspace", sub, [...SUBCOMMANDS], "workspace");
  }
}

async function listWorkspacesCommand(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--limit": "value" },
    "workspace list",
  );
  rejectPositionals(positionals, "workspace list");
  const limit = parseLimit(flags, 30);

  const { client } = openClient(deps);
  const { items, hasMore } = await client.collect<WorkspaceRecord>(
    "/workspaces",
    { limit, query: { opt_fields: "gid,name,is_organization" } },
  );
  const rows = items.map((workspace) => ({
    gid: gidOf(workspace),
    name: nameOf(workspace),
    organization: workspace.is_organization === true ? true : undefined,
  }));
  return stripNulls({
    count: rows.length,
    ...(hasMore ? { has_more: true } : {}),
    workspaces: rows,
    ...(rows.length === 0
      ? { note: "0 workspaces reachable from this token" }
      : {}),
    help: [
      "Set ASANA_WORKSPACE_ID=<gid> (environment or ./.env) to make it the default",
      "Run `asana-axi project list --workspace <gid>` for its projects",
    ],
  });
}

async function viewWorkspace(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(args, {}, "workspace view");
  void flags;
  const gid = requireGid(positionals, "workspace view");
  if (!isGid(gid)) {
    throw new AxiError(
      `Invalid workspace GID: ${JSON.stringify(gid)} (expected a long numeric GID)`,
      "VALIDATION_ERROR",
      ["Run `asana-axi workspace list` to find it"],
    );
  }

  const { client } = openClient(deps);
  const workspace = await client.request<WorkspaceRecord>(
    "GET",
    `/workspaces/${gid}`,
    { query: { opt_fields: "gid,name,is_organization,email_domains" } },
  );
  const domains = Array.isArray(workspace.email_domains)
    ? workspace.email_domains.filter(
        (domain): domain is string => typeof domain === "string",
      )
    : [];
  const names = await listWorkspaces(client);
  const match = names.find((candidate) => candidate.gid === gid);
  return stripNulls({
    workspace: {
      gid: gidOf(workspace),
      name: nameOf(workspace),
      organization: workspace.is_organization === true ? true : null,
      email_domains: domains.length > 0 ? domains : null,
    },
    help: [
      "Run `asana-axi project list --workspace " + gid + "` for its projects",
      "Set ASANA_WORKSPACE_ID=" + gid + " to make it the default",
    ],
  });
}
