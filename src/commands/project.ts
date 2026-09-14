import { AxiError } from "axi-sdk-js";
import type { AxiStructuredOutput } from "../render.js";
import {
  flagBoolean,
  flagValue,
  parseFlags,
  parseLimit,
  rejectPositionals,
  requireGid,
  unknownSubcommandError,
} from "../args.js";
import { openClient, type CliDeps } from "../context.js";
import {
  dateOnly,
  gidOf,
  isGid,
  nameOf,
  stripNulls,
  truncate,
  NOTES_TRUNCATE_LENGTH,
  type ProjectRecord,
  type SectionRecord,
} from "../render.js";
import { resolveWorkspaceGid } from "../resolve.js";

export const PROJECT_HELP = `usage: asana-axi project <subcommand> [flags]
subcommands[3]:
  list, view <gid>, sections <gid>
flags{list}:
  --workspace <gid|name> (default: ASANA_WORKSPACE_ID or the only workspace),
  --archived (include archived), --limit <n> (default 30)
flags{view}:
  --full (complete notes without truncation)
flags{sections}:
  (none)
examples:
  asana-axi project list --workspace "Acme Co"
  asana-axi project view 1200000000000002
  asana-axi project sections 1200000000000002`;

const SUBCOMMANDS = ["list", "view", "sections"] as const;

export async function projectCommand(
  args: string[],
  deps: CliDeps | undefined,
): Promise<AxiStructuredOutput> {
  const sub = args[0];
  if (!sub || sub === "--help") {
    return { help_text: PROJECT_HELP };
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listProjects(rest, deps ?? {});
    case "view":
      return viewProject(rest, deps ?? {});
    case "sections":
      return listSections(rest, deps ?? {});
    default:
      throw unknownSubcommandError("project", sub, [...SUBCOMMANDS], "project");
  }
}

async function listProjects(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--workspace": "value", "--archived": "boolean", "--limit": "value" },
    "project list",
  );
  rejectPositionals(positionals, "project list");
  const limit = parseLimit(flags, 30);

  const { client, config } = openClient(deps);
  const workspaceGid = await resolveWorkspaceGid(
    client,
    config,
    flagValue(flags, "--workspace"),
  );
  const { items, hasMore } = await client.collect<ProjectRecord>(
    `/workspaces/${workspaceGid}/projects`,
    {
      limit,
      query: {
        opt_fields: "gid,name,archived,modified_at",
        ...(flagBoolean(flags, "--archived") ? { archived: "true" } : {}),
      },
    },
  );

  const rows = items.map((project) => ({
    gid: gidOf(project),
    name: nameOf(project),
    archived: project.archived === true ? true : undefined,
  }));
  return stripNulls({
    workspace: workspaceGid,
    count: rows.length,
    ...(hasMore ? { has_more: true } : {}),
    projects: rows,
    ...(rows.length === 0
      ? {
          note: "0 projects visible in this workspace for this token",
        }
      : {}),
    help: [
      "Run `asana-axi project view <gid>` for one project",
      "Run `asana-axi project sections <gid>` for the board columns",
      "Run `asana-axi task list --project <gid|name>` for its tasks",
    ],
  });
}

async function viewProject(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--full": "boolean" },
    "project view",
  );
  const gid = requireProjectGid(positionals);

  const { client } = openClient(deps);
  const project = await client.request<ProjectRecord>(
    "GET",
    `/projects/${gid}`,
    {
      query: {
        opt_fields:
          "gid,name,notes,archived,due_date,modified_at,owner.name,workspace.name",
      },
    },
  );
  // The counts endpoint is compact-by-default: without opt_fields it
  // returns {} (verified live), so request the numbers explicitly.
  const counts = await client.request<Record<string, unknown>>(
    "GET",
    `/projects/${gid}/task_counts`,
    {
      query: {
        opt_fields: "num_tasks,num_completed_tasks,num_incomplete_tasks",
      },
    },
  );

  const owner = project.owner as Record<string, unknown> | null | undefined;
  const workspace = project.workspace as Record<string, unknown> | undefined;
  return stripNulls({
    project: {
      gid: gidOf(project),
      name: nameOf(project),
      notes:
        typeof project.notes === "string" && project.notes !== ""
          ? truncate(
              project.notes,
              NOTES_TRUNCATE_LENGTH,
              flagBoolean(flags, "--full"),
              "--full",
            )
          : null,
      workspace:
        workspace && typeof workspace.name === "string" ? workspace.name : null,
      owner: owner && typeof owner.name === "string" ? owner.name : null,
      archived: project.archived === true ? true : null,
      due_on: dateOnly(project.due_date),
      modified_at: dateOnly(project.modified_at),
      task_counts: {
        total: numberOf(counts.num_tasks),
        incomplete: numberOf(counts.num_incomplete_tasks),
        completed: numberOf(counts.num_completed_tasks),
      },
    },
    help: [
      "Run `asana-axi task list --project " + gid + "` for its open tasks",
      "Run `asana-axi project sections " + gid + "` for the board columns",
    ],
  });
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

async function listSections(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(args, {}, "project sections");
  void flags;
  const gid = requireProjectGid(positionals);

  const { client } = openClient(deps);
  const { items } = await client.collect<SectionRecord>(
    `/projects/${gid}/sections`,
    { limit: 100, query: { opt_fields: "gid,name" } },
  );

  const rows = items.map((section) => ({
    gid: gidOf(section),
    name: nameOf(section),
  }));
  return stripNulls({
    project: gid,
    count: rows.length,
    sections: rows,
    ...(rows.length === 0
      ? { note: "0 sections - the project has no board columns yet" }
      : {}),
    help: [
      "Run `asana-axi task move <gid> --section <name|gid>` to move a task",
      "Run `asana-axi task list --project " + gid + " --section <name>` for one column",
    ],
  });
}

function requireProjectGid(positionals: string[]): string {
  const gid = requireGid(positionals, "project view/sections");
  if (!isGid(gid)) {
    throw new AxiError(
      `Invalid project GID: ${JSON.stringify(gid)} (expected a long numeric GID)`,
      "VALIDATION_ERROR",
      ["Run `asana-axi project list` to find it - names resolve only on --project flags"],
    );
  }
  return gid;
}
