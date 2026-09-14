# Setup and update

## Session hooks (ambient context)

`asana-axi setup hooks` installs a SessionStart hook for Claude Code and Codex, and a managed plugin for OpenCode, so every new agent session starts with the asana-axi dashboard already visible (auth state, your open tasks, default project counts) - before the agent takes any action.

```sh
npm i -g asana-axi   # hooks require the global install
asana-axi setup hooks
asana-axi setup status   # verify, no writes
```

- Scope: user-level by default (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.config/opencode/plugins/`). `--scope project` targets the per-repository configs instead.
- Uninstall: `asana-axi setup uninstall` removes only marker-matched managed entries; unrelated hooks are untouched.
- Windows: npm global bins are `.cmd` shims; the installer resolves them explicitly (via axi-sdk-js), so the plain binary name still works.

Hooks run the no-arg dashboard, which requires `ASANA_ACCESS_TOKEN` to be visible to the agent process. With no token the hook degrades to a definitive `auth: error` block with setup guidance - it never crashes the session.

## Self-update

`asana-axi update` is an inherited built-in:

```sh
asana-axi update --check   # report current vs latest, install nothing
asana-axi update           # upgrade via the detected install method
```

The upgrade command matches the install method (npm/pnpm global, Homebrew, or a note that `npx -y asana-axi@latest` already runs the latest).

## The agent skill

The recommended install for agents is the skill, which teaches `npx -y asana-axi@latest` invocations:

```sh
npx -y skills@latest add brycehamrick/asana-axi --skill asana-axi -g
```

The skill and the CLI come from the same source; the skill's guidance tracks the published package.
