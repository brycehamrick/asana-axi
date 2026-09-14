# asana-axi

Agent-ergonomic Asana CLI over the REST API, with token-efficient [TOON](https://toonformat.dev/) output and idempotent mutations. Built on the [AXI](https://axi.md/) principles for agent-tool interfaces.

## Quick Start

Install the asana-axi skill in the Agent Skills format with npx skills:

```
npx -y skills@latest add brycehamrick/asana-axi --skill asana-axi --agent opencode -g -y
```

That is the entire setup - no npm install needed. The skill teaches your agent to run asana-axi through `npx -y asana-axi@latest`, so the CLI comes along on demand. `-g` installs the skill user-level for all projects; drop it to install for the current project only. Swap `--agent opencode` for your agent of choice (or `--agent '*'`); the flag keeps the install non-interactive - plain `-g` prompts for target agents and fails in a non-TTY.

## Other Ways to Install

Zero setup - any capable agent can run the CLI directly with nothing installed at all:

```
npx -y asana-axi@latest task list --project 1200000000000200
```

Session hook - install globally, **only if you want the agent SessionStart hook functionality** (`setup hooks` requires it):

```
npm i -g asana-axi
asana-axi setup hooks
```

## Prerequisites

- Node >= 20 (macOS: `brew install node@24` or nvm; Windows: `winget install OpenJS.NodeJS.LTS`; Linux: nvm/fnm or NodeSource).
- An Asana personal access token: create one at <https://app.asana.com/0/my-apps>.
- `ASANA_ACCESS_TOKEN` in the environment (or a `./.env` file). Optional: `ASANA_WORKSPACE_ID` and `ASANA_PROJECT_ID` pin defaults.

```sh
# macOS / Linux
export ASANA_ACCESS_TOKEN=<personal-access-token>

# Windows (PowerShell)
[Environment]::SetEnvironmentVariable("ASANA_ACCESS_TOKEN", "<personal-access-token>", "User")
```

Then verify:

```
npx -y asana-axi@latest me
```

## First commands

```sh
# ambient dashboard (no args): auth, your open tasks, default project status
npx -y asana-axi@latest

# list open tasks in a project (name or GID)
npx -y asana-axi@latest task list --project Website

# view one task with its discussion
npx -y asana-axi@latest task view 1200000000000401 --comments

# create a task in a board column with tags (mutations re-render the result)
npx -y asana-axi@latest task create --name "Fix login" --project Website --section Backlog --tags bug,frontend
```

Flags MUST come after the command: `asana-axi task list --project Website`, never `asana-axi --project Website task list`.

## Commands

All commands are flattened: `asana-axi <resource> <subcommand> [flags]`. Resources are GID-addressed positionally; `--project`, `--section`, `--tag`, and `--workspace` flags also accept names (resolved case-insensitively; ambiguity is an error that lists the matches).

- `task` - `list`, `view <gid>`, `create`, `edit <gid>`, `move <gid> --section <name|gid>`, `complete <gid>`, `reopen <gid>`, `comment <gid> --text`, `attach <gid> --file <path>`, `search "<text>"`, `subtasks <gid>`, `delete <gid> --confirm`
- `project` - `list`, `view <gid>` (embeds task-count aggregates), `sections <gid>`
- `workspace` - `list`, `view <gid>`
- `tag` - `list`, `create` (idempotent)
- `me` - auth check + user + workspaces
- `setup hooks` - install agent SessionStart ambient context (Claude Code, Codex, OpenCode)
- `update` / `update --check` - self-upgrade the CLI (inherited built-in)

Per-command help is always available: `asana-axi <resource> --help`.

## Output and behavior

All structured output is TOON-encoded and token-efficient; there is no plain-text or JSON mode. List rows default to 4-5 columns (`gid,name,section,due_on,completed`) with `--fields` for more. Long free text truncates with a size marker - pass `--full` on the detail command that renders it. Mutations are idempotent where the API allows (moving to the current section, completing a completed task, adding an existing tag are no-op successes), run non-interactively, and re-fetch the authoritative post-state, so re-running a failed mutation is safe. Unknown flags fail loud with exit code 2. Deletion is gated behind `--confirm` (Asana deletion is permanent).

## Security

The token is read from `ASANA_ACCESS_TOKEN` (environment or `./.env`) and is never logged, rendered, or written anywhere; error text is scrubbed through a redaction pass before printing. Nothing else is persisted - every invocation is stateless.

## Docs

See [docs/index.md](docs/index.md):

- [Getting started](docs/getting-started.md)
- [Commands](docs/commands.md)
- [Limitations](docs/limitations.md)
- [Setup and update](docs/setup.md)

## License

MIT
