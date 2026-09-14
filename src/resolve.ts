import { AxiError } from "axi-sdk-js";
import type { AsanaClient } from "./asana.js";
import type { AsanaConfig } from "./config.js";
import { isGid, nameOf, type ProjectRecord, type SectionRecord, type TagRecord, type WorkspaceRecord } from "./render.js";

/**
 * Name-to-GID resolution so agents can address projects, sections, and tags
 * by human name (the ergonomic path) or raw GID (the exact path).
 * Asana GIDs are long numeric strings; anything else is treated as a name.
 */

export interface WorkspaceRef {
  gid: string;
  name: string;
}

export async function listWorkspaces(
  client: AsanaClient,
): Promise<WorkspaceRef[]> {
  const { items } = await client.collect<WorkspaceRecord>("/workspaces", {
    limit: 100,
    query: { opt_fields: "gid,name,is_organization" },
  });
  return items.map((workspace) => ({
    gid: String(workspace.gid ?? ""),
    name: nameOf(workspace),
  }));
}

/**
 * Resolve the effective workspace GID: flag > env > single-workspace
 * autodetect. Ambiguity is a VALIDATION_ERROR that names the options.
 */
export async function resolveWorkspaceGid(
  client: AsanaClient,
  config: AsanaConfig,
  flag: string | undefined,
): Promise<string> {
  const candidate = flag ?? config.workspaceId;
  if (candidate) {
    return isGid(candidate) ? candidate : await workspaceByName(client, candidate);
  }
  const workspaces = await listWorkspaces(client);
  if (workspaces.length === 1 && workspaces[0]) {
    return workspaces[0].gid;
  }
  if (workspaces.length === 0) {
    throw new AxiError(
      "No workspaces are reachable from this token",
      "NOT_FOUND",
      [
        "Verify the personal access token is valid: `asana-axi me`",
        "The token's account may not belong to any workspace",
      ],
    );
  }
  throw new AxiError(
    `No workspace selected - ${workspaces.length} workspaces are reachable from this token`,
    "VALIDATION_ERROR",
    [
      "Pass --workspace <gid> (or --workspace <name>)",
      "Or set ASANA_WORKSPACE_ID in the environment / ./.env",
      "Run `asana-axi workspace list` to see the options",
    ],
  );
}

async function workspaceByName(
  client: AsanaClient,
  name: string,
): Promise<string> {
  const workspaces = await listWorkspaces(client);
  return matchByName(
    workspaces.map((workspace) => ({ gid: workspace.gid, name: workspace.name })),
    name,
    "workspace",
  );
}

export interface NameMatch {
  gid: string;
  name: string;
}

/** Exact case-insensitive match first, then unique substring match. */
export function matchByName(
  candidates: NameMatch[],
  name: string,
  kind: string,
): string {
  const lower = name.trim().toLowerCase();
  const exact = candidates.filter(
    (candidate) => candidate.name.toLowerCase() === lower,
  );
  if (exact.length === 1 && exact[0]) return exact[0].gid;
  if (exact.length > 1) {
    throw ambiguousError(kind, name, exact);
  }
  const partial = candidates.filter((candidate) =>
    candidate.name.toLowerCase().includes(lower),
  );
  if (partial.length === 1 && partial[0]) return partial[0].gid;
  if (partial.length > 1) {
    throw ambiguousError(kind, name, partial);
  }
  throw new AxiError(
    `${kind} not found: ${JSON.stringify(name)}`,
    "NOT_FOUND",
    ["List the options first (`workspace list`, `project list`, `project sections <gid>`, `tag list`)"],
  );
}

function ambiguousError(kind: string, name: string, matches: NameMatch[]): AxiError {
  const shown = matches
    .slice(0, 5)
    .map((match) => `${match.gid} ${match.name}`)
    .join("; ");
  return new AxiError(
    `Ambiguous ${kind} name: ${JSON.stringify(name)} matches ${matches.length} (${shown}${matches.length > 5 ? ", ..." : ""})`,
    "VALIDATION_ERROR",
    ["Use the GID instead of the name, or a more specific name"],
  );
}

/**
 * Resolve a project reference: GID passthrough, else name search inside the
 * workspace. Falls back to ASANA_PROJECT_ID when no flag is given.
 * `workspaceRef` may be a GID, a name, or undefined (env/autodetect).
 */
export async function resolveProjectGid(
  client: AsanaClient,
  config: AsanaConfig,
  flag: string | undefined,
  workspaceRef?: string,
): Promise<string> {
  const candidate = flag ?? config.projectId;
  if (!candidate) {
    throw new AxiError(
      "No project selected",
      "VALIDATION_ERROR",
      [
        "Pass --project <gid|name>",
        "Or set ASANA_PROJECT_ID in the environment / ./.env",
        "Run `asana-axi project list` to see the options",
      ],
    );
  }
  if (isGid(candidate)) return candidate;
  const workspace = await resolveWorkspaceGid(client, config, workspaceRef);
  const { items } = await client.collect<ProjectRecord>(
    `/workspaces/${workspace}/projects`,
    { limit: 200, query: { opt_fields: "gid,name,archived" } },
  );
  return matchByName(
    items.map((project) => ({
      gid: String(project.gid ?? ""),
      name: nameOf(project),
    })),
    candidate,
    "project",
  );
}

/** Resolve a section by GID or by name within a project. */
export async function resolveSectionGid(
  client: AsanaClient,
  projectGid: string,
  nameOrGid: string,
): Promise<string> {
  if (isGid(nameOrGid)) return nameOrGid;
  const { items } = await client.collect<SectionRecord>(
    `/projects/${projectGid}/sections`,
    { limit: 100, query: { opt_fields: "gid,name" } },
  );
  return matchByName(
    items.map((section) => ({
      gid: String(section.gid ?? ""),
      name: nameOf(section),
    })),
    nameOrGid,
    "section",
  );
}

/** Find a tag GID by name in the workspace; null when absent. */
export async function findTagGid(
  client: AsanaClient,
  workspaceGid: string,
  name: string,
): Promise<string | null> {
  if (isGid(name)) return name;
  const { items } = await client.collect<TagRecord>(
    `/workspaces/${workspaceGid}/tags`,
    { limit: 200, query: { opt_fields: "gid,name" } },
  );
  const lower = name.toLowerCase();
  const tag = items.find((candidate) => nameOf(candidate).toLowerCase() === lower);
  return tag ? String(tag.gid ?? "") : null;
}

/**
 * Find or create a tag (idempotent). Returns the GID and whether it was
 * created, so `task edit --add-tags` can report honest no-ops.
 */
export async function ensureTag(
  client: AsanaClient,
  workspaceGid: string,
  name: string,
): Promise<{ gid: string; created: boolean }> {
  const existing = await findTagGid(client, workspaceGid, name);
  if (existing) return { gid: existing, created: false };
  const created = await client.request<TagRecord>("POST", "/tags", {
    body: { name, workspace: workspaceGid },
    query: { opt_fields: "gid,name" },
  });
  return { gid: String(created.gid ?? ""), created: true };
}
