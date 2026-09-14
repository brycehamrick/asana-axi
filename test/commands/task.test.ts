import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { taskCommand } from "../../src/commands/task.js";
import {
  createFakeFetch,
  fakeDeps,
  fixtureTaskDone,
  fixtureTaskOpen,
  PROJECT_GID,
  SECTION_BACKLOG,
  SECTION_WIP,
  standardRoutes,
  TAG_BUG,
  TAG_FRONTEND,
  TASK_DONE,
  TASK_OPEN,
  WORKSPACE_GID,
  type FakeRoute,
} from "../helpers/asanaFake.js";

function setup(extraRoutes: FakeRoute[] = []) {
  const fake = createFakeFetch([...standardRoutes(), ...extraRoutes]);
  return { fake, deps: fakeDeps(fake.fetch) };
}

function listOutput(output: Record<string, unknown>) {
  return output.tasks as Record<string, unknown>[];
}

describe("task list", () => {
  it("renders the 5 default columns with count and follow-up help", async () => {
    const { deps } = setup();
    const output = await taskCommand(
      ["list", "--project", PROJECT_GID],
      deps,
    );
    expect(output.count).toBe(2);
    expect(output.has_more).toBeUndefined();
    const rows = listOutput(output);
    expect(rows[0]).toMatchObject({
      gid: TASK_OPEN,
      name: "Fix login bug",
      section: "In Progress",
      due_on: "2026-01-15",
      completed: false,
    });
    expect((output.help as string[]).join(" ")).toContain("task view <gid>");
  });

  it("filters to incomplete by default via completed_since=now", async () => {
    const { fake, deps } = setup();
    await taskCommand(["list", "--project", PROJECT_GID], deps);
    const call = fake.calls.find((c) => c.path === "tasks");
    expect(call?.query.get("completed_since")).toBe("now");
  });

  it("--completed keeps only completed tasks", async () => {
    const { deps } = setup();
    const output = await taskCommand(
      ["list", "--project", PROJECT_GID, "--completed"],
      deps,
    );
    expect(output.count).toBe(1);
    expect(listOutput(output)[0]).toMatchObject({
      gid: TASK_DONE,
      completed: true,
    });
  });

  it("resolves --project by name within the workspace", async () => {
    const { deps } = setup();
    const output = await taskCommand(["list", "--project", "Website"], deps);
    expect(output.count).toBe(2);
  });

  it("emits a definitive empty state (count: 0, tasks: [], note)", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "GET",
        path: "workspaces/1200000000000999/projects",
        respond: () => [{ gid: "1200000000000998", name: "Empty" }],
      },
      {
        method: "GET",
        path: "tasks",
        respond: ({ query }) =>
          query.get("project") === "1200000000000998" ? [] : undefined,
      },
    ]);
    const deps = fakeDeps(fake.fetch, { ASANA_WORKSPACE_ID: WORKSPACE_GID });
    const output = await taskCommand(
      ["list", "--project", "1200000000000998"],
      deps,
    );
    expect(output.count).toBe(0);
    expect(output.tasks).toEqual([]);
    expect(output.note).toContain("0 tasks matched");
  });

  it("fails loud (exit 2 semantics) on unknown flags", async () => {
    const { deps } = setup();
    await expect(
      taskCommand(["list", "--project", PROJECT_GID, "--srt"], deps),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("task view", () => {
  it("renders the detail object with url, tags, and counts", async () => {
    const { deps } = setup();
    const output = await taskCommand(["view", TASK_OPEN], deps);
    const task = output.task as Record<string, unknown>;
    expect(task).toMatchObject({
      gid: TASK_OPEN,
      name: "Fix login bug",
      completed: false,
      due_on: "2026-01-15",
      tags: ["bug"],
      subtasks_count: 2,
      url: `https://app.asana.com/0/0/${TASK_OPEN}/f`,
    });
  });

  it("--comments shows only comment-type stories with a count", async () => {
    const { deps } = setup();
    const output = await taskCommand(
      ["view", TASK_OPEN, "--comments"],
      deps,
    );
    expect(output.comments_count).toBe(1);
    const comments = output.comments as Record<string, unknown>[];
    expect(comments[0]).toMatchObject({
      text: "Deployed to staging",
      author: "Test User",
    });
  });

  it("--limit without --comments is a VALIDATION_ERROR, not a silent ignore", async () => {
    const { deps } = setup();
    await expect(
      taskCommand(["view", TASK_OPEN, "--limit", "10"], deps),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("--fields renders only the requested columns (gid always kept)", async () => {
    const { deps } = setup();
    const output = await taskCommand(
      ["view", TASK_OPEN, "--fields", "name,assignee"],
      deps,
    );
    expect(Object.keys(output.task as Record<string, unknown>)).toEqual([
      "gid",
      "name",
      "assignee",
    ]);
  });
});

describe("task create", () => {
  it("creates, applies section + tags, then re-fetches the post-state", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "POST",
        path: "tasks",
        respond: () => ({ gid: "1200000000000801" }),
      },
      {
        method: "GET",
        path: "tasks/1200000000000801",
        respond: () => ({
          ...fixtureTaskOpen(),
          gid: "1200000000000801",
          name: "New task",
        }),
      },
      {
        method: "POST",
        path: `sections/${SECTION_BACKLOG}/addTask`,
        respond: () => ({}),
      },
      {
        method: "POST",
        path: "tasks/1200000000000801/addTag",
        respond: () => ({}),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(
      [
        "create",
        "--name",
        "New task",
        "--project",
        "Website",
        "--section",
        "Backlog",
        "--tags",
        "frontend",
      ],
      deps,
    );
    expect((output.task as Record<string, unknown>).gid).toBe(
      "1200000000000801",
    );
    const sectionCall = fake.calls.find(
      (c) => c.path === `sections/${SECTION_BACKLOG}/addTask`,
    );
    expect(sectionCall?.body).toEqual({ task: "1200000000000801" });
    const tagCall = fake.calls.find(
      (c) => c.path === "tasks/1200000000000801/addTag",
    );
    expect(tagCall?.body).toEqual({ tag: TAG_FRONTEND });
  });

  it("requires --name", async () => {
    const { deps } = setup();
    await expect(
      taskCommand(["create", "--project", PROJECT_GID], deps),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects --notes together with --notes-file", async () => {
    const { deps } = setup();
    await expect(
      taskCommand(
        [
          "create",
          "--name",
          "x",
          "--project",
          PROJECT_GID,
          "--notes",
          "a",
          "--notes-file",
          "/tmp/x",
        ],
        deps,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("task edit", () => {
  it("PUTs only the provided fields, moves sections, and re-renders", async () => {
    const fake = createFakeFetch([
      // Custom GET must precede standardRoutes() - the router picks the
      // first matching route, and the standard fixture returns the old name.
      {
        method: "GET",
        path: `tasks/${TASK_OPEN}`,
        respond: () => ({ ...fixtureTaskOpen(), name: "Renamed" }),
      },
      ...standardRoutes(),
      {
        method: "PUT",
        path: `tasks/${TASK_OPEN}`,
        respond: () => ({ ...fixtureTaskOpen(), name: "Renamed" }),
      },
      {
        method: "POST",
        path: `sections/${SECTION_BACKLOG}/addTask`,
        respond: () => ({}),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(
      ["edit", TASK_OPEN, "--name", "Renamed", "--section", "Backlog"],
      deps,
    );
    const put = fake.calls.find(
      (c) => c.method === "PUT" && c.path === `tasks/${TASK_OPEN}`,
    );
    expect(put?.body).toEqual({ name: "Renamed" });
    expect((output.task as Record<string, unknown>).name).toBe("Renamed");
  });

  it("requires at least one mutation flag", async () => {
    const { deps } = setup();
    await expect(taskCommand(["edit", TASK_OPEN], deps)).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
  });

  it("--assignee \"\" sends null (unassign)", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "PUT",
        path: `tasks/${TASK_OPEN}`,
        respond: () => fixtureTaskOpen(),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    await taskCommand(["edit", TASK_OPEN, "--assignee", ""], deps);
    const put = fake.calls.find(
      (c) => c.method === "PUT" && c.path === `tasks/${TASK_OPEN}`,
    );
    expect(put?.body).toEqual({ assignee: null });
  });

  it("skips --tags the task already has (idempotent no-op)", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "PUT",
        path: `tasks/${TASK_OPEN}`,
        respond: () => fixtureTaskOpen(),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    await taskCommand(["edit", TASK_OPEN, "--tags", "bug"], deps);
    const addTagCalls = fake.calls.filter((c) => c.path.endsWith("/addTag"));
    expect(addTagCalls).toHaveLength(0);
  });
});

describe("task move", () => {
  it("is a no-op success when the task is already in the section", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(
      ["move", TASK_OPEN, "--section", "In Progress"],
      deps,
    );
    expect(output.message).toContain("Already in");
    expect(
      fake.calls.filter((c) => c.path.endsWith("/addTask")),
    ).toHaveLength(0);
  });

  it("requires --section", async () => {
    const { deps } = setup();
    await expect(taskCommand(["move", TASK_OPEN], deps)).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
  });
});

describe("task complete / reopen", () => {
  it("complete on a completed task is a no-op success", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(["complete", TASK_DONE], deps);
    expect(output.message).toContain("Already completed");
    expect(fake.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("reopen on an open task is a no-op success", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(["reopen", TASK_OPEN], deps);
    expect(output.message).toContain("Already open");
  });

  it("complete PUTs completed:true when open", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "PUT",
        path: `tasks/${TASK_OPEN}`,
        respond: () => ({ ...fixtureTaskOpen(), completed: true }),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    await taskCommand(["complete", TASK_OPEN], deps);
    const put = fake.calls.find(
      (c) => c.method === "PUT" && c.path === `tasks/${TASK_OPEN}`,
    );
    expect(put?.body).toEqual({ completed: true });
  });
});

describe("task comment", () => {
  it("posts the story and renders the created comment", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "POST",
        path: `tasks/${TASK_OPEN}/stories`,
        respond: () => ({
          gid: "1200000000000703",
          type: "commented",
          text: "Shipped",
          created_at: "2026-09-14T09:00:00.000Z",
          created_by: { name: "Test User" },
        }),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(
      ["comment", TASK_OPEN, "--text", "Shipped"],
      deps,
    );
    const post = fake.calls.find(
      (c) => c.method === "POST" && c.path === `tasks/${TASK_OPEN}/stories`,
    );
    expect(post?.body).toEqual({ text: "Shipped" });
    expect(output.comment).toMatchObject({ text: "Shipped" });
  });

  it("requires exactly one of --text / --text-file", async () => {
    const { deps } = setup();
    await expect(taskCommand(["comment", TASK_OPEN], deps)).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
  });
});

describe("task search", () => {
  it("echoes the query, counts results, and requires text", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "GET",
        path: `workspaces/${WORKSPACE_GID}/tasks/search`,
        respond: () => [fixtureTaskOpen()],
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(["search", "login"], deps);
    expect(output.query).toBe("login");
    expect(output.count).toBe(1);
    await expect(taskCommand(["search"], deps)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("task delete", () => {
  it("is gated behind --confirm", async () => {
    const { deps } = setup();
    try {
      await taskCommand(["delete", TASK_OPEN], deps);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("CONFIRMATION_REQUIRED");
      expect((error as AxiError).message).toContain("--confirm");
    }
  });

  it("deletes with --confirm and reports the GID", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "DELETE",
        path: `tasks/${TASK_OPEN}`,
        respond: () => ({}),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(["delete", TASK_OPEN, "--confirm"], deps);
    expect(output.deleted).toBe(TASK_OPEN);
  });
});

describe("task subtasks", () => {
  it("lists subtasks under the parent key", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "GET",
        path: `tasks/${TASK_OPEN}/subtasks`,
        respond: () => [
          { gid: "1200000000000901", name: "Child", completed: false },
        ],
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await taskCommand(["subtasks", TASK_OPEN], deps);
    expect(output.parent).toBe(TASK_OPEN);
    expect(output.count).toBe(1);
  });
});

describe("unknown subcommands and bad GIDs", () => {
  it("suggests the closest subcommand", async () => {
    const { deps } = setup();
    try {
      await taskCommand(["lst"], deps);
      expect.unreachable();
    } catch (error) {
      expect((error as AxiError).suggestions.join(" ")).toContain(
        "Did you mean `list`?",
      );
    }
  });

  it("rejects non-numeric task GIDs", async () => {
    const { deps } = setup();
    await expect(taskCommand(["view", "website"], deps)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
