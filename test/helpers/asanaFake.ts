import type { FetchLike } from "../../src/asana.js";

/**
 * Fixture-backed fake Asana API for tests: zero network, real Response
 * objects. GIDs are obviously-fake (1200000000000xxx) - never real data.
 */export const FAKE_TOKEN = "fake-token-1/234567890abcdef";

export interface FakeCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface FakeRoute {
  method: string;
  /** Exact path (query string excluded) to match. */
  path: string;
  /** Response payload: `{ data, next_page }` envelope is added automatically. */
  respond: (context: { query: URLSearchParams; body: unknown }) => unknown;
  status?: number;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: FakeCall[];
}

export function createFakeFetch(routes: FakeRoute[]): FakeFetch {
  const calls: FakeCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/+/, "");
    // The client targets https://app.asana.com/api/1.0/<path>; pathname starts at /api.
    const stripped = path.replace(/^api\/1\.0\/?/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    let parsed: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        parsed = JSON.parse(init.body);
      } catch {
        parsed = init.body;
      }
    }
    // The client wraps JSON bodies in { data: ... } per the Asana contract;
    // record and hand routes the unwrapped payload.
    const body =
      parsed !== null &&
      typeof parsed === "object" &&
      "data" in parsed &&
      Object.keys(parsed as Record<string, unknown>).length === 1
        ? (parsed as { data?: unknown }).data
        : parsed;
    calls.push({
      method,
      path: stripped,
      query: url.searchParams,
      body,
    });

    const route = routes.find(
      (candidate) => candidate.method === method && candidate.path === stripped,
    );
    if (!route) {
      return jsonResponse(404, {
        errors: [{ message: `No test route for ${method} /${stripped}` }],
      });
    }
    const payload = route.respond({ query: url.searchParams, body });
    if (isRawResponse(payload)) {
      return jsonResponse(payload.status, payload.body);
    }
    // A payload shaped like {data, next_page} is already a full envelope.
    if (isFullEnvelope(payload)) {
      return jsonResponse(route.status ?? 200, payload);
    }
    return jsonResponse(route.status ?? 200, { data: payload });
  };
  return { fetch, calls };
}

function isFullEnvelope(payload: unknown): payload is Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return false;
  const keys = Object.keys(payload);
  return keys.includes("data") && keys.every((key) => key === "data" || key === "next_page");
}

function isRawResponse(
  payload: unknown,
): payload is { status: number; body: unknown } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "status" in payload &&
    "body" in payload
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Keep retry tests instant: never sleep on fake rate limits.
      ...(status === 429 || status === 503 ? { "retry-after": "0" } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Fixture records (fake GIDs only)
// ---------------------------------------------------------------------------

export const WORKSPACE_GID = "1200000000000100";
export const PROJECT_GID = "1200000000000200";
export const SECTION_BACKLOG = "1200000000000301";
export const SECTION_WIP = "1200000000000302";
export const TASK_OPEN = "1200000000000401";
export const TASK_DONE = "1200000000000402";
export const TAG_FRONTEND = "1200000000000501";
export const TAG_BUG = "1200000000000502";

export function fixtureUser(): Record<string, unknown> {
  return {
    gid: "1200000000000601",
    name: "Test User",
    email: "test@example.com",
    workspaces: [{ gid: WORKSPACE_GID, name: "Test Workspace" }],
  };
}

export function fixtureTaskOpen(): Record<string, unknown> {
  return {
    gid: TASK_OPEN,
    name: "Fix login bug",
    completed: false,
    due_on: "2026-01-15",
    notes: "Body of the task\nwith two lines",
    assignee: { gid: "1200000000000601", name: "Test User" },
    tags: [{ gid: TAG_BUG, name: "bug" }],
    workspace: { gid: WORKSPACE_GID },
    memberships: [
      {
        project: { gid: PROJECT_GID, name: "Website" },
        section: { gid: SECTION_WIP, name: "In Progress" },
      },
    ],
    num_subtasks: 2,
    modified_at: "2026-09-01T10:00:00.000Z",
  };
}

export function fixtureTaskDone(): Record<string, unknown> {
  return {
    gid: TASK_DONE,
    name: "Ship dark mode",
    completed: true,
    due_on: "2026-08-01",
    notes: "",
    assignee: null,
    tags: [],
    memberships: [
      {
        project: { gid: PROJECT_GID, name: "Website" },
        section: { gid: SECTION_BACKLOG, name: "Backlog" },
      },
    ],
    num_subtasks: 0,
    modified_at: "2026-08-02T10:00:00.000Z",
  };
}

export function standardRoutes(): FakeRoute[] {
  return [
    {
      method: "GET",
      path: "users/me",
      respond: () => fixtureUser(),
    },
    {
      method: "GET",
      path: "workspaces",
      respond: () => [{ gid: WORKSPACE_GID, name: "Test Workspace" }],
    },
    {
      method: "GET",
      path: `workspaces/${WORKSPACE_GID}/projects`,
      respond: () => [
        { gid: PROJECT_GID, name: "Website", archived: false },
      ],
    },
    {
      method: "GET",
      path: `projects/${PROJECT_GID}`,
      respond: () => ({
        gid: PROJECT_GID,
        name: "Website",
        notes: "Marketing site",
        archived: false,
        owner: { name: "Test User" },
        workspace: { name: "Test Workspace" },
        modified_at: "2026-09-10T10:00:00.000Z",
      }),
    },
    {
      method: "GET",
      path: `projects/${PROJECT_GID}/task_counts`,
      respond: () => ({
        num_tasks: 12,
        num_completed_tasks: 2,
        num_incomplete_tasks: 10,
        num_sections: 3,
        num_milestones: 0,
      }),
    },
    {
      method: "GET",
      path: `projects/${PROJECT_GID}/sections`,
      respond: () => [
        { gid: SECTION_BACKLOG, name: "Backlog" },
        { gid: SECTION_WIP, name: "In Progress" },
      ],
    },
    {
      method: "GET",
      path: `workspaces/${WORKSPACE_GID}/tags`,
      respond: () => [
        { gid: TAG_BUG, name: "bug" },
        { gid: TAG_FRONTEND, name: "frontend" },
      ],
    },
    {
      method: "GET",
      path: "tasks",
      respond: ({ query }) => {
        const project = query.get("project");
        if (project === PROJECT_GID) {
          return [fixtureTaskOpen(), fixtureTaskDone()];
        }
        return [];
      },
    },
    {
      method: "GET",
      path: `tasks/${TASK_OPEN}`,
      respond: () => fixtureTaskOpen(),
    },
    {
      method: "GET",
      path: `tasks/${TASK_DONE}`,
      respond: () => fixtureTaskDone(),
    },
    {
      method: "GET",
      path: `tasks/${TASK_OPEN}/stories`,
      respond: () => [
        {
          gid: "1200000000000701",
          type: "commented",
          text: "Deployed to staging",
          created_at: "2026-09-12T09:00:00.000Z",
          created_by: { gid: "1200000000000601", name: "Test User" },
        },
        {
          gid: "1200000000000702",
          type: "assigned",
          text: "assigned to Test User (system)",
          created_at: "2026-09-11T09:00:00.000Z",
          created_by: { gid: "1200000000000601", name: "Test User" },
        },
      ],
    },
  ];
}

/** Test deps wired to the fake API (isolated env + cwd, no real ./.env). */
export function fakeDeps(
  fetch: FetchLike,
  env: Record<string, string> = {},
): {
  env: Record<string, string>;
  cwd: string;
  fetchImpl: FetchLike;
} {
  return {
    env: { ...env, ASANA_ACCESS_TOKEN: FAKE_TOKEN },
    cwd: "/nonexistent-no-env-file",
    fetchImpl: fetch,
  };
}
