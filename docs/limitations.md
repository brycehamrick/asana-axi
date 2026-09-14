# Limitations

Known lossy behaviors and Asana API gaps that shape what asana-axi can report.

## No total counts from the API

Asana's list endpoints paginate but never report a total. `count:` is therefore the number of rows returned, with `has_more: true` when another page exists. The exception is `project view`, which uses the dedicated `task_counts` endpoint for true totals (total/incomplete/completed).

## Client-side filters see only the fetched window

`task list --section/--tag/--due-before/--due-after` filter locally after fetching up to `--limit` tasks. `has_more: true` with zero matches on the page does not prove nothing matches overall - widen `--limit` before concluding. `--assignee` and completion filters are server-side and exact.

## `task list` is project-scoped

There is no cheap unbounded "all my tasks" listing; the `/tasks` endpoint needs a project (or workspace+assignee pairing used by the dashboard's `my_tasks` block). Use `task search` for cross-project lookup and the no-arg dashboard for your own open tasks.

## Stories are plain text

Asana comments (stories) have no structured document format. Whatever you pass to `--text` is stored verbatim; Asana's own renderer decides how markdown-ish syntax displays. System events (assignments, section moves, ...) are excluded from `--comments` output - only human comments render.

## Notes render as plain text

`html_notes` (Asana's rich-text field) is not requested; `notes` is the plain-text form. Embedded formatting in the UI may be richer than what `task view` shows.

## Create is not idempotent

Asana has no idempotency key for task creation. A retried failed create can duplicate a task. Edit/move/complete/reopen/tag operations ARE idempotent no-ops when already applied.

## Subtask placement

Subtasks are created under a parent and inherit its project; `--section` is rejected for `create --parent` (Asana has no direct subtask-to-column placement). Move a subtask with `task move` after creation if needed.

## Multi-project tasks

A task can live in multiple projects. Section moves use the task's first project membership for name resolution; pass an explicit `--project <gid>` (or a raw section GID) when that guess would be wrong. `task view` renders all sections/projects.

## Attachments

Uploads are limited to local file paths. Download URLs from Asana expire; `task attach` output reports the permanent UI URL.

## Rate limits

Retries on 429/503 honor `Retry-After` (max 3 attempts, capped wait), then fail with `RATE_LIMITED`. Very large boards can still trip the limit on wide `--limit` values.
