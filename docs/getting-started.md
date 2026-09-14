# Getting started

## Prerequisites

- Node >= 20.
- An Asana personal access token (PAT). Create one at <https://app.asana.com/0/my-apps> (Developer console -> Personal access tokens).
- No other tools: asana-axi talks to the Asana REST API directly (no official Asana CLI exists to wrap).

## Token setup

asana-axi reads `ASANA_ACCESS_TOKEN` from the environment, falling back to a `./.env` file in the working directory (real environment always wins). Optional `ASANA_WORKSPACE_ID` and `ASANA_PROJECT_ID` pin defaults so most commands need no `--workspace`/`--project` flag.

macOS / Linux:

```sh
export ASANA_ACCESS_TOKEN=1/1234567890:abcdef    # ~/.zshrc or ~/.bashrc
export ASANA_WORKSPACE_ID=<workspace-gid>        # optional
export ASANA_PROJECT_ID=<project-gid>            # optional
```

Windows (persistent, then restart the terminal):

```powershell
[Environment]::SetEnvironmentVariable("ASANA_ACCESS_TOKEN", "1/1234567890:abcdef", "User")
```

A `./.env` file works everywhere:

```sh
cp .env.example .env   # then fill in ASANA_ACCESS_TOKEN
```

`.env` files are for local convenience; in CI, use a masked secret mapped to the environment variable.

## Install paths

### New-computer checklist

The skill is what teaches agents that asana-axi exists - OpenCode (and other
agents) discover it from the user-level skills directory at session start.
The CLI itself needs no install: the skill invokes `npx -y asana-axi@latest`.

```sh
# 1. Node >= 20
brew install node@24        # macOS; winget install OpenJS.NodeJS.LTS on Windows; nvm on Linux

# 2. Token in the environment (persistent)
echo 'export ASANA_ACCESS_TOKEN=<your-pat>' >> ~/.zshrc && source ~/.zshrc

# 3. Install the skill (user-level, non-interactive - plain `-g` prompts
#    for "which agents?" and fails in a non-TTY)
npx -y skills@latest add brycehamrick/asana-axi --skill asana-axi --agent opencode -g -y

# 4. Verify - zero-install, npx pulls the CLI on demand
npx -y asana-axi@latest me
```

Optional, for ambient context (the dashboard injected into every session
start; requires the global install) and pinned defaults:

```sh
npm i -g asana-axi
asana-axi setup hooks          # OpenCode plugin + Claude Code + Codex hooks
echo 'export ASANA_WORKSPACE_ID=<gid>' >> ~/.zshrc   # optional
echo 'export ASANA_PROJECT_ID=<gid>'   >> ~/.zshrc   # optional
```

### 1. Zero install (recommended for agents)

```sh
npx -y asana-axi@latest me
```

Works on macOS, Windows, and Linux with Node >= 20. The `@latest` pin always runs the newest published version.

### 2. Agent skill (recommended for ongoing agent use)

```sh
npx -y skills@latest add brycehamrick/asana-axi --skill asana-axi -g
```

Installs the Agent Skills-format skill (user-level with `-g`, per-project without). The skill teaches the agent to invoke the CLI through `npx -y asana-axi@latest`.

### 3. Global install (needed only for session hooks)

```sh
npm i -g asana-axi
asana-axi setup hooks
```

## Verify

```sh
npx -y asana-axi@latest me
```

Returns `auth: ok`, your user record, and the workspaces the token can reach - with GIDs to use for `ASANA_WORKSPACE_ID`. Then run the dashboard with no arguments:

```sh
npx -y asana-axi@latest
```

## Node installation notes

| OS | Recommended |
| --- | --- |
| macOS | `brew install node@24`, or [nvm](https://github.com/nvm-sh/nvm) |
| Windows | `winget install OpenJS.NodeJS.LTS` (or scoop/choco) |
| Linux | nvm/fnm; NodeSource for system packages (distro Node is often too old) |
| Containers/CI | `node:24` images |

Windows works everywhere npx does; the hook installer explicitly understands npm's `.cmd` shims (handled by axi-sdk-js).
