import { AxiError } from "axi-sdk-js";
import { readFile } from "node:fs/promises";
import type { AxiStructuredOutput } from "../render.js";
import {
  flagBoolean,
  flagValue,
  parseFlags,
  parseLimit,
  rejectPositionals,
  requireGid,
  splitCsv,
  unknownSubcommandError,
} from "../args.js";
import { openClient, type CliDeps } from "../context.js";
import {
  assigneeNameOf,
  dateOnly,
  gidOf,
  isGid,
  isOverdue,
  nameOf,
  NOTES_TRUNCATE_LENGTH,
  COMMENT_TRUNCATE_LENGTH,
  sectionGidOf,
  sectionNameOf,
  stripNulls,
  tagNameList,
  taskUrl,
  truncate,
  type StoryRecord,
  type TaskRecord,
} from "../render.js";
import {
  ensureTag,
  findTagGid,
  resolveProjectGid,
  resolveSectionGid,
  resolveWorkspaceGid,
} from "../resolve.js";
import { toAxiError } from "../errors.js";

export const TASK_HELP = `usage: asana-axi task <subcommand> [flags]
subcommands[12]:
  list, view <gid>, create, edit <gid>, move <gid> --section <name|gid>, complete <gid>, reopen <gid>,
  comment <gid> --text, attach <gid> --file <path>, search "<text>", subtasks <gid>, delete <gid> --confirm
flags{list}:
  --project <gid|name> (default: ASANA_PROJECT_ID), --assignee <gid|@me>, --section <name|gid>,
  --tag <name|gid>, --completed (completed only; default = incomplete), --all (both),
  --due-before <date>, --due-after <date>, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --limit <n> (comments shown, default 30; requires --comments), --subtasks, --attachments,
  --full (complete notes/comments without truncation), --fields <a,b,c>
flags{create}:
  --name <text> (required), --project <gid|name> (required unless ASANA_PROJECT_ID),
  --notes <text> or --notes-file <path>, --due-on <YYYY-MM-DD>, --assignee <gid|@me>,
  --tags <a,b> (workspace names; created when missing), --section <name|gid>, --parent <gid> (subtask)
flags{edit}:
  --name <text>, --notes <text> or --notes-file <path>, --due-on <YYYY-MM-DD|"" clears>,
  --assignee <gid|@me|"" unassigns>, --completed <true|false>, --tags <a,b>, --remove-tags <a,b>, --section <name|gid>
flags{move}:
  --section <name|gid> (required; no-op success when already there)
flags{complete|reopen}:
  (none; idempotent - no-op success when already in that state)
flags{comment}:
  --text <text> or --text-file <path> (required, exactly one)
flags{attach}:
  --file <path> (required), --comment <text> (optional story after upload)
flags{search}:
  --workspace <gid|name> (default: ASANA_WORKSPACE_ID or the only workspace),
  --completed, --limit <n> (default 30), --fields <a,b,c>
flags{subtasks}:
  --limit <n> (default 30), --completed, --fields <a,b,c>
flags{delete}:
  --confirm (required - Asana deletion is permanent)
examples:
  asana-axi task list --project website --section "In Progress"
  asana-axi task view 1200000000000001 --comments
  asana-axi task create --name "Fix login" --project website --section Backlog --tags bug,frontend
  asana-axi task move 1200000000000001 --section "Review / QA"
  asana-axi task complete 1200000000000001
  asana-axi task search "checkout redesign"`;

const SUBCOMMANDS = [
  "list",
  "view",
  "create",
  "edit",
  "move",
  "complete",
  "reopen",
  "comment",
  "attach",
  "search",
  "subtasks",
  "delete",
] as const;

const LIST_OPT_FIELDS =
  "gid,name,completed,due_on,due_at,assignee.name,tags.name,memberships.section.gid,memberships.section.name";
const VIEW_OPT_FIELDS = `${LIST_OPT_FIELDS},notes,assignee.gid,num_subtasks,memberships.project.name,projects.gid,created_at,modified_at,workspace.gid`;

export async function taskCommand(
  args: string[],
  deps: CliDeps | undefined,
): Promise<AxiStructuredOutput> {
  const sub = args[0];
  if (!sub || sub === "--help") {
    return { help_text: TASK_HELP };
  }
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return listTasks(rest, deps ?? {});
    case "view":
      return viewTask(rest, deps ?? {});
    case "create":
      return createTask(rest, deps ?? {});
    case "edit":
      return editTask(rest, deps ?? {});
    case "move":
      return moveTask(rest, deps ?? {});
    case "complete":
    case "reopen":
      return setCompletion(rest, deps ?? {}, sub === "complete");
    case "comment":
      return commentTask(rest, deps ?? {});
    case "attach":
      return attachToTask(rest, deps ?? {});
    case "search":
      return searchTasks(rest, deps ?? {});
    case "subtasks":
      return listSubtasks(rest, deps ?? {});
    case "delete":
      return deleteTask(rest, deps ?? {});
    default:
      throw unknownSubcommandError(
        "task",
        sub,
        [...SUBCOMMANDS],
        "task",
      );
  }
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function requireTaskGid(
  positionals: string[],
  sub: string,
): string {
  const gid = requireGid(positionals, `task ${sub}`);
  if (!isGid(gid)) {
    throw new AxiError(
      `Invalid task GID: ${JSON.stringify(gid)} (expected a long numeric GID, e.g. 1200000000000001)`,
      "VALIDATION_ERROR",
      [
        "Find the GID with `asana-axi task list` or `asana-axi task search \"<text>\"`",
      ],
    );
  }
  return gid;
}

async function readTextFlag(
  flags: Record<string, string | boolean>,
  textFlag: string,
  fileFlag: string,
  context: string,
): Promise<string | undefined> {
  const text = flagValue(flags, textFlag);
  const file = flagValue(flags, fileFlag);
  if (text !== undefined && file !== undefined) {
    throw new AxiError(
      `Pass either ${textFlag} or ${fileFlag}, not both`,
      "VALIDATION_ERROR",
      [`Run \`asana-axi ${context} --help\` for usage`],
    );
  }
  if (file !== undefined) {
    try {
      return await readFile(file, "utf8");
    } catch {
      throw new AxiError(
        `Could not read ${fileFlag} file: ${JSON.stringify(file)}`,
        "VALIDATION_ERROR",
        ["Check the path and re-run"],
      );
    }
  }
  return text;
}

function validateDueOn(value: string, context: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AxiError(
      `Invalid due date ${JSON.stringify(value)} - expected YYYY-MM-DD`,
      "VALIDATION_ERROR",
      [`Example: asana-axi ${context} --due-on 2026-12-31`],
    );
  }
  return value;
}

function validateAssignee(value: string): string {
  if (value === "me" || value === "@me" || isGid(value)) {
    return value === "@me" ? "me" : value;
  }
  throw new AxiError(
    `Invalid assignee ${JSON.stringify(value)} - expected a user GID or @me`,
    "VALIDATION_ERROR",
    ["Find user GIDs with `asana-axi me` (yours) or from a task's assignee field"],
  );
}

/** Render one task the way `task view` does - shared by every mutation. */
async function renderTaskView(
  deps: CliDeps,
  gid: string,
  options: {
    full?: boolean;
    comments?: boolean;
    commentLimit?: number;
    subtasks?: boolean;
    attachments?: boolean;
  } = {},
): Promise<AxiStructuredOutput> {
  const { client } = openClient(deps);
  const task = await client.request<TaskRecord>(
    "GET",
    `/tasks/${gid}`,
    { query: { opt_fields: VIEW_OPT_FIELDS } },
  );

  const output: AxiStructuredOutput = {
    task: stripNulls({
      gid: gidOf(task),
      name: nameOf(task),
      completed: task.completed === true,
      due_on: dateOnly(task.due_on ?? task.due_at),
      sections: sectionNamesOf(task),
      projects: projectNamesOf(task),
      assignee: assigneeNameOf(task),
      tags: tagNameList(task),
      notes:
        typeof task.notes === "string" && task.notes !== ""
          ? truncate(task.notes, NOTES_TRUNCATE_LENGTH, options.full === true, "--full")
          : null,
      subtasks_count: typeof task.num_subtasks === "number" ? task.num_subtasks : null,
      url: taskUrl(gid),
    }),
  };

  if (options.comments) {
    const { items, hasMore } = await client.collect<StoryRecord>(
      `/tasks/${gid}/stories`,
      {
        limit: options.commentLimit ?? 30,
        query: { opt_fields: "gid,text,type,created_at,created_by.name" },
      },
    );
    const comments = items.filter((story) => story.type === "commented");
    output.comments = comments.map((story) => ({
      gid: gidOf(story),
      author:
        story.created_by && typeof story.created_by === "object"
          ? nameOf(story.created_by as Record<string, unknown>)
          : null,
      created_at: dateOnly(story.created_at),
      text: truncate(
        typeof story.text === "string" ? story.text : "",
        COMMENT_TRUNCATE_LENGTH,
        options.full === true,
        "--full",
      ),
    }));
    output.comments_count = comments.length;
    if (hasMore) {
      output.comments_more = true;
    }
  }

  if (options.subtasks) {
    const { items, hasMore } = await client.collect<TaskRecord>(
      `/tasks/${gid}/subtasks`,
      { limit: 30, query: { opt_fields: "gid,name,completed,due_on" } },
    );
    output.subtasks = items.map((subtask) => ({
      gid: gidOf(subtask),
      name: nameOf(subtask),
      completed: subtask.completed === true,
      due_on: dateOnly(subtask.due_on),
    }));
    output.subtasks_more = hasMore || undefined;
  }

  if (options.attachments) {
    const { items, hasMore } = await client.collect<Record<string, unknown>>(
      `/tasks/${gid}/attachments`,
      { limit: 30, query: { opt_fields: "gid,name,resource_subtype,host" } },
    );
    output.attachments = items.map((attachment) => ({
      gid: String(attachment.gid ?? ""),
      name: typeof attachment.name === "string" ? attachment.name : "",
      kind:
        typeof attachment.resource_subtype === "string"
          ? attachment.resource_subtype
          : null,
      host: typeof attachment.host === "string" ? attachment.host : null,
    }));
    output.attachments_more = hasMore || undefined;
  }

  output.help = viewHelp(gid, options);
  return stripNulls(output);
}

function viewHelp(
  gid: string,
  options: { comments?: boolean; subtasks?: boolean; attachments?: boolean },
): string[] {
  const help: string[] = [];
  if (!options.comments) help.push("Run `asana-axi task view " + gid + " --comments` for the discussion");
  if (!options.subtasks) help.push("Run `asana-axi task subtasks " + gid + "` for child tasks");
  help.push("Run `asana-axi task edit " + gid + " --name \"<text>\"` to change fields");
  help.push("Run `asana-axi task move " + gid + " --section <name>` to change column");
  help.push("Run `asana-axi task complete " + gid + "` when it is done");
  return help;
}

function sectionNamesOf(task: TaskRecord): string[] {
  const memberships = task.memberships;
  if (!Array.isArray(memberships)) return [];
  const names: string[] = [];
  for (const membership of memberships) {
    const section = (membership as Record<string, unknown>)?.section as
      | Record<string, unknown>
      | undefined;
    if (section && typeof section.name === "string") {
      names.push(section.name);
    }
  }
  return names;
}

function projectNamesOf(task: TaskRecord): string[] {
  const memberships = task.memberships;
  if (!Array.isArray(memberships)) return [];
  const names: string[] = [];
  for (const membership of memberships) {
    const project = (membership as Record<string, unknown>)?.project as
      | Record<string, unknown>
      | undefined;
    if (project && typeof project.name === "string") {
      names.push(project.name);
    }
  }
  return names;
}

/** Column picker for --fields on list/search/subtasks rows. */
function taskRow(
  task: TaskRecord,
  fields: Set<string>,
  full: boolean,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    gid: gidOf(task),
    name: nameOf(task),
    section: sectionNameOf(task),
    due_on: dateOnly(task.due_on ?? task.due_at),
    completed: task.completed === true,
  };
  if (fields.has("assignee")) row.assignee = assigneeNameOf(task);
  if (fields.has("tags")) row.tags = tagNameList(task).join(",");
  if (fields.has("notes")) {
    row.notes = truncate(
      typeof task.notes === "string" ? task.notes : "",
      300,
      full,
      "--full on `task view`",
    );
  }
  // --fields given: keep only requested columns (gid always stays).
  if (fields.size > 0) {
    for (const key of ["name", "section", "due_on", "completed"]) {
      if (!fields.has(key)) delete row[key];
    }
  }
  return stripNulls(row);
}

function listHelp(): string[] {
  return [
    "Run `asana-axi task view <gid> --comments` for one task",
    "Run `asana-axi task create --name \"<text>\" --project <gid|name>` to add one",
    "Run `asana-axi task list --fields assignee,tags` for more columns",
  ];
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function listTasks(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    {
      "--project": "value",
      "--workspace": "value",
      "--assignee": "value",
      "--section": "value",
      "--tag": "value",
      "--completed": "boolean",
      "--all": "boolean",
      "--due-before": "value",
      "--due-after": "value",
      "--limit": "value",
      "--fields": "value",
    },
    "task list",
  );
  rejectPositionals(positionals, "task list");
  if (flagBoolean(flags, "--completed") && flagBoolean(flags, "--all")) {
    throw new AxiError(
      "--completed and --all are mutually exclusive",
      "VALIDATION_ERROR",
      ["Use --completed (completed only), --all (both), or neither (incomplete only)"],
    );
  }

  const { client, config } = openClient(deps);
  const projectGid = await resolveProjectGid(
    client,
    config,
    flagValue(flags, "--project"),
    flagValue(flags, "--workspace") ?? config.workspaceId,
  );
  const limit = parseLimit(flags, 30);
  const fields = new Set(splitCsv(flagValue(flags, "--fields")));

  // /tasks supports server-side project + assignee + completed_since filters.
  const query: Record<string, string | number | boolean | undefined> = {
    project: projectGid,
    opt_fields: LIST_OPT_FIELDS,
  };
  const assignee = flagValue(flags, "--assignee");
  if (assignee !== undefined) {
    query.assignee = validateAssignee(assignee);
  }
  const wantCompleted = flagBoolean(flags, "--completed");
  const wantAll = flagBoolean(flags, "--all");
  if (!wantCompleted && !wantAll) {
    query.completed_since = "now";
  }

  const { items, hasMore } = await client.collect<TaskRecord>("/tasks", {
    limit,
    query,
  });

  let tasks = items;
  if (wantCompleted) {
    tasks = tasks.filter((task) => task.completed === true);
  }

  // Client-side refinement (server cannot filter these on /tasks).
  const sectionFilter = flagValue(flags, "--section");
  if (sectionFilter !== undefined) {
    const sectionGid = await resolveSectionGid(client, projectGid, sectionFilter);
    tasks = tasks.filter((task) => sectionGidOf(task) === sectionGid);
  }
  const tagFilter = flagValue(flags, "--tag");
  if (tagFilter !== undefined) {
    const workspaceGid = await resolveWorkspaceGid(
      client,
      config,
      flagValue(flags, "--workspace"),
    );
    const tagGid = await findTagGid(client, workspaceGid, tagFilter);
    if (tagGid === null) {
      return stripNulls({
        count: 0,
        tasks: [],
        note: `tag not found: ${tagFilter}`,
        help: ["Run `asana-axi tag list --workspace <gid|name>` to see tags"],
      });
    }
    tasks = tasks.filter((task) =>
      tagNameList(task).some(
        (name) => name.toLowerCase() === tagFilter.toLowerCase(),
      ),
    );
  }
  const dueBefore = flagValue(flags, "--due-before");
  const dueAfter = flagValue(flags, "--due-after");
  if (dueBefore !== undefined || dueAfter !== undefined) {
    tasks = tasks.filter((task) => {
      const due = dateOnly(task.due_on ?? task.due_at);
      if (due === null) return false;
      if (dueBefore !== undefined && due >= dueBefore) return false;
      if (dueAfter !== undefined && due <= dueAfter) return false;
      return true;
    });
  }
  if (tasks.length > limit) {
    tasks = tasks.slice(0, limit);
  }

  const rows = tasks.map((task) => taskRow(task, fields, false));
  const incompleteOverdue = tasks.filter(
    (task) => task.completed !== true && isOverdue(dateOnly(task.due_on ?? task.due_at)),
  ).length;

  const output: AxiStructuredOutput = {
    count: rows.length,
    ...(hasMore ? { has_more: true } : {}),
    ...(incompleteOverdue > 0 ? { overdue_count: incompleteOverdue } : {}),
    tasks: rows,
    ...(rows.length === 0
      ? {
          note:
            "0 tasks matched - adjust filters or widen --limit" +
            (wantCompleted ? " (--completed shows only completed tasks)" : ""),
        }
      : {}),
    help: listHelp(),
  };
  return stripNulls(output);
}

async function viewTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    {
      "--comments": "boolean",
      "--subtasks": "boolean",
      "--attachments": "boolean",
      "--full": "boolean",
      "--limit": "value",
      "--fields": "value",
    },
    "task view",
  );
  const gid = requireTaskGid(positionals, "view");
  const limitFlag = flagValue(flags, "--limit");
  const comments = flagBoolean(flags, "--comments");
  if (limitFlag !== undefined && !comments) {
    throw new AxiError(
      "--limit only applies to comments - pass --comments too",
      "VALIDATION_ERROR",
      ["Example: asana-axi task view <gid> --comments --limit 100"],
    );
  }
  const fields = splitCsv(flagValue(flags, "--fields"));
  if (fields.length > 0 && flagBoolean(flags, "--full")) {
    throw new AxiError(
      "--fields and --full are mutually exclusive (a --fields render is never truncated)",
      "VALIDATION_ERROR",
      ["Drop one of the two flags"],
    );
  }

  const output = await renderTaskView(deps, gid, {
    full: flagBoolean(flags, "--full"),
    comments,
    commentLimit: limitFlag !== undefined ? parseLimit(flags, 30) : 30,
    subtasks: flagBoolean(flags, "--subtasks"),
    attachments: flagBoolean(flags, "--attachments"),
  });

  if (fields.length > 0) {
    const allowed = new Set(fields);
    const task = output.task as Record<string, unknown>;
    const filtered: Record<string, unknown> = { gid: task.gid };
    for (const field of allowed) {
      if (field !== "gid" && field in task) {
        filtered[field] = task[field];
      }
    }
    output.task = filtered;
  }
  return output;
}

async function createTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    {
      "--name": "value",
      "--project": "value",
      "--workspace": "value",
      "--notes": "value",
      "--notes-file": "value",
      "--due-on": "value",
      "--assignee": "value",
      "--tags": "value",
      "--section": "value",
      "--parent": "value",
    },
    "task create",
  );
  rejectPositionals(positionals, "task create");
  const name = flagValue(flags, "--name");
  if (name === undefined) {
    throw new AxiError(
      "--name is required",
      "VALIDATION_ERROR",
      ['Example: asana-axi task create --name "Fix login" --project <gid|name>'],
    );
  }
  const notes = await readTextFlag(flags, "--notes", "--notes-file", "task create");
  const parent = flagValue(flags, "--parent");
  const projectFlag = flagValue(flags, "--project");

  const { client, config } = openClient(deps);
  const tags = splitCsv(flagValue(flags, "--tags"));
  const workspaceGid =
    parent !== undefined || projectFlag !== undefined || tags.length > 0
      ? await resolveWorkspaceGid(
          client,
          config,
          flagValue(flags, "--workspace"),
        )
      : undefined;

  let projectGid: string | undefined;
  if (parent !== undefined) {
    if (projectFlag !== undefined) {
      throw new AxiError(
        "--parent and --project are mutually exclusive (a subtask inherits the parent's project)",
        "VALIDATION_ERROR",
        ["Drop --project, or drop --parent to create a standalone task"],
      );
    }
    if (!isGid(parent)) {
      throw new AxiError(
        `Invalid --parent GID: ${JSON.stringify(parent)}`,
        "VALIDATION_ERROR",
        ["Find the parent with `asana-axi task list` or `task search`"],
      );
    }
  } else {
    projectGid = await resolveProjectGid(
      client,
      config,
      projectFlag,
      workspaceGid,
    );
  }

  const body: Record<string, unknown> = { name };
  if (notes !== undefined) body.notes = notes;
  const dueOn = flagValue(flags, "--due-on");
  if (dueOn !== undefined) body.due_on = validateDueOn(dueOn, "task create");
  const assignee = flagValue(flags, "--assignee");
  if (assignee !== undefined) body.assignee = validateAssignee(assignee);

  const created = parent !== undefined
    ? await client.request<TaskRecord>("POST", `/tasks/${parent}/subtasks`, {
        body,
        query: { opt_fields: "gid" },
      })
    : await client.request<TaskRecord>("POST", "/tasks", {
        body: { ...body, projects: [projectGid] },
        query: { opt_fields: "gid" },
      });
  const gid = gidOf(created);
  if (gid === "") {
    throw new AxiError(
      "Asana did not return a GID for the created task",
      "API_ERROR",
      ["Re-run `asana-axi task list` to see whether it was created"],
    );
  }

  const section = flagValue(flags, "--section");
  if (section !== undefined && projectGid !== undefined) {
    const sectionGid = await resolveSectionGid(client, projectGid, section);
    await client.request("POST", `/sections/${sectionGid}/addTask`, {
      body: { task: gid },
    });
  } else if (section !== undefined && parent !== undefined) {
    throw new AxiError(
      "--section requires --project (or a standalone task); subtasks cannot be placed directly",
      "VALIDATION_ERROR",
      ["Create the subtask, then `asana-axi task move <gid> --section <name>`"],
    );
  }

  for (const tagName of tags) {
    const tag = await ensureTag(client, workspaceGid as string, tagName);
    await client.request("POST", `/tasks/${gid}/addTag`, {
      body: { tag: tag.gid },
    });
  }

  return renderTaskView(deps, gid, {});
}

async function editTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    {
      "--name": "value",
      "--workspace": "value",
      "--notes": "value",
      "--notes-file": "value",
      "--due-on": "value",
      "--assignee": "value",
      "--completed": "value",
      "--tags": "value",
      "--remove-tags": "value",
      "--section": "value",
    },
    "task edit",
  );
  const gid = requireTaskGid(positionals, "edit");

  const notes = await readTextFlag(flags, "--notes", "--notes-file", "task edit");
  const name = flagValue(flags, "--name");
  const dueOn = flagValue(flags, "--due-on");
  const assignee = flagValue(flags, "--assignee");
  const completed = flagValue(flags, "--completed");
  const addTags = splitCsv(flagValue(flags, "--tags"));
  const removeTags = splitCsv(flagValue(flags, "--remove-tags"));
  const section = flagValue(flags, "--section");

  const hasChange =
    name !== undefined ||
    notes !== undefined ||
    dueOn !== undefined ||
    assignee !== undefined ||
    completed !== undefined ||
    addTags.length > 0 ||
    removeTags.length > 0 ||
    section !== undefined;
  if (!hasChange) {
    throw new AxiError(
      "Nothing to change - pass at least one mutation flag",
      "VALIDATION_ERROR",
      ["Example: asana-axi task edit <gid> --name \"New title\""],
    );
  }

  const { client, config } = openClient(deps);
  const current = await client.request<TaskRecord>(
    "GET",
    `/tasks/${gid}`,
    {
      query: {
        opt_fields:
          "gid,completed,due_on,tags.name,tags.gid,memberships.section.gid,memberships.project.gid,workspace.gid",
      },
    },
  );

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (notes !== undefined) body.notes = notes;
  if (dueOn !== undefined) {
    body.due_on = dueOn === "" ? null : validateDueOn(dueOn, "task edit");
  }
  if (assignee !== undefined) {
    body.assignee = assignee === "" ? null : validateAssignee(assignee);
  }
  if (completed !== undefined) {
    const parsed = completed.toLowerCase();
    if (parsed !== "true" && parsed !== "false") {
      throw new AxiError(
        `Invalid --completed ${JSON.stringify(completed)} - expected true or false`,
        "VALIDATION_ERROR",
        ["Use `asana-axi task complete <gid>` / `task reopen <gid>` instead"],
      );
    }
    body.completed = parsed === "true";
  }
  if (Object.keys(body).length > 0) {
    await client.request("PUT", `/tasks/${gid}`, { body });
  }

  // Tag changes (idempotent: skip tags already present/absent).
  if (addTags.length > 0 || removeTags.length > 0) {
    const workspace = workspaceGidOfTask(current) ?? config.workspaceId;
    if (workspace === undefined) {
      throw new AxiError(
        "Tag changes need a workspace - pass --workspace or set ASANA_WORKSPACE_ID",
        "VALIDATION_ERROR",
        ["Run `asana-axi workspace list` to see the options"],
      );
    }
    const existing = new Set(
      tagNameList(current).map((tagName) => tagName.toLowerCase()),
    );
    for (const tagName of addTags) {
      if (existing.has(tagName.toLowerCase())) continue;
      const tag = await ensureTag(client, workspace, tagName);
      await client.request("POST", `/tasks/${gid}/addTag`, {
        body: { tag: tag.gid },
      });
    }
    for (const tagName of removeTags) {
      if (!existing.has(tagName.toLowerCase())) continue;
      const tagGid = await findTagGid(client, workspace, tagName);
      if (tagGid === null) continue;
      await client.request("POST", `/tasks/${gid}/removeTag`, {
        body: { tag: tagGid },
      });
    }
  }

  // Section move (idempotent no-op when already in that section).
  if (section !== undefined) {
    const projectGid = firstProjectGidOfTask(current);
    if (projectGid === null) {
      throw new AxiError(
        "Task has no project membership - cannot resolve --section",
        "VALIDATION_ERROR",
        ["Use `asana-axi task move <gid> --section <gid>` with a raw section GID"],
      );
    }
    const sectionGid = await resolveSectionGid(client, projectGid, section);
    const currentSectionGid = sectionGidOf(current);
    if (currentSectionGid !== sectionGid) {
      await client.request("POST", `/sections/${sectionGid}/addTask`, {
        body: { task: gid },
      });
    }
  }

  return renderTaskView(deps, gid, {});
}

function workspaceGidOfTask(task: TaskRecord): string | null {
  const workspace = task.workspace as Record<string, unknown> | undefined;
  return workspace?.gid ? String(workspace.gid) : null;
}

function firstProjectGidOfTask(task: TaskRecord): string | null {
  const memberships = task.memberships;
  if (!Array.isArray(memberships) || memberships.length === 0) return null;
  const project = (memberships[0] as Record<string, unknown>)?.project as
    | Record<string, unknown>
    | undefined;
  return project?.gid ? String(project.gid) : null;
}

async function moveTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--section": "value", "--project": "value" },
    "task move",
  );
  const gid = requireTaskGid(positionals, "move");
  const section = flagValue(flags, "--section");
  if (section === undefined) {
    throw new AxiError(
      "--section is required",
      "VALIDATION_ERROR",
      ['Example: asana-axi task move <gid> --section "In Progress"'],
    );
  }

  const { client } = openClient(deps);
  const current = await client.request<TaskRecord>(
    "GET",
    `/tasks/${gid}`,
    {
      query: {
        opt_fields: "gid,memberships.section.gid,memberships.section.name,memberships.project.gid",
      },
    },
  );

  const projectGid =
    flagValue(flags, "--project") !== undefined && isGid(flagValue(flags, "--project") as string)
      ? (flagValue(flags, "--project") as string)
      : firstProjectGidOfTask(current);
  if (projectGid === null) {
    throw new AxiError(
      "Task has no project membership - pass --project <gid> to resolve --section",
      "VALIDATION_ERROR",
      ["Run `asana-axi project list` to see the options"],
    );
  }
  const sectionGid = await resolveSectionGid(client, projectGid, section);

  const currentGid = sectionGidOf(current);
  const currentName = sectionNameOf(current);
  let message: string | undefined;
  if (currentGid === sectionGid) {
    message = `Already in ${JSON.stringify(currentName ?? section)} - no move needed`;
  } else {
    await client.request("POST", `/sections/${sectionGid}/addTask`, {
      body: { task: gid },
    });
  }

  const output = await renderTaskView(deps, gid, {});
  if (message !== undefined) {
    output.message = message;
  }
  return output;
}

async function setCompletion(
  args: string[],
  deps: CliDeps,
  complete: boolean,
): Promise<AxiStructuredOutput> {
  const sub = complete ? "complete" : "reopen";
  const { positionals } = parseFlags(args, {}, `task ${sub}`);
  const gid = requireTaskGid(positionals, sub);

  const { client } = openClient(deps);
  const current = await client.request<TaskRecord>(
    "GET",
    `/tasks/${gid}`,
    { query: { opt_fields: "gid,completed" } },
  );
  let message: string | undefined;
  if (current.completed === complete) {
    message = complete
      ? "Already completed - no change"
      : "Already open - no change";
  } else {
    await client.request("PUT", `/tasks/${gid}`, {
      body: { completed: complete },
    });
  }
  const output = await renderTaskView(deps, gid, {});
  if (message !== undefined) {
    output.message = message;
  }
  return output;
}

async function commentTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--text": "value", "--text-file": "value" },
    "task comment",
  );
  const gid = requireTaskGid(positionals, "comment");
  const text = await readTextFlag(flags, "--text", "--text-file", "task comment");
  if (text === undefined || text === "") {
    throw new AxiError(
      "--text (or --text-file) is required",
      "VALIDATION_ERROR",
      ['Example: asana-axi task comment <gid> --text "Deployed to staging"'],
    );
  }

  const { client } = openClient(deps);
  const story = await client.request<StoryRecord>(
    "POST",
    `/tasks/${gid}/stories`,
    { body: { text }, query: { opt_fields: "gid,text,created_at,created_by.name" } },
  );
  const task = await client.request<TaskRecord>("GET", `/tasks/${gid}`, {
    query: { opt_fields: "gid,name,completed" },
  });
  return stripNulls({
    task: {
      gid: gidOf(task),
      name: nameOf(task),
      completed: task.completed === true,
    },
    comment: {
      gid: gidOf(story),
      author:
        story.created_by && typeof story.created_by === "object"
          ? nameOf(story.created_by as Record<string, unknown>)
          : null,
      created_at: dateOnly(story.created_at),
      text: truncate(text, COMMENT_TRUNCATE_LENGTH, false, "--full on `task view`"),
    },
    help: [
      "Run `asana-axi task view " + gid + " --comments` to see the thread",
      "Run `asana-axi task attach " + gid + " --file <path>` to add a file",
    ],
  });
}

async function attachToTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--file": "value", "--comment": "value" },
    "task attach",
  );
  const gid = requireTaskGid(positionals, "attach");
  const file = flagValue(flags, "--file");
  if (file === undefined) {
    throw new AxiError(
      "--file is required",
      "VALIDATION_ERROR",
      ["Example: asana-axi task attach <gid> --file ./report.txt"],
    );
  }

  const { client } = openClient(deps);
  let attachment: Record<string, unknown>;
  try {
    attachment = await client.attach(gid, file);
  } catch (error) {
    const axi = toAxiError(error);
    if (
      (axi.code === "UNKNOWN" || axi.code === "VALIDATION_ERROR") &&
      /ENOENT|no such file/i.test(axi.message)
    ) {
      throw new AxiError(
        `File not found: ${JSON.stringify(file)}`,
        "VALIDATION_ERROR",
        ["Check the path and re-run"],
      );
    }
    throw axi;
  }

  let commentGid: string | null = null;
  const comment = flagValue(flags, "--comment");
  if (comment !== undefined) {
    const story = await client.request<StoryRecord>(
      "POST",
      `/tasks/${gid}/stories`,
      { body: { text: comment }, query: { opt_fields: "gid" } },
    );
    commentGid = gidOf(story);
  }

  return stripNulls({
    attachment: {
      gid: String(attachment.gid ?? ""),
      name: typeof attachment.name === "string" ? attachment.name : "",
      kind:
        typeof attachment.resource_subtype === "string"
          ? attachment.resource_subtype
          : null,
      host: typeof attachment.host === "string" ? attachment.host : null,
      url:
        typeof attachment.permanent_url === "string"
          ? attachment.permanent_url
          : null,
      task: gid,
      ...(commentGid !== null ? { comment_gid: commentGid } : {}),
    },
    help: [
      "Run `asana-axi task view " + gid + " --attachments` to list files on the task",
      "Run `asana-axi task comment " + gid + " --text \"<text>\"` to add a note",
    ],
  });
}

async function searchTasks(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    {
      "--workspace": "value",
      "--completed": "boolean",
      "--limit": "value",
      "--fields": "value",
    },
    "task search",
  );
  if (positionals.length === 0) {
    throw new AxiError(
      "Missing search text",
      "VALIDATION_ERROR",
      ['Example: asana-axi task search "checkout redesign"'],
    );
  }
  if (positionals.length > 1) {
    throw new AxiError(
      "Search text is a single quoted argument",
      "VALIDATION_ERROR",
      ['Example: asana-axi task search "checkout redesign"'],
    );
  }
  const text = positionals[0] as string;

  const { client, config } = openClient(deps);
  const workspaceGid = await resolveWorkspaceGid(
    client,
    config,
    flagValue(flags, "--workspace"),
  );
  const limit = parseLimit(flags, 30);
  const fields = new Set(splitCsv(flagValue(flags, "--fields")));

  const { items, hasMore } = await client.collect<TaskRecord>(
    `/workspaces/${workspaceGid}/tasks/search`,
    {
      limit,
      query: {
        text,
        opt_fields: LIST_OPT_FIELDS,
        ...(flagBoolean(flags, "--completed") ? { completed: "true" } : {}),
      },
    },
  );

  const rows = items.map((task) => taskRow(task, fields, false));
  return stripNulls({
    query: text,
    count: rows.length,
    ...(hasMore ? { has_more: true } : {}),
    tasks: rows,
    ...(rows.length === 0
      ? { note: "0 tasks matched - try different or shorter search terms" }
      : {}),
    help: [
      "Run `asana-axi task view <gid> --comments` for one result",
      "Run `asana-axi task list --project <gid|name>` to browse a project instead",
    ],
  });
}

async function listSubtasks(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--limit": "value", "--completed": "boolean", "--fields": "value" },
    "task subtasks",
  );
  const gid = requireTaskGid(positionals, "subtasks");
  const limit = parseLimit(flags, 30);
  const fields = new Set(splitCsv(flagValue(flags, "--fields")));

  const { client } = openClient(deps);
  const { items, hasMore } = await client.collect<TaskRecord>(
    `/tasks/${gid}/subtasks`,
    { limit, query: { opt_fields: LIST_OPT_FIELDS } },
  );
  const filtered = flagBoolean(flags, "--completed")
    ? items.filter((task) => task.completed === true)
    : items;
  const rows = filtered.map((task) => taskRow(task, fields, false));
  return stripNulls({
    parent: gid,
    count: rows.length,
    ...(hasMore ? { has_more: true } : {}),
    subtasks: rows,
    ...(rows.length === 0
      ? { note: "0 subtasks - add one with `task create --parent <gid> --name \"<text>\"`" }
      : {}),
    help: [
      "Run `asana-axi task view <subtask gid>` for one",
      "Run `asana-axi task create --parent " + gid + " --name \"<text>\"` to add one",
    ],
  });
}

async function deleteTask(
  args: string[],
  deps: CliDeps,
): Promise<AxiStructuredOutput> {
  const { flags, positionals } = parseFlags(
    args,
    { "--confirm": "boolean" },
    "task delete",
  );
  const gid = requireTaskGid(positionals, "delete");
  if (!flagBoolean(flags, "--confirm")) {
    throw new AxiError(
      `Deleting a task in Asana is permanent - pass --confirm to delete ${gid}`,
      "CONFIRMATION_REQUIRED",
      [
        "Re-run with --confirm once you are sure",
        "To close without deleting, use `asana-axi task complete " + gid + "`",
      ],
    );
  }
  const { client } = openClient(deps);
  await client.request("DELETE", `/tasks/${gid}`);
  return {
    deleted: gid,
    help: [
      "Run `asana-axi task list` to confirm it is gone",
      "Asana deletions are permanent - recreate with `task create` if needed",
    ],
  };
}
