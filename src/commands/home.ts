import type { AxiStructuredOutput } from "../render.js";
import { openClient, type CliDeps } from "../context.js";
import { toAxiError } from "../errors.js";
import {
  dateOnly,
  gidOf,
  isOverdue,
  nameOf,
  sectionNameOf,
  stripNulls,
  type ProjectRecord,
  type TaskRecord,
  type UserRecord,
} from "../render.js";

/**
 * Content-first home view (AXI principle 8): live state, not help text.
 * Auth problems degrade to a definitive error block with next steps instead
 * of killing the dashboard.
 */
export async function homeCommand(
  args: string[],
  deps: CliDeps | undefined,
): Promise<AxiStructuredOutput> {
  void args;
  try {
    const { client, config } = openClient(deps ?? {});
    const user = await client.request<UserRecord>("GET", "/users/me", {
      query: { opt_fields: "gid,name,email,workspaces.name,workspaces.gid" },
    });
    const workspaces = Array.isArray(user.workspaces) ? user.workspaces : [];
    const output: AxiStructuredOutput = {
      auth: "ok",
      user: typeof user.name === "string" ? user.name : "",
      workspaces: workspaces.map((workspace) => {
        const record = workspace as Record<string, unknown>;
        return typeof record.name === "string" ? record.name : "";
      }),
    };

    // My open tasks in the effective workspace (env default or the only one).
    const workspaceGid =
      config.workspaceId ??
      (workspaces.length === 1 && workspaces[0]
        ? String((workspaces[0] as Record<string, unknown>).gid ?? "")
        : undefined);
    if (workspaceGid !== undefined) {
      const { items, hasMore } = await client.collect<TaskRecord>("/tasks", {
        limit: 10,
        query: {
          assignee: "me",
          completed_since: "now",
          workspace: workspaceGid,
          opt_fields:
            "gid,name,due_on,due_at,memberships.section.name,memberships.project.name",
        },
      });
      const overdue = items.filter((task) =>
        isOverdue(dateOnly(task.due_on ?? task.due_at)),
      ).length;
      output.my_tasks = items.map((task) => ({
        gid: gidOf(task),
        name: nameOf(task),
        section: sectionNameOf(task),
        due_on: dateOnly(task.due_on ?? task.due_at),
      }));
      output.my_tasks_count = hasMore ? `${items.length}+` : items.length;
      if (overdue > 0) {
        output.my_tasks_overdue = overdue;
      }
    }

    // Default project board summary when ASANA_PROJECT_ID is set.
    if (config.projectId) {
      try {
        const counts = await client.request<Record<string, unknown>>(
          "GET",
          `/projects/${config.projectId}/task_counts`,
        );
        const project = await client.request<ProjectRecord>(
          "GET",
          `/projects/${config.projectId}`,
          { query: { opt_fields: "gid,name" } },
        );
        output.default_project = {
          gid: gidOf(project),
          name: nameOf(project),
          incomplete:
            typeof counts.num_incomplete_tasks === "number"
              ? counts.num_incomplete_tasks
              : null,
          completed:
            typeof counts.num_completed_tasks === "number"
              ? counts.num_completed_tasks
              : null,
        };
      } catch {
        // A stale ASANA_PROJECT_ID must not break the dashboard.
        output.default_project = { error: "project not reachable" };
      }
    }

    output.help = [
      "Run `asana-axi task list` for the default project's open tasks",
      "Run `asana-axi task view <gid> --comments` for one task",
      "Run `asana-axi project list` to browse projects",
      "Run `asana-axi --help` for all commands",
    ];
    return stripNulls(output);
  } catch (error) {
    const axi = toAxiError(error);
    if (axi.code === "AUTH_REQUIRED" || axi.code === "NETWORK_ERROR") {
      return stripNulls({
        auth: "error",
        error: axi.message,
        ...(axi.suggestions.length > 0 ? { help: axi.suggestions } : {}),
      });
    }
    throw axi;
  }
}
