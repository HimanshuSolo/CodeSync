# CI/CD in CodeSync

This is a tour of CI/CD concepts taught against the pipeline actually running
in this repo, not toy examples. Read it alongside:

- `.github/workflows/ci.yml` — the whole pipeline
- `README.md` — how this project is actually deployed today

The short version of what exists right now: CodeSync has **CI** (this file)
but only **partial CD** — and that gap is itself worth understanding, because
it's the normal state of most real projects, not a mistake.

---

## 1. CI and CD are two different jobs

They get mashed into one acronym, but they answer different questions:

- **Continuous Integration** — every time someone proposes a change, does it
  actually build, pass its tests, and pass lint? Run automatically, on every
  push, without a human remembering to do it locally first.
- **Continuous Deployment/Delivery** — once a change is good, does it *reach
  production* automatically (Deployment), or automatically get staged for a
  one-click release (Delivery)?

CodeSync's `.github/workflows/ci.yml` is CI only — it builds and tests, it
does not deploy anything. This project's CD story is actually split and
partly outside this file entirely:

- **Frontend**: this repo is linked to Vercel (see the `.vercel/` directory
  and `.vercelignore`, added specifically to stop Vercel from uploading the
  Rust backend on every deploy). Vercel watches this GitHub repo directly and
  redeploys the frontend on every push — that's CD, but it's a completely
  separate system from GitHub Actions, triggered independently.
- **Backend**: no CD at all. `README.md` documents the deploy as a manual
  `docker compose up --build -d` run by a person on a VPS.

Knowing this matters: a green CI check on this repo tells you the backend
*could* be built and its tests pass — it says nothing about whether that
backend is actually running anywhere. Shipping it is still a manual step.

---

## 2. Why this didn't exist until now

Before `.github/workflows/ci.yml`, there was no automated gate at all. That's
not hypothetical risk — while building this exact pipeline, running the same
checks CI now runs surfaced two real, already-committed bugs:

- `cargo clippy -D warnings` caught a `needless_lifetimes` lint in a
  just-written OT fix.
- `pnpm lint` failed outright on `src/app/session/[id]/page.tsx`: a React ref
  (`editorRef.current`) was being read during render, which meant the
  `CursorLayer` component could silently fail to pick up the Monaco editor
  instance after it mounted.

Neither of these were caught by hand, because "run the linter" is a step a
person has to remember to do, every time, forever. CI's whole value
proposition is turning that into something that just always happens.

---

## 3. Anatomy of a workflow file

GitHub Actions workflow files live in `.github/workflows/` (that exact path
is not configurable — it's how GitHub finds them) and are YAML. Breaking
down `ci.yml` top to bottom:

```yaml
name: CI
```
The label shown in GitHub's UI (the "CI" you saw in `gh run list`).

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```
**Triggers.** This workflow runs on two different events, and both matter
for different reasons:
- `push` to `main` — a safety net. If something lands on `main` directly
  (or a PR gets merged), you find out immediately if it's broken.
- `pull_request` targeting `main` — the more important one in practice. This
  runs on every PR *before* it merges, using the PR's proposed merge commit.
  Combined with a branch protection rule (see section 8), this is what turns
  "CI ran" into "CI blocked a bad merge."

```yaml
permissions:
  contents: read
```
Every workflow run gets an auto-generated `GITHUB_TOKEN` with API access
scoped to this repo. By default GitHub grants that token fairly broad
permissions (write access to contents, issues, PRs, etc.) — enough that a
compromised third-party Action referenced in your workflow could, in the
worst case, push commits or modify releases using your repo's own identity.
Declaring `permissions:` explicitly overrides the default with the
principle of least privilege: this workflow only ever needs to *read* the
repo to check it out and build it, so that's all its token can do.

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```
Push three commits to the same branch in quick succession and, without this,
you'd get three full CI runs queued up, each racing to finish, most of them
reporting on code that's already been superseded. `concurrency` groups runs
by workflow + branch/ref (`github.ref`), and `cancel-in-progress: true` kills
any older run in that same group the moment a newer one starts — you only
ever wait for a result on the *latest* commit.

---

## 4. Jobs, runners, and steps

```yaml
jobs:
  backend:
    runs-on: ubuntu-latest
    steps: [...]
  frontend:
    runs-on: ubuntu-latest
    steps: [...]
```

- A **job** is an independent unit of work with its own fresh virtual
  machine. `backend` and `frontend` here have zero dependency between them
  (no `needs:`), so GitHub runs them **in parallel** — you saw this directly
  in `gh run watch`'s output, where both jobs progressed at once.
- `runs-on: ubuntu-latest` is a **GitHub-hosted runner**: a clean, ephemeral
  Ubuntu VM that GitHub provisions for the run and destroys afterward.
  Nothing persists between runs except what you explicitly cache (section 6)
  — every job starts from a truly clean machine, which is exactly what makes
  "it works in CI" a meaningful, reproducible signal rather than "it works on
  my machine, which has three months of accumulated local state."
- A **step** is one unit inside a job, run sequentially, sharing the job's
  filesystem. Steps are either `uses:` (run a pre-built, reusable Action) or
  `run:` (execute a shell command directly).

```yaml
  backend:
    defaults:
      run:
        working-directory: server
```
Since the Rust project lives in `server/`, not the repo root, every bare
`run:` step in this job is scoped there — avoids repeating
`working-directory: server` on every single step.

---

## 5. Actions: reusable, versioned steps

```yaml
- uses: actions/checkout@v4
- uses: dtolnay/rust-toolchain@stable
- uses: Swatinem/rust-cache@v2
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
```

A `uses:` step runs someone else's packaged, reusable logic instead of you
writing shell commands from scratch — the GitHub Actions equivalent of a
library. Each one earns its place in this workflow:

| Action | What it actually does |
|---|---|
| `actions/checkout@v4` | Clones this repo's commit onto the runner. Every job needs this first — a fresh VM starts with no code at all. |
| `dtolnay/rust-toolchain@stable` | Installs a Rust toolchain (here: latest `stable`, plus the `clippy` component) — much faster and more precisely version-controlled than hand-rolling a `rustup` install script. |
| `Swatinem/rust-cache@v2` | Caches `~/.cargo/registry` and `target/` between runs, keyed by `Cargo.lock`'s hash. Without it, every run recompiles every dependency from scratch — see section 6. |
| `pnpm/action-setup@v4` | Installs the exact `pnpm` version this repo's `package.json` pins (`10.33.0`), so CI's package manager matches what's actually used locally. |
| `actions/setup-node@v4` | Installs Node, with `cache: pnpm` telling it to also cache pnpm's store, keyed by `pnpm-lock.yaml`. |

**A supply-chain note worth knowing**: `uses: some/action@v4` trusts
whatever code currently lives at that tag — tags can be moved to point at
different code later (unlike a commit SHA, which can't). For third-party
Actions in a security-sensitive pipeline, some teams pin to a full commit SHA
(`uses: actions/checkout@11bd719...`) instead of a floating version tag, to
guarantee the exact code that runs never silently changes underneath you.
This workflow uses version tags from well-known, widely-trusted publishers,
which is a reasonable, common trade-off for a project this size — but it's
worth knowing the stricter option exists.

---

## 6. Caching: why CI doesn't rebuild the world every time

Rust compiles slowly, and the backend job's very first run had to build
essentially all of `Cargo.lock` from nothing before it could even run
`clippy` once. `Swatinem/rust-cache@v2` stores the compiled dependency
artifacts and restores them on the next run *if `Cargo.lock` hasn't
changed*. Same idea for the frontend: `actions/setup-node`'s `cache: pnpm`
avoids re-downloading every package from the registry on every push.

The general pattern, useful anywhere: **cache is keyed by whatever
determines its contents** — here, the lockfile hash. Change a dependency
version, the cache key changes, and you correctly get a full rebuild instead
of a stale cache silently masking a real change.

---

## 7. What actually gets checked

**Backend job:**
```yaml
- run: cargo clippy --all-targets -- -D warnings
- run: cargo test --all-targets
- run: cargo build --release --locked
```
`clippy` is Rust's linter — catches things the compiler allows but that are
usually mistakes or non-idiomatic (the `needless_lifetimes` case from section
2). `-D warnings` promotes every clippy warning to a hard error, so the job
fails instead of just printing noise nobody reads. `--locked` on the release
build refuses to silently update dependency versions from what's pinned in
`Cargo.lock` — the same guarantee `cargo build --locked` gives at Docker
build time (see `lessons/docker.md`).

**Frontend job:**
```yaml
- run: pnpm lint
- run: pnpm exec tsc --noEmit
- run: pnpm build
```
`tsc --noEmit` runs the TypeScript compiler purely for type-checking —
`--noEmit` means "don't actually write out `.js` files, I only want the
errors." `pnpm build` is the strongest check of all: it's the literal
production build, so if it succeeds, the app is provably in a shippable
state, not just individually lint-clean and type-clean.

Notice `pnpm build`'s env block:
```yaml
env:
  NEXT_PUBLIC_API_URL: http://localhost:8080
  NEXT_PUBLIC_WS_URL: ws://localhost:8080
```
Next.js bakes any `NEXT_PUBLIC_*` variable directly into the client-side
JavaScript bundle at build time — by design, these are never secret (a
browser can always read them). CI supplies harmless placeholder values here
purely so the build has *something* to embed; it's not talking to a real
backend. Contrast this with an actual secret (say, a database password) —
that would go through **GitHub Actions Secrets**
(`${{ secrets.SOME_NAME }}`), encrypted at rest and masked in logs, never
committed to the workflow file in plaintext. This repo's CI doesn't need any
real secrets yet, since it only builds and tests — nothing in this pipeline
talks to Postgres, Groq, or GitHub on your behalf.

---

## 8. A green check isn't a gate — yet

This is the most important gap to understand about what exists today.
Right now, `ci.yml` running and passing is purely informational: GitHub shows
a ✓ or ✗ next to the commit/PR, but nothing *stops* a failing PR from being
merged. To make it an actual gate, this repo would need a **branch
protection rule** on `main` (Settings → Branches → Add rule) that marks the
`backend` and `frontend` jobs as **required status checks** — only then does
GitHub grey-out the merge button until they pass. Adding CI and enforcing
CI are two separate, deliberate steps, and only the first one is done here.

---

## 9. A design decision worth understanding: what CI deliberately *doesn't* check

`cargo fmt --check` was considered and left out on purpose. This codebase
consistently uses manual column-aligned formatting (struct fields, match
arms lined up) that `rustfmt`'s default style doesn't preserve — turning
that check on would make CI fail on nearly every file, on day one, for
reasons that have nothing to do with the change in front of you.

This is a real, general CI lesson: **a check that's red from the moment it's
added trains people to ignore CI**, which defeats the entire point. The
right sequence is either (a) fix the codebase to satisfy the check first,
in its own dedicated change, then turn the check on, or (b) don't add that
particular check yet. Silently shipping a failing gate is worse than not
having the gate at all.

---

## 10. Concept → file map

| Concept | Where to look |
|---|---|
| Workflow triggers | `.github/workflows/ci.yml` `on:` block |
| Least-privilege token scoping | Same file, `permissions:` block |
| Superseded-run cancellation | Same file, `concurrency:` block |
| Parallel jobs | `backend` and `frontend` jobs, no `needs:` between them |
| GitHub-hosted ephemeral runner | `runs-on: ubuntu-latest` |
| Reusable Actions vs raw shell steps | `uses:` vs `run:` steps throughout |
| Dependency-hash-keyed caching | `Swatinem/rust-cache@v2`, `actions/setup-node`'s `cache: pnpm` |
| Lint as a hard gate | `cargo clippy ... -D warnings`, `pnpm lint` |
| Type-checking without a build | `pnpm exec tsc --noEmit` |
| Reproducible dependency builds | `cargo build --release --locked` |
| Public vs secret build-time config | frontend job's `env:` block (`NEXT_PUBLIC_*`) |
| CD for the frontend (separate system) | `.vercel/`, `.vercelignore` |
| No CD for the backend (manual) | `README.md`'s `docker compose up --build -d` |

---

## 11. Exercises

1. **Break it on purpose.** Add an unused `let x = 5;` to a Rust function and
   push a branch — watch `cargo clippy -D warnings` actually fail the job
   (`gh run watch <run-id>` streams it live, same as during this session).
2. **Turn the gate on.** Add a branch protection rule on `main` requiring
   both jobs to pass, open a PR with a deliberately broken test, and confirm
   GitHub now refuses to let it merge.
3. **Trace the cache.** Push two commits in a row with no dependency
   changes and compare the backend job's duration — the second run should
   skip most of the compilation `Swatinem/rust-cache` restored.
4. **Add a status badge.** `![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)`
   in `README.md` — a small, real use of the same workflow's status.
5. **Design the missing piece.** Sketch (don't necessarily build) what a
   backend CD job would need: build the Docker image, push it somewhere,
   SSH or otherwise trigger the VPS to pull and restart it. What secrets
   would that require, and how would you scope them as narrowly as the
   `permissions:` block does for `GITHUB_TOKEN`?

## 12. Further reading

- GitHub Actions workflow syntax: <https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions>
- Events that trigger workflows: <https://docs.github.com/en/actions/reference/events-that-trigger-workflows>
- Controlling permissions for `GITHUB_TOKEN`: <https://docs.github.com/en/actions/reference/authentication-in-a-workflow>
- Concurrency: <https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#concurrency>
- Caching dependencies: <https://docs.github.com/en/actions/reference/dependency-caching-reference>
- Required status checks / branch protection: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
