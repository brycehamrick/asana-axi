# Publish runbook

Everything is prepared; three manual steps remain (they need interactive
auth - browser login and 2FA - which cannot be automated from here).

## 1. Create the public GitHub repo

Either click: <https://github.com/new> (name: `asana-axi`, public, no
README/license/gitignore - this repo has them), or install the CLI first:

```sh
brew install gh && gh auth login
gh repo create brycehamrick/asana-axi --public --source . --push
```

The `origin` remote is already wired to
`git@github.com:brycehamrick/asana-axi.git` (HTTPS fallback:
`https://github.com/brycehamrick/asana-axi.git`), so a web-created repo just
needs:

```sh
git push -u origin main
```

## 2. Publish to npm

```sh
npm login            # browser + 2FA
npm publish          # access is already "public" in package.json
```

Verify from a clean directory:

```sh
npx -y asana-axi@latest --version   # expect 1.0.0
npx -y asana-axi@latest me          # with ASANA_ACCESS_TOKEN exported
```

## 3. Soak, then catalog PR

- Install the skill: `npx -y skills@latest add brycehamrick/asana-axi --skill asana-axi -g`
- Dogfood your real workflows for a few days.
- Then follow [docs/upstream-catalog.md](docs/upstream-catalog.md) to add
  asana-axi to the axi.md catalog through no-mistakes.

## Release hygiene (every future release)

```sh
npm run typecheck && npm run lint && npm test && npm run build
# bump version in package.json, commit as "chore: release v<x.y.z>"
npm publish
git push --tags   # optional: tag v<x.y.z> before pushing
```

CI (`.github/workflows/ci.yml`) runs the same gates on mac/win/linux plus
gitleaks once the repo is on GitHub with Actions enabled.
