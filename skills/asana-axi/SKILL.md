---
name: asana-axi
description: "Operate Asana through the asana-axi CLI - tasks, projects, sections, tags, workspaces, comments, attachments, and search. Use whenever a task touches Asana: viewing or editing a task, creating work, moving a ticket across board columns, completing it, reading or adding comments, uploading attachments, searching tasks, or inspecting projects and workspaces."
metadata:
  tags: [asana, project-management, axi, toon]
  category: productivity
---

# asana-axi

Agent-ergonomic Asana CLI over the REST API, with token-efficient TOON output and idempotent mutations.

You do not need asana-axi installed - invoke it with `npx -y asana-axi@latest <command>`, which is the default path.
The `@latest` pin ensures you always run the newest published version.
If asana-axi output shows a follow-up command starting with `asana-axi`, run it as `npx -y asana-axi@latest ...` instead; if a bare `asana-axi` already resolves on PATH, run it directly.

Auth: `ASANA_ACCESS_TOKEN` must be in the environment (or a `./.env` file). Optional `ASANA_WORKSPACE_ID` and `ASANA_PROJECT_ID` pin defaults. Create a token at https://app.asana.com/0/my-apps. Verify with `me` - never print the token.

A global install (`npm i -g asana-axi`) is a SECONDARY option, for the agent SessionStart hook functionality; `setup hooks` requires it.
What the hook adds to every session: the no-arg dashboard (auth state, `my_tasks[N]`, default project counts, and a `help[]` line naming the commands). Every command below behaves identically either way.

## When to use

Use asana-axi whenever a task touches Asana: viewing, creating, or editing a task; moving a ticket between board columns (sections); completing or reopening it; reading or adding comments; uploading attachments; searching tasks by text; listing projects, their columns, tags, or workspaces; checking auth; or setting up ambient session context.

## Status

The dashboard, `task` (list/view/create/edit/move/complete/reopen/comment/attach/search/subtasks/delete), `project` (list/view/sections), `workspace` (list/view), `tag` (list/create), `me`, `setup hooks`, and the inherited `update` command work today.
asana-axi calls the Asana REST API directly - no separate CLI prerequisite. It needs `ASANA_ACCESS_TOKEN` (environment or ./.env).

## Commands

```
commands[7]:
  (none)=dashboard, task, project, workspace, tag, me, setup
task:
  list [--project] [--assignee] [--section] [--tag] [--completed|--all] [--due-before|--due-after] [--limit] [--fields],
  view <gid> [--comments] [--subtasks] [--attachments] [--full] [--fields],
  create --name --project [--notes|--notes-file] [--due-on] [--assignee] [--tags] [--section] [--parent],
  edit <gid> [--name] [--notes] [--due-on] [--assignee ""] [--completed] [--tags] [--remove-tags] [--section],
  move <gid> --section <name|gid>, complete <gid>, reopen <gid>,
  comment <gid> --text, attach <gid> --file <path> [--comment],
  search "<text>", subtasks <gid>, delete <gid> --confirm
project:
  list [--workspace] [--archived], view <gid> [--full], sections <gid>
workspace:
  list, view <gid>
tag:
  list [--workspace], create --name [--color]
setup:
  hooks [--scope user|project], status, uninstall
```

Run `asana-axi --help` for global flags, or `asana-axi <command> --help` for per-command usage.
Run `asana-axi setup hooks` to install SessionStart ambient context (requires the global install).

## Tips

- Flags come AFTER the command: `asana-axi task list --project Website`, never before.
- Output is TOON-encoded and token-efficient; unknown flags fail with exit code 2.
- Projects/sections/tags/workspaces resolve by NAME on their flags (`--project Website`) or by raw GID; tasks are always GID-addressed - find GIDs with `task list` or `task search`.
- Mutations are idempotent and re-render the post-state; re-running a failed mutation is safe (`move` to the current section and `complete` on a completed task are no-op successes).
- `task list` defaults to INCOMPLETE tasks; `--completed` flips it, `--all` includes both.
- `count:` is rows returned, not a total; `has_more: true` means raise `--limit`. `project view` embeds true `task_counts`.
- Long text truncates with a size marker and a `--full` escape hatch (notes at 1000 chars, comments at 500).
- `task view --comments` shows human comments only (system stories excluded); pass `--subtasks`/`--attachments` for those blocks.
- `task delete` is permanent and gated behind `--confirm`; prefer `task complete` for closing work.
- Set `ASANA_PROJECT_ID` + `ASANA_WORKSPACE_ID` (environment or ./.env) so most commands need no flags; find the GIDs with `me` or `workspace list`.
- Auth failures map to `AUTH_REQUIRED` with PAT regeneration guidance; the no-arg dashboard degrades to an `auth: error` block instead of crashing.
