import type { AxiStructuredOutput } from "../render.js";
import { parseFlags, rejectPositionals } from "../args.js";
import { openClient, type CliDeps } from "../context.js";
import { stripNulls, type UserRecord } from "../render.js";

export const ME_HELP = `usage: asana-axi me [flags]
flags:
  (none)
examples:
  asana-axi me`;

/** Auth check: who the token speaks for, and which workspaces it can reach. */
export async function meCommand(
  args: string[],
  deps: CliDeps | undefined,
): Promise<AxiStructuredOutput> {
  const { positionals } = parseFlags(args, {}, "me");
  rejectPositionals(positionals, "me");

  const { client } = openClient(deps ?? {});
  const user = await client.request<UserRecord>("GET", "/users/me", {
    query: { opt_fields: "gid,name,email,workspaces.name,workspaces.gid" },
  });
  const workspaces = Array.isArray(user.workspaces) ? user.workspaces : [];
  return stripNulls({
    auth: "ok",
    user: {
      gid: String(user.gid ?? ""),
      name: typeof user.name === "string" ? user.name : "",
      email: typeof user.email === "string" ? user.email : null,
    },
    workspaces: workspaces.map((workspace) => {
      const record = workspace as Record<string, unknown>;
      return {
        gid: String(record.gid ?? ""),
        name: typeof record.name === "string" ? record.name : "",
      };
    }),
    help: [
      "Set ASANA_WORKSPACE_ID=<gid> and ASANA_PROJECT_ID=<gid> to pin defaults (environment or ./.env)",
      "Run `asana-axi workspace list` for full workspace records",
    ],
  });
}
