import { describe, expect, it } from "vitest";
import { projectCommand } from "../../src/commands/project.js";
import { homeCommand } from "../../src/commands/home.js";
import { meCommand } from "../../src/commands/me.js";
import { workspaceCommand } from "../../src/commands/workspace.js";
import { tagCommand } from "../../src/commands/tag.js";
import {
  createFakeFetch,
  fakeDeps,
  PROJECT_GID,
  standardRoutes,
  WORKSPACE_GID,
} from "../helpers/asanaFake.js";

describe("project list", () => {
  it("lists projects with count and workspace echo", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await projectCommand(["list"], deps);
    expect(output.workspace).toBe(WORKSPACE_GID);
    expect(output.count).toBe(1);
    expect(output.projects).toEqual([
      { gid: PROJECT_GID, name: "Website" },
    ]);
  });
});

describe("project view", () => {
  it("embeds the pre-completed task_counts aggregate", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await projectCommand(["view", PROJECT_GID], deps);
    const project = output.project as Record<string, unknown>;
    expect(project.task_counts).toEqual({
      total: 12,
      incomplete: 10,
      completed: 2,
    });
  });
});

describe("project sections", () => {
  it("lists board columns with count", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await projectCommand(["sections", PROJECT_GID], deps);
    expect(output.count).toBe(2);
    expect(output.sections).toEqual([
      { gid: "1200000000000301", name: "Backlog" },
      { gid: "1200000000000302", name: "In Progress" },
    ]);
  });
});

describe("workspace list", () => {
  it("lists workspaces reachable from the token", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await workspaceCommand(["list"], deps);
    expect(output.count).toBe(1);
    expect((output.help as string[]).join(" ")).toContain(
      "ASANA_WORKSPACE_ID",
    );
  });
});

describe("tag commands", () => {
  it("tag list renders rows and count", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await tagCommand(["list"], deps);
    expect(output.count).toBe(2);
    expect(output.tags).toEqual([
      { gid: "1200000000000502", name: "bug" },
      { gid: "1200000000000501", name: "frontend" },
    ]);
  });

  it("tag create is idempotent when the name exists", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await tagCommand(["create", "--name", "bug"], deps);
    expect(output.message).toContain("already exists");
    expect(fake.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("me", () => {
  it("reports auth, user, and workspaces with GIDs", async () => {
    const fake = createFakeFetch(standardRoutes());
    const deps = fakeDeps(fake.fetch);
    const output = await meCommand([], deps);
    expect(output.auth).toBe("ok");
    expect(output.workspaces).toEqual([
      { gid: WORKSPACE_GID, name: "Test Workspace" },
    ]);
  });
});

describe("home", () => {
  it("shows live state: user, workspaces, my tasks, default project counts", async () => {
    const fake = createFakeFetch([
      ...standardRoutes(),
      {
        method: "GET",
        path: "tasks",
        respond: ({ query }) => {
          if (query.get("assignee") === "me") return [];
          return [undefined];
        },
      },
    ]);
    const deps = fakeDeps(fake.fetch, {
      ASANA_PROJECT_ID: PROJECT_GID,
      ASANA_WORKSPACE_ID: WORKSPACE_GID,
    });
    const output = await homeCommand([], deps);
    expect(output.auth).toBe("ok");
    expect(output.user).toBe("Test User");
    expect(output.my_tasks).toEqual([]);
    expect(output.my_tasks_count).toBe(0);
    expect(output.default_project).toMatchObject({
      gid: PROJECT_GID,
      incomplete: 10,
      completed: 2,
    });
  });

  it("degrades to a definitive auth error block (never a crash)", async () => {
    const fake = createFakeFetch([
      {
        method: "GET",
        path: "users/me",
        respond: () => ({
          status: 401,
          body: { errors: [{ message: "Not Authorized" }] },
        }),
      },
    ]);
    const deps = fakeDeps(fake.fetch);
    const output = await homeCommand([], deps);
    expect(output.auth).toBe("error");
    expect(String(output.error)).toContain("Unauthorized");
  });
});
