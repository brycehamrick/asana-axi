import { AxiError } from "axi-sdk-js";
import type { AxiStructuredOutput } from "../render.js";
import {
  flagValue,
  parseFlags,
  parseLimit,
  rejectPositionals,
  unknownSubcommandError,
} from "../args.js";
import { openClient, type CliDeps } from "../context.js";
import { gidOf, nameOf, stripNulls, type TagRecord } from "../render.js";
import { resolveWorkspaceGid } from "../resolve.js";

export const TAG_HELP = `usage: asana-axi tag <subcommand> [flags]
subcommands[2]:
  list, create
flags{list}:
  --workspace <gid|name> (default: ASANA_WORKSPACE_ID or the only workspace), --limit <n> (default 30)
flags{create}:
  --name <text> (required), --workspace <gid|name>, --color <name>
  (idempotent - an existing tag with the same name is a no-op success)
examples:
  asana-axi tag list
  asana-axi tag create --name frontend --color sky-blue`;

const SUBCOMMANDS = ["list", "create"] as const;

export async function tagCommand(
  args: string[],
  deps: CliDeps | undefined,
): Promise<AxiStructuredOutput> {
  const sub = args[0];
  if (!sub || sub === "--help") {
    return { help_text: TAG_HELP };
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listTags(rest, deps ?? {});
    case "create":
      return createTag(rest, deps ?? {});
    default:
      throw unknownSubcommandError("tag", sub, [...SUBCOMMANDS], "tag");
  }
}

async function listTags(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--workspace": "value", "--limit": "value" },
    "tag list",
  );
  rejectPositionals(positionals, "tag list");
  const limit = parseLimit(flags, 30);

  const { client, config } = openClient(deps);
  const workspaceGid = await resolveWorkspaceGid(
    client,
    config,
    flagValue(flags, "--workspace"),
  );
  const { items, hasMore } = await client.collect<TagRecord>(
    `/workspaces/${workspaceGid}/tags`,
    { limit, query: { opt_fields: "gid,name,color" } },
  );
  const rows = items.map((tag) => ({
    gid: gidOf(tag),
    name: nameOf(tag),
    color: typeof tag.color === "string" ? tag.color : undefined,
  }));
  return stripNulls({
    workspace: workspaceGid,
    count: rows.length,
    ...(hasMore ? { has_more: true } : {}),
    tags: rows,
    ...(rows.length === 0
      ? { note: "0 tags in this workspace - create one with `tag create --name <text>`" }
      : {}),
    help: [
      "Run `asana-axi task list --tag <name>` for tasks with a tag",
      "Run `asana-axi task edit <gid> --tags " +
        (rows[0] ? rows[0].name : "<name>") +
        "` to apply one",
    ],
  });
}

async function createTag(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--name": "value", "--workspace": "value", "--color": "value" },
    "tag create",
  );
  rejectPositionals(positionals, "tag create");
  const name = flagValue(flags, "--name");
  if (name === undefined) {
    throw new AxiError(
      "--name is required",
      "VALIDATION_ERROR",
      ["Example: asana-axi tag create --name frontend"],
    );
  }
  const color = flagValue(flags, "--color");

  const { client, config } = openClient(deps);
  const workspaceGid = await resolveWorkspaceGid(
    client,
    config,
    flagValue(flags, "--workspace"),
  );

  // Idempotent: reuse the existing tag when the name already exists.
  const { items } = await client.collect<TagRecord>(
    `/workspaces/${workspaceGid}/tags`,
    { limit: 200, query: { opt_fields: "gid,name" } },
  );
  const existing = items.find(
    (tag) => nameOf(tag).toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return stripNulls({
      tag: { gid: gidOf(existing), name: nameOf(existing) },
      message: "Tag already exists - no change",
      help: ["Run `asana-axi task edit <gid> --tags " + name + "` to apply it"],
    });
  }

  const created = await client.request<TagRecord>("POST", "/tags", {
    body: { name, workspace: workspaceGid, ...(color ? { color } : {}) },
    query: { opt_fields: "gid,name,color" },
  });
  return stripNulls({
    tag: {
      gid: gidOf(created),
      name: nameOf(created),
      color: typeof created.color === "string" ? created.color : null,
    },
    help: ["Run `asana-axi task edit <gid> --tags " + name + "` to apply it"],
  });
}
