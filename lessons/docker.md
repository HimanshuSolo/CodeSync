# Docker in CodeSync

This is a tour of every Docker concept this project actually uses, taught
against the real files instead of toy examples. Read it alongside:

- `Dockerfile` — frontend image
- `server/Dockerfile` — backend image
- `compose.yaml` — multi-service orchestration
- `server/RUNNER.md` — operational notes for the code runner
- `server/src/routes/compile.rs` — the backend spawning *other* containers at runtime

CodeSync uses Docker in two distinct ways, and it's worth separating them
before diving in:

1. **Packaging** — the frontend and backend each get built into an image so
   they run identically in dev, on a VPS, or anywhere else.
2. **Sandboxing** — the backend itself launches short-lived, locked-down
   containers on demand to execute a user's submitted code. This is the more
   advanced and more interesting use.

---

## 1. Images, containers, and layers (quick recap)

A **Dockerfile** is a recipe for building an **image** — a read-only
filesystem snapshot plus metadata (entrypoint, exposed ports, env). Each
instruction (`FROM`, `RUN`, `COPY`, ...) creates a new filesystem **layer**
stacked on the previous one. Docker caches layers by content hash: if a layer
and everything before it are unchanged, the build reuses the cached result
instead of re-running the instruction.

A **container** is a running instance of an image: the image's layers mounted
read-only, plus one thin writable layer on top for anything the process
changes at runtime. Stop the container and, unless you mounted a volume, that
writable layer is gone.

This caching behavior is why instruction *order* in a Dockerfile matters —
see the frontend build below.

---

## 2. Multi-stage builds

Both Dockerfiles in this repo build in stages and throw most of them away.
The `FROM ... AS <name>` syntax names a stage; a later `COPY --from=<name>`
pulls specific files out of it without carrying along everything else that
stage installed (compilers, package caches, source code).

### Frontend (`Dockerfile`)

```dockerfile
FROM node:22-alpine AS dependencies   # stage 1: install deps
FROM node:22-alpine AS builder        # stage 2: build the app
FROM node:22-alpine AS runner         # stage 3: run the app
```

Why three stages instead of one `RUN pnpm install && pnpm build`:

- **`dependencies`** copies only `package.json` and `pnpm-lock.yaml` first,
  then runs `pnpm install`. Because Docker caches per-instruction, this layer
  is only invalidated when the lockfile changes — editing `src/` doesn't
  force a full `pnpm install` on every build.
- **`builder`** copies in `node_modules` from `dependencies`, then the full
  source, then runs `pnpm build`. This stage ends up with a full Next.js
  build, dev dependencies, and the entire source tree — none of which
  belongs in production.
- **`runner`** is the image that actually ships. It starts from a *clean*
  `node:22-alpine` and cherry-picks exactly three things out of `builder`:
  `public/`, `.next/standalone`, and `.next/static`. Next.js's "standalone"
  output is a pruned server bundle with only the `node_modules` it actually
  needs — so the final image never contains pnpm, the Rust toolchain, source
  `.tsx` files, or build caches.

The practical payoff: a multi-gigabyte build environment collapses into a
lean runtime image, and rebuilding after a source-only change reuses the
cached dependency layer instead of reinstalling everything.

### Backend (`server/Dockerfile`)

```dockerfile
FROM rust:1.95-alpine AS builder
...
RUN cargo build --locked --release

FROM docker:29-cli
COPY --from=builder /app/target/release/codesync-server /usr/local/bin/codesync-server
```

Same idea, two stages: compile in a heavyweight `rust:1.95-alpine` image
(full toolchain, ~1GB+), then copy just the compiled binary into a much
smaller final image. `cargo build --locked` refuses to silently update
dependency versions at build time — the build fails instead of drifting from
`Cargo.lock`.

The backend's final base image is **`docker:29-cli`**, not a generic
`alpine`. That's not an accident — see section 4.

---

## 3. `.dockerignore`

`docker build` sends its entire build context (the directory you point it
at) to the Docker daemon *before* the first instruction runs. `.dockerignore`
excludes files from that upload, the same way `.gitignore` excludes files
from a commit. Check `.dockerignore` and `server/.dockerignore` in this repo
— they keep `node_modules/`, `target/`, and `.git/` out of the build context,
which is both faster and prevents stale local build artifacts from leaking
into the image.

---

## 4. Orchestration with `compose.yaml`

Compose describes multiple containers as one system: what images to build,
how they network together, what they depend on, and what data survives
restarts.

### Services

```yaml
services:
  database:        # postgres:16-alpine
  runner-images:    # a one-shot setup task
  backend:          # built from ./server
  frontend:         # built from . (repo root)
```

Every service on the same Compose network can reach every other service by
**service name as hostname** — that's why `compose.yaml` sets
`DATABASE_URL: postgres://codesync:...@database:5432/codesync`: `database`
resolves via Docker's internal DNS to the Postgres container, no IP addresses
involved.

### Startup ordering: `depends_on` + `healthcheck`

```yaml
backend:
  depends_on:
    database:
      condition: service_healthy
    runner-images:
      condition: service_completed_successfully
```

Plain `depends_on` only waits for a container to *start* — not for the
service inside it to be ready. Postgres accepts TCP connections before it's
actually ready to serve queries, so `database` defines a `healthcheck`
(`pg_isready`, polled every 5s) and `backend` waits for `service_healthy`
rather than just "started." The `backend` service defines its own
healthcheck the same way, which is what lets `frontend` safely wait on it
too.

### A one-shot "setup" container

```yaml
runner-images:
  image: docker:29-cli
  command: [sh, -ec, "docker pull python:3.13-alpine\ndocker pull ..."]
  restart: "no"
```

This service isn't a long-running server — it runs once, pulls every
language image the code runner will need, exits, and `restart: "no"` stops
Compose from restarting it. `backend` depends on it with
`condition: service_completed_successfully`, so the app never accepts a run
request before the images it needs actually exist locally. This is a common
Compose pattern for one-time setup/migration tasks that need to happen before
the "real" services start.

### Volumes: named vs. bind mounts

```yaml
volumes:
  postgres_data:
  repository_workspaces:
  runner_workspaces:
    name: codesync_runner_workspaces
```

A **named volume** is storage Docker manages for you (`docker volume ls`),
addressed by name instead of a host path. `postgres_data` persists the
database across `docker compose down` / `up` cycles — delete the container,
the data survives. Compare this to a **bind mount**, which maps a specific
host path into the container (you'll see this pattern used directly by the
backend at runtime — section 6).

### Passing configuration in

```yaml
environment:
  JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET in .env}
```

`${VAR:?message}` is Compose's shell-style variable expansion: substitute
`JWT_SECRET` from the environment (or `.env` next to `compose.yaml`), and if
it's unset, fail the whole `compose up` with `message` instead of silently
starting a misconfigured backend. `${FRONTEND_PORT:-3000}` is the same
syntax with a default instead of a hard requirement.

---

## 5. Docker-outside-of-Docker: the socket mount

This is the single most important Docker concept in this codebase, and it
appears twice:

```dockerfile
# server/Dockerfile
FROM docker:29-cli
```

```yaml
# compose.yaml, backend service
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

`/var/run/docker.sock` is the Unix socket the Docker CLI talks to on your
host machine — it's the API endpoint of the Docker *daemon* (`dockerd`),
which manages every container regardless of which shell or process asks it
to. Mounting the host's socket into the `backend` container, and giving that
container the `docker` CLI binary (via the `docker:29-cli` base image), means
processes inside `backend` can run `docker run ...` and have containers
spawned **on the host**, as siblings of `backend` — not nested inside it.
This pattern is called **Docker-outside-of-Docker (DooD)**, distinct from
"Docker-in-Docker" (running a whole separate daemon inside a container).

`server/src/routes/compile.rs` does exactly this: on every `/run` request it
shells out to `Command::new("docker")` from inside the already-containerized
backend, which — because of the socket mount — creates a brand-new container
on the host to execute the user's code.

**Why this matters, security-wise:** anyone who can talk to the Docker socket
can, among other things, mount the host's root filesystem into a new
container and read/write it as root. Socket access is effectively
root-on-the-host access. `RUNNER.md` says this explicitly:

> Docker daemon access is highly privileged. In production, run CodeSync's
> runner as a separate service using rootless Docker or another hardened
> sandbox.

So the trust chain here is: the backend process is trusted to only ever run
the specific, tightly-flagged `docker run` command in `compile.rs` — never
anything derived from user input. If an attacker ever got arbitrary code
execution *inside* the backend process (not just inside a runner container),
the socket mount would hand them the host.

---

## 6. Sandboxing untrusted code with `docker run` flags

Once the request reaches `run_container()` in `compile.rs`, the backend
builds a `docker run` command by hand, one `.arg(...)` at a time (never a
shell string — see the note on subprocess safety below). Each flag is doing
real security work:

| Flag | What it does | Why it's here |
|---|---|---|
| `--rm` | Delete the container as soon as it exits | No leftover containers piling up per run |
| `--pull never` | Never contact a registry, only use images already local | Prevents the request from triggering an arbitrary image pull |
| `--network none` | No network namespace/interfaces at all | Submitted code can't exfiltrate data or call out anywhere |
| `--memory 512m` / `--memory-swap 512m` | Hard memory ceiling, swap included | A runaway allocation gets OOM-killed instead of starving the host |
| `--cpus 0.75` | CPU time ceiling | One run can't monopolize a core |
| `--pids-limit 64` | Max number of processes/threads | Blocks fork-bombs |
| `--stop-timeout 1` | Grace period before `SIGKILL` on stop | Fast cleanup when a run is forcibly stopped |
| `--read-only` | Root filesystem is immutable | Code can't tamper with the runtime image itself |
| `--cap-drop ALL` | Strip every Linux capability | No raw sockets, no ptrace, no mount, etc. |
| `--security-opt no-new-privileges` | Blocks setuid/setgid privilege escalation | Even a setuid binary inside the image can't gain root |
| `--user 65534:65534` | Run as `nobody`, not root | Defense in depth if a container escape ever occurred |
| `--tmpfs /tmp:rw,exec,nosuid,nodev,size=256m` | A size-capped, in-memory scratch directory | Compilers/interpreters need a writable `/tmp`, but `nosuid`/`nodev` still block privilege tricks there |
| `--entrypoint sh ... -c <command>` | Override whatever the image normally runs | Forces exactly `runtime.command` (e.g. `python main.py`) regardless of the base image's default entrypoint |

Notice what's *not* here: no `--privileged`, no extra `--cap-add`, no bind
mount that's writable. The only mount is the source file, and it's read-only
(`:ro`).

This whole function is a good case study in the general principle: **when
you must run untrusted code, don't try to sanitize the code — sandbox the
environment it runs in.** Every flag above assumes the submitted code is
hostile and asks "what's the worst this process could do if it tried," then
removes that capability.

### The volume mount has two modes

```rust
if let Some(volume_name) = runner_volume_name {
    // named volume, mounted read-only at the workspace subpath
    command.arg(workspace).arg("--volume")
        .arg(format!("{volume_name}:{}:ro", ...));
} else {
    // bind mount: map this exact host directory in, read-only
    command.arg("/workspace").arg("--volume")
        .arg(format!("{}:/workspace:ro,Z", workspace.display()));
}
```

In Compose (`RUNNER_VOLUME_NAME=codesync_runner_workspaces`), the backend and
the ephemeral runner containers share one **named volume**, because the
backend container's own filesystem path (`/runner-workspaces/codesync-run-…`)
isn't visible to a sibling container spawned via the host daemon — only a
volume or a host path is. Without a configured volume, it falls back to a
**bind mount** of the raw host path (with `:Z` — an SELinux relabel flag
for restrictive hosts). Either way: read-only, so the running code can read
its own source but never modify it.

### Backpressure, not just isolation

```rust
let _permit = timeout(Duration::from_secs(3), state.runner_slots.acquire())...
```

Before spawning a container at all, the handler acquires a permit from a
`tokio::sync::Semaphore` sized to a handful of slots (see `AppState`). This
isn't a Docker feature — it's the application limiting how many `docker run`
processes it will have in flight at once, so a burst of `/run` requests
can't fork-bomb the *host* by launching dozens of containers simultaneously.
Sandboxing each container is necessary but not sufficient; you also need to
bound how many sandboxes exist at once.

### Timeout and forced cleanup

```rust
match timeout(RUN_TIMEOUT, child.wait_with_output()).await {
    ...
    Err(_) => Err(RunError::TimedOut),
}
```

```rust
async fn stop_container(container_name: &str) {
    Command::new("docker").args(["rm", "-f", container_name])...
}
```

`RUN_TIMEOUT` (15s) bounds how long the backend waits for the subprocess.
If the container is still running past that, `docker rm -f <name>` force-
removes it by the name assigned earlier (`codesync-runner-{id}`) — `--rm`
alone only cleans up on a *normal* exit, so a hung process needs this
explicit follow-up kill.

---

## 7. Subprocess safety: `.arg(...)` vs. a shell string

Every `docker` invocation in `compile.rs` is built with `Command::new(...)`
plus a chain of `.arg(...)` calls — never `format!("docker run {user_input}")`
passed to a shell. Each `.arg()` becomes exactly one argv entry, with no
shell involved to reinterpret `;`, `` ` ``, `$()`, or spaces. This is the
same principle `BACKEND_ARCHITECTURE.md` calls out for the Git subprocess
code: treat subprocess arguments as hostile input, and prefer structured
argument lists over building command strings.

---

## 8. Concept → file map

| Concept | Where to look |
|---|---|
| Multi-stage builds | `Dockerfile`, `server/Dockerfile` |
| Build cache ordering (deps before source) | `Dockerfile` stages `dependencies` → `builder` |
| Minimal runtime image | `Dockerfile` stage `runner`; `server/Dockerfile`'s `docker:29-cli` final stage |
| Non-root container user | `Dockerfile`'s `nextjs` user |
| `.dockerignore` | `.dockerignore`, `server/.dockerignore` |
| Compose service networking by name | `compose.yaml` `DATABASE_URL` using host `database` |
| Healthcheck-gated startup | `compose.yaml` `database`/`backend` healthchecks + `depends_on: condition:` |
| One-shot init container | `compose.yaml` `runner-images` service |
| Named volumes | `compose.yaml` `volumes:` block |
| Required/defaulted env vars | `compose.yaml` `${VAR:?...}` / `${VAR:-...}` |
| Docker-outside-of-Docker (socket mount) | `server/Dockerfile` (`docker:29-cli` base), `compose.yaml` backend `volumes:` socket line |
| Sandboxed untrusted execution | `server/src/routes/compile.rs::run_container` |
| Resource limits on a container | Same file — memory/cpus/pids flags |
| Read-only rootfs + scratch tmpfs | Same file — `--read-only` + `--tmpfs` |
| Backpressure independent of sandboxing | `server/src/routes/compile.rs::run_code` — `state.runner_slots` semaphore |
| Operational runbook for the runner | `server/RUNNER.md` |

---

## 9. Exercises

1. **Trace a build cache hit.** Change a comment in `src/app/page.tsx` and
   rebuild the frontend image. Which stage's cache is invalidated, and which
   is reused? Now change `package.json` instead — what changes?
2. **Break `--pull never` on purpose.** Remove that flag locally and request
   a language whose image isn't pulled yet. What error does Docker give
   instead of the friendly `DockerUnavailable` message `compile.rs` produces
   for a missing image?
3. **Trace the socket mount.** From inside a running `backend` container
   (`docker compose exec backend sh`), run `docker ps`. Whose containers do
   you see — the ones on the host, or something scoped to `backend` itself?
4. **Remove one hardening flag at a time** from `run_container` (in a local
   branch, never deployed) — say, `--cap-drop ALL` — and think through what
   a malicious submission could now do that it couldn't before.
5. **Read `RUNNER.md` again** after finishing this file and explain, in your
   own words, why "rootless Docker" would reduce the blast radius of the
   socket mount described in section 5.

## 10. Further reading

- Docker build: <https://docs.docker.com/build/>
- Multi-stage builds: <https://docs.docker.com/build/building/multi-stage/>
- Compose file reference: <https://docs.docker.com/reference/compose-file/>
- Compose `depends_on` conditions: <https://docs.docker.com/reference/compose-file/services/#depends_on>
- Docker security (capabilities, seccomp, rootless): <https://docs.docker.com/engine/security/>
- Why the Docker socket is sensitive: <https://docs.docker.com/engine/security/#docker-daemon-attack-surface>
