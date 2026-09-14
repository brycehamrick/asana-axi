# Commands

`asana-axi <resource> <subcommand> [flags]` operates on Asana tasks, projects, workspaces, and tags through the REST API.

Use these commands for any Asana operation.
Flags MUST come after the subcommand.
Requires `ASANA_ACCESS_TOKEN` (environment or `./.env`); see [getting started](./getting-started.md).
All output is TOON.

Resources are addressed two ways:
- Positional `<gid>` arguments are strict numeric GIDs.
- `--project`, `--section`, `--tag`, `--workspace` flags accept a GID **or** a name (exact case-insensitive match first, then unique substring; ambiguity is an error listing the matches).

## task

Tasks are GID-addressed positionally.
Mutations (`create`, `edit`, `move`, `complete`, `reopen`, `comment`) run non-interactively and re-fetch the authoritative post-state, so the rendered result is what Asana now holds.

### `asana-axi task list`

List tasks in a project. Defaults to incomplete tasks only.

**Flags:**
- `--project <gid|name>` (default: ASANA_PROJECT_ID)
- `--workspace <gid|name>` (for name resolution; default: ASANA_WORKSPACE_ID or the only workspace)
- `--assignee <gid|@me>`
- `--section <name|gid>` filter to one board column (client-side)
- `--tag <name|gid>` filter by tag (client-side)
- `--completed` completed only (mutually exclusive with `--all`)
- `--all` include completed and incomplete
- `--due-before <YYYY-MM-DD>`, `--due-after <YYYY-MM-DD>` (client-side)
- `--limit <n>` (default 30, max 500)
- `--fields <a,b,c>` extra columns: `assignee`, `tags`, `notes`

```bash
asana-axi task list --project Website --section "In Progress"
```

**Caveats:**
- `count:` is the number of rows returned, not a total; `has_more: true` appears when another page exists - raise `--limit` to see more.
- Client-side filters (`--section`, `--tag`, `--due-*`) apply to the fetched window, so `has_more` can be true with zero matches on this page; widen `--limit` before concluding nothing matches.
- Empty result is always explicit: `count: 0`, `tasks: []`, plus a `note:` line.

### `asana-axi task view <gid>`

Show one task.

**Flags:**
- `--comments` include the discussion (comment-type stories only, not system events)
- `--limit <n>` comments shown (default 30); requires `--comments`
- `--subtasks` include child tasks
- `--attachments` include files on the task
- `--full` complete notes/comments without truncation
- `--fields <a,b,c>` render only these fields; `gid` is always included

```bash
asana-axi task view 1200000000000401 --comments --limit 100
```

**Caveats:**
- `--limit` without `--comments` throws `VALIDATION_ERROR` rather than being ignored.
- `--fields` with `--full` throws `VALIDATION_ERROR` (a `--fields` render is never truncated).
- Notes truncate at 1000 chars and comments at 500, each with a size marker and the `--full` escape hatch.

### `asana-axi task create`

Create a task, then re-fetch and render it.

**Flags:**
- `--name <text>` (required)
- `--project <gid|name>` (required unless ASANA_PROJECT_ID; mutually exclusive with `--parent`)
- `--notes <text>` or `--notes-file <path>`
- `--due-on <YYYY-MM-DD>`
- `--assignee <gid|@me>`
- `--tags <a,b>` workspace tag names; created when missing
- `--section <name|gid>` board column to place the task in
- `--parent <gid>` create as a subtask (no `--section`)

```bash
asana-axi task create --name "Fix login" --project Website --section Backlog --tags bug
```

**Caveats:**
- Create is NOT idempotent (Asana has no client-supplied dedupe token) - re-running a failed create may produce a duplicate; check `task list` first if unsure.

### `asana-axi task edit <gid>`

Edit a task, then re-fetch and render it.

**Flags:**
- `--name <text>`
- `--notes <text>` or `--notes-file <path>`
- `--due-on <YYYY-MM-DD|"" clears>`
- `--assignee <gid|@me|"" unassigns>`
- `--completed <true|false>`
- `--tags <a,b>` add tags (existing tags are skipped - idempotent)
- `--remove-tags <a,b>` remove tags (absent tags are skipped)
- `--section <name|gid>` move to a board column

```bash
asana-axi task edit 1200000000000401 --name "New title" --tags backend,urgent
```

**Caveats:**
- At least one mutation flag is required; none throws `VALIDATION_ERROR`.
- Only provided fields are PUT; tag/section changes are separate calls.

### `asana-axi task move <gid> --section <name|gid>`

Move a task to a board column.

```bash
asana-axi task move 1200000000000401 --section "Review / QA"
```

**Caveats:**
- Idempotent: moving to the current section is a no-op success (`message: Already in ...`).
- The project is taken from the task's first membership; pass `--project <gid>` when the task has none/multiple.

### `asana-axi task complete <gid>` / `asana-axi task reopen <gid>`

Set completion state.

**Caveats:**
- Idempotent: completing a completed task is a no-op success (`message: Already completed - no change`).

### `asana-axi task comment <gid> --text <text>`

Add a comment (story), then render it with the task header.

**Flags:**
- `--text <text>` or `--text-file <path>` (required, exactly one)

```bash
asana-axi task comment 1200000000000401 --text "Deployed to staging"
```

**Caveats:**
- Asana stories are plain text; markdown-ish syntax is stored verbatim and rendered by Asana's own formatter.

### `asana-axi task attach <gid> --file <path>`

Upload a local file to a task.

**Flags:**
- `--file <path>` (required)
- `--comment <text>` optional story to add after the upload

```bash
asana-axi task attach 1200000000000401 --file ./test-output.log --comment "Test run attached"
```

### `asana-axi task search "<text>"`

Full-text search across the workspace's tasks.

**Flags:**
- `--workspace <gid|name>` (default: ASANA_WORKSPACE_ID or the only workspace)
- `--completed` include only completed tasks
- `--limit <n>` (default 30)
- `--fields <a,b,c>`

```bash
asana-axi task search "checkout redesign"
```

**Caveats:**
- The search text is a single quoted argument; missing it throws `VALIDATION_ERROR`.

### `asana-axi task subtasks <gid>`

List a task's child tasks.

**Flags:** `--limit <n>`, `--completed`, `--fields <a,b,c>`

### `asana-axi task delete <gid>`

Delete a task. **Asana deletion is permanent** (no trash).

**Flags:** `--confirm` (required)

```bash
asana-axi task delete 1200000000000401 --confirm
```

**Caveats:**
- Without `--confirm` the command fails with `CONFIRMATION_REQUIRED` and changes nothing. To close without deleting, use `task complete`.

## project

Projects are GID-addressed positionally; the `--project` flag on other commands also accepts names.

### `asana-axi project list`

**Flags:** `--workspace <gid|name>`, `--archived` (include archived), `--limit <n>`

### `asana-axi project view <gid>`

Show one project with the pre-computed `task_counts` aggregate (total/incomplete/completed) - no follow-up round trip needed.

**Flags:** `--full` (complete notes without truncation)

### `asana-axi project sections <gid>`

List the board columns of a project.

## workspace

### `asana-axi workspace list`

**Flags:** `--limit <n>`

### `asana-axi workspace view <gid>`

## tag

### `asana-axi tag list`

**Flags:** `--workspace <gid|name>`, `--limit <n>`

### `asana-axi tag create`

**Flags:** `--name <text>` (required), `--workspace <gid|name>`, `--color <name>`

**Caveats:**
- Idempotent: a tag with the same name already existing is a no-op success.

## me

### `asana-axi me`

Auth check: user record plus every workspace the token can reach, with GIDs - use this to pick `ASANA_WORKSPACE_ID`.

## setup

### `asana-axi setup hooks [--scope user|project]`

Install agent SessionStart ambient context (Claude Code, Codex, OpenCode). See [setup](./setup.md).

### `asana-axi setup status [--scope user|project]`

Report per-agent install status without writing.

## See also

- [Getting started](./getting-started.md)
- [Limitations](./limitations.md)
- [Setup & update](./setup.md)
