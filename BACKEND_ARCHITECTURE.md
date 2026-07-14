# CodeSync Rust Backend Architecture

This guide explains how the CodeSync backend works end to end, which Rust
concepts it uses, and how its module layout can be reused in other projects.

The backend is one Rust binary crate, located in `server/`, built with Axum and
Tokio. It combines:

- REST APIs for durable resources and one-off operations
- WebSockets for live collaboration
- one in-memory actor per active editing session
- PostgreSQL for durable users, sessions, membership, and document snapshots
- Groq's streaming API for shared AI responses
- Git subprocesses for repository workspaces
- restricted Docker subprocesses for multi-language code execution

## 1. System Overview

```text
Browser / Next.js frontend
        |
        | HTTP + JSON                         WebSocket + JSON
        v                                            v
Axum REST routes                            WebSocket connection task
        |                                            |
        | JWT middleware                             | mpsc
        v                                            v
Route handlers                                Session actor
        |                                     (one per session)
        |                                            |
        +--------------+-----------------------------+
                       |
        +--------------+---------------+------------------+
        |                              |                  |
        v                              v                  v
 PostgreSQL / SQLx              Groq streaming API   Local processes
 users, sessions,              AI token stream       Git and Docker
 members, snapshots
```

There are two central architectural ideas:

1. **Durable state belongs in PostgreSQL.** Users, sessions, memberships, and
   periodic document snapshots survive server restarts.
2. **Fast-changing live state belongs to a session actor.** The current
   document, revision, participants, cursors, and recent operations are owned by
   one asynchronous task while a session is active.

This split prevents every cursor movement or keystroke from becoming a database
write, while still preserving important data.

## 2. Startup Flow

Entry point: `server/src/main.rs`

```text
main()
  -> load .env
  -> initialize tracing/logging
  -> load Config from environment
  -> create PostgreSQL connection pool
  -> run SQLx migrations
  -> construct shared AppState
  -> build public, protected, and WebSocket routers
  -> apply CORS and HTTP tracing layers
  -> bind TCP listener
  -> run Axum server
```

`#[tokio::main]` starts the Tokio async runtime and allows `main` to use
`.await`. Axum receives requests and invokes the matching async handler.

Routes are divided into:

- **Public:** health checks, registration, and login
- **Protected:** REST routes wrapped by JWT middleware
- **WebSocket:** authenticates a JWT supplied as a query parameter before
  upgrading the connection

## 3. Shared Application State

Defined in `server/src/state.rs`:

```rust
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
    pub sessions: Arc<SessionRegistry>,
    pub runner_slots: Arc<Semaphore>,
}
```

Axum clones `AppState` into handlers. Cloning it is cheap:

- `PgPool` is already a cloneable shared connection-pool handle.
- `Config` owns a small set of strings and values.
- `Arc<SessionRegistry>` shares the active session map.
- `Arc<Semaphore>` shares the code-runner concurrency limit.

`SessionRegistry` is a `DashMap<String, SessionHandle>`. It lets concurrent
requests find the actor for a particular editing session without putting one
global mutex around the entire registry.

Use this pattern in another project when many handlers need access to shared
infrastructure such as a database pool, configuration, caches, job queues, or
rate limiters.

## 4. HTTP Request Lifecycle

For a protected REST request:

```text
HTTP request
  -> Axum router matches method and path
  -> JWT middleware reads Authorization: Bearer <token>
  -> middleware verifies signature and expiry
  -> middleware loads the user from PostgreSQL
  -> middleware inserts CurrentUser into request extensions
  -> handler extracts State, Extension, Path/Query, and Json
  -> handler validates input and calls DB/integration functions
  -> Result<T, AppError> becomes JSON success or JSON error response
```

Axum extractors make handler dependencies explicit:

- `State<AppState>`: application infrastructure
- `Extension<CurrentUser>`: authenticated user supplied by middleware
- `Path<Uuid>`: URL path parameter
- `Query<T>`: query string parsed into a struct
- `Json<T>`: JSON body parsed into a struct

This is a useful design rule for other projects: make the handler signature
show exactly what the endpoint needs.

## 5. Authentication Flow

Files:

- `server/src/routes/auth.rs`
- `server/src/middleware/auth.rs`
- `server/src/models/user.rs`
- `server/src/db/mod.rs`

### Registration

```text
POST /auth/register
  -> validate email, username, and password
  -> check uniqueness in PostgreSQL
  -> hash password with Argon2
  -> create user
  -> sign seven-day JWT
  -> return JWT and public user shape
```

`User` contains `password_hash`. `UserPublic` deliberately does not. The
`From<User> for UserPublic` implementation makes the safe conversion explicit.

### Protected REST Requests

`require_auth` validates the JWT and inserts `CurrentUser` into request
extensions before calling the next middleware or handler.

### WebSocket Authentication

Browsers cannot set an arbitrary `Authorization` header when opening a native
WebSocket, so `/session/:id/ws` accepts the JWT as a query parameter. The
WebSocket handler validates it before upgrading the connection.

## 6. Session CRUD Flow

File: `server/src/routes/sessions.rs`

- List sessions visible to the authenticated user.
- Create a session and add its owner as its first member.
- Fetch a session after checking ownership or membership.
- Delete an owned session, stop its live actor, and remove its repository
  workspace.

Database operations are isolated in `db::sessions`, keeping SQL out of route
handlers. That separation is small today, but it makes query behavior easier to
find and replace later.

## 7. Real-Time Collaboration Flow

Files:

- `server/src/ws/handler.rs`
- `server/src/ws/session.rs`
- `server/src/ws/messages.rs`

### Joining

```text
Browser opens /session/:id/ws?token=...
  -> validate JWT and load user/session
  -> add user as member when joining through a valid link
  -> find or create the session actor
  -> upgrade HTTP connection to WebSocket
  -> split socket into incoming stream and outgoing sink
  -> subscribe connection to actor broadcasts
  -> notify actor that user joined
```

### Actor Model

Each active session has one actor task. The actor exclusively owns:

- current document
- current revision
- active repository file
- participant list and cursor positions
- recent edit-operation history

Every WebSocket connection sends actor commands through one `mpsc` channel.
Because the actor processes that channel sequentially, two edits cannot mutate
the document at exactly the same time. This removes the need for a mutex around
the live document.

The actor sends resolved events through a Tokio `broadcast` channel. Every
connected WebSocket task has its own receiver and forwards events to its
browser.

```text
connection A --\
connection B ----> mpsc channel -> one session actor -> broadcast channel
connection C --/                                      |      |      |
                                                     A      B      C
```

### Connection Loop

Each connection uses `tokio::select!` to wait for either:

- the next client WebSocket message, or
- the next actor broadcast

This lets one task handle inbound and outbound traffic concurrently without
blocking on either direction.

### Edit Processing and Operational Transform

For each edit:

1. Read the revision on which the client based its edit.
2. Collect operations the client has not seen.
3. Transform the incoming operation against each missed operation.
4. Apply the transformed operation to the actor-owned document.
5. Increment the server revision.
6. retain the operation in recent history.
7. Periodically persist a document snapshot.
8. Broadcast the resolved operation to all clients.

The OT implementation covers insert/insert, insert/delete, delete/insert, and
delete/delete combinations. Simultaneous inserts at the same position are
ordered by user ID as a deterministic tie-break.

Important current behavior:

- The custom implementation in `ws::session::ot` is used. The declared
  `operational-transform` dependency is not currently used.
- History is in memory and bounded to roughly the latest operations.
- A document snapshot is persisted every ten revisions.
- The `edit_history` SQL table exists but current code does not write to it.
- The current implementation uses byte positions in a Rust `String`; edits at
  invalid UTF-8 character boundaries can panic and deserve hardening.

## 8. Shared AI Streaming Flow

Files:

- `server/src/ai/groq.rs`
- `server/src/ws/session.rs`

```text
client sends AiRequest over WebSocket
  -> session actor receives request
  -> actor spawns an independent Tokio task
  -> task sends streaming HTTP request to Groq
  -> task parses SSE events from response byte chunks
  -> each token becomes ServerMessage::AiToken
  -> broadcast channel sends token to every session participant
  -> AiDone marks completion
```

The AI request runs in a spawned task so a slow model response does not block
edits, cursor updates, or connection events in the actor loop.

The SSE parser maintains a `pending` string because one network chunk may
contain a partial event or several events. This is a general streaming rule:
network chunk boundaries are not application-message boundaries.

## 9. GitHub Repository Workspace Flow

File: `server/src/routes/repositories.rs`

Each session may have a local repository workspace at:

```text
<WORKSPACE_ROOT>/<session-id>/
```

Supported operations:

- shallow clone an HTTPS GitHub repository
- list tracked files with `git ls-files`
- read and write UTF-8 files
- inspect branch and status
- stage and commit changes
- push a branch to GitHub

Git is invoked through `tokio::process::Command`. A supplied GitHub token is
passed as an HTTP authorization header rather than embedded in the clone URL.

Security checks include:

- only accepted GitHub HTTPS clone URLs
- reject absolute paths, `..`, and `.git`
- canonicalize existing ancestors and verify they remain inside the workspace
- limit editable file size
- require session access before every operation

When using this pattern elsewhere, treat all user-provided paths and subprocess
arguments as hostile input. Prefer structured `.arg(...)` calls over building a
shell command string.

## 10. Isolated Code Execution Flow

File: `server/src/routes/compile.rs`

```text
POST /run
  -> validate language, source size, and stdin size
  -> acquire one of four semaphore permits
  -> create temporary workspace and source file
  -> start short-lived Docker container
  -> write stdin and await process output with a timeout
  -> stop timed-out container
  -> return stdout, stderr, exit code, and duration
  -> remove temporary workspace
```

Supported runtimes are represented by `LanguageRuntime`, which maps each
language to an image, filename, and execution command.

The Docker command applies several restrictions:

- no network
- memory, CPU, and process limits
- read-only root filesystem and source mount
- all Linux capabilities dropped
- no privilege escalation
- unprivileged user
- limited temporary filesystem
- execution timeout

The semaphore is backpressure: only four runs can execute concurrently, and a
request waits at most three seconds for a slot. This pattern generalizes to any
scarce resource, such as email delivery, external API calls, or expensive jobs.

## 11. PostgreSQL and SQLx

Locations:

- `server/src/db/mod.rs`
- `server/migrations/`

`PgPool` manages reusable PostgreSQL connections. Query functions accept
`&PgPool` because they borrow the pool handle; they do not take ownership.

`sqlx::query_as::<_, T>` maps database rows into structs implementing
`FromRow`. `.bind(...)` supplies parameters separately from SQL text, avoiding
SQL injection through values.

Migrations currently create:

- `users`
- `sessions`
- `session_members`
- `edit_history`

The backend runs migrations during startup.

## 12. Error Handling

File: `server/src/errors/mod.rs`

All handler failures use:

```rust
pub type AppResult<T> = Result<T, AppError>;
```

`AppError` is an enum describing expected error categories. `thiserror`
generates `Display` and standard error implementations. `#[from]` enables
automatic conversion from SQLx and `anyhow` errors when using `?`.

The `IntoResponse` implementation converts every `AppError` into an HTTP status
and JSON body. Internal details are logged but not exposed to clients.

Use this pattern in other APIs to create one error boundary between domain code
and HTTP. Route handlers can then use `?` instead of manually building error
responses at every failure point.

## 13. Backend Directory and File Responsibilities

```text
server/
├── Cargo.toml              Package metadata and dependency declarations
├── Cargo.lock              Exact resolved dependency versions
├── Dockerfile              Production backend image
├── RUNNER.md               Code-runner deployment and security notes
├── migrations/             Ordered, durable PostgreSQL schema changes
└── src/
    ├── main.rs             Composition root: initialize and wire everything
    ├── config.rs           Typed environment configuration
    ├── state.rs            Shared runtime infrastructure and registries
    ├── errors/
    │   └── mod.rs          Application error model and HTTP conversion
    ├── models/
    │   ├── mod.rs          Exposes model submodules
    │   ├── user.rs         User database and API data shapes
    │   └── session.rs      Session database and API data shapes
    ├── db/
    │   └── mod.rs          Connection pool and SQL queries
    ├── middleware/
    │   ├── mod.rs          Exposes middleware submodules
    │   └── auth.rs         JWT creation, validation, and CurrentUser injection
    ├── routes/
    │   ├── mod.rs          Exposes route submodules
    │   ├── health.rs       Liveness and service metadata endpoints
    │   ├── auth.rs         Register, login, and current-user handlers
    │   ├── sessions.rs     Session CRUD handlers
    │   ├── repositories.rs GitHub workspace handlers and path security
    │   └── compile.rs      Restricted Docker code runner
    ├── ws/
    │   ├── mod.rs          Exposes WebSocket submodules
    │   ├── messages.rs     Typed client/server WebSocket protocol
    │   ├── handler.rs      Authentication and WebSocket upgrade
    │   └── session.rs      Session actors, channels, live state, and OT
    └── ai/
        ├── mod.rs          Exposes AI submodules
        └── groq.rs         Groq request and SSE streaming adapter
```

### How to Think About These Folders Elsewhere

| Folder/file | Question it answers | Put code here when... |
|---|---|---|
| `main.rs` | How is the application assembled? | Wiring infrastructure, routers, and startup tasks |
| `config.rs` | What can deployment configure? | Reading and validating environment/settings |
| `state.rs` | What infrastructure is shared at runtime? | Pools, clients, registries, caches, and limits |
| `models/` | What data shapes does the application understand? | Defining entities, input DTOs, and output DTOs |
| `db/` | How is durable data read and written? | Writing queries or repository/data-access functions |
| `middleware/` | What cross-cutting logic runs around requests? | Authentication, authorization, request IDs, limits |
| `routes/` | What does each HTTP endpoint do? | Transport parsing, validation, orchestration, responses |
| `ws/` | How does the real-time protocol behave? | WebSocket messages, upgrades, and connection/session logic |
| `ai/` | How do we communicate with an AI provider? | Provider-specific request, response, and streaming code |
| `migrations/` | How does the schema evolve safely? | Versioned schema changes |

For a larger project, group by business feature rather than only technical
layer. For example, `features/sessions/{routes,service,repository,model}.rs`.
The current layout is appropriate while the backend remains small enough that
each technical layer is easy to navigate.

## 14. Rust Concepts Used in This Backend

### Ownership, Moves, and Borrowing

Used throughout the project:

- `String` fields own their data.
- `&str`, `&Path`, `&PgPool`, and `&AppState` borrow data temporarily.
- `async move` transfers owned/cloned values into spawned tasks.
- `socket.split()` consumes a WebSocket and produces independent sink/stream
  halves.
- `user.into()` consumes `User` to create `UserPublic`.

The actor design uses ownership as architecture: one task owns the live
document, making concurrent mutation structurally impossible.

### Structs and `impl`

Examples include `AppState`, `Config`, `User`, `Session`, request/response
shapes, and `ActorHandle`. `impl Config`, `impl AppState`, and
`impl ActorHandle` attach behavior to these types.

### Enums and Pattern Matching

Important enums:

- `ClientMessage` and `ServerMessage`: typed WebSocket protocol
- `ActorMessage`: commands accepted by a session actor
- `AppError`: application failures
- `RunError`: internal code-runner failures
- `OpType`: insert or delete operation

`match` makes all variants explicit, helping the compiler detect forgotten
cases when the protocol evolves.

### `Option` and `Result`

- `Option<T>` represents absence: optional branch, GitHub token, active file,
  exit code, or database row.
- `Result<T, E>` represents operations that may fail.
- `?` propagates errors.
- combinators such as `ok_or_else`, `map_err`, `filter`, and `and_then`
  transform optional/error values without deeply nested conditionals.

### Traits

Examples:

- `Serialize` and `Deserialize` map Rust values to/from JSON.
- `FromRow` maps PostgreSQL rows to Rust structs.
- `IntoResponse` teaches Axum how to convert `AppError` to HTTP.
- `From<User> for UserPublic` defines a safe domain conversion.
- `StreamExt` and `SinkExt` add asynchronous stream/sink methods.
- `AsyncWriteExt` adds async writing methods.

### Generics

Examples include `Result<T, AppError>`, `Option<T>`, `Vec<T>`,
`broadcast::Sender<ServerMessage>`, `mpsc::Sender<ActorMessage>`, and Axum
extractors such as `Json<T>` and `State<T>`.

### Lifetimes

Most lifetimes are inferred. Borrowed parameters such as `&str`, `&Path`, and
`Option<&str>` cannot outlive their owners. Spawned tasks use owned values
because Tokio generally requires them to be `'static`.

### Collections and Iterators

- `Vec<Participant>` and `Vec<EditOp>` hold ordered live state.
- `DashMap` stores actors by session ID.
- iterator methods include `map`, `filter`, `fold`, `find`, `retain`, `skip`,
  `cloned`, `collect`, and `into_iter`.

### Smart Pointers and Shared Ownership

`Arc<T>` provides thread-safe shared ownership of the session registry,
semaphore, and actor handles. Cloning an `Arc` increments a reference count
instead of copying the underlying value.

### Concurrency and Message Passing

- Tokio tasks via `tokio::spawn`
- bounded `mpsc` channels for many producers and one actor consumer
- `broadcast` channels for one event source and many subscribers
- `Semaphore` for concurrency limits
- `DashMap` for concurrent shared registry access
- `tokio::select!` for waiting on multiple async operations

### Async/Await, Futures, Streams, and Async I/O

The server uses async for HTTP, WebSockets, database queries, filesystem work,
subprocesses, and external API calls. `.await` yields while an I/O operation is
waiting so Tokio can run other tasks.

### Closures

Closures appear in `unwrap_or_else`, `ok_or_else`, `map_err`, `filter`,
`retain`, `find`, `fold`, and `ws.on_upgrade(move |socket| async move { ... })`.

### Modules, Paths, Visibility, and Aliases

`mod`, `pub mod`, `use`, `crate::...`, and aliases such as
`Path as AxumPath` organize the crate and resolve naming conflicts.

### Attributes and Derive Macros

- `#[derive(...)]` generates trait implementations.
- `#[serde(...)]` controls JSON representation.
- `#[tokio::main]` creates the async runtime entry point.
- `#[cfg(test)]` includes test modules only during tests.
- `#[test]` marks test functions.

### Testing

Unit tests currently cover supported runner-language mapping and repository-path
validation. They live beside the private functions they test, allowing direct
access without widening production visibility.

## 15. Rust Book Reading Map

The current official Rust Book targets Rust 2024, while this backend declares
Rust edition 2021. The core concepts below still apply; edition-specific syntax
differences are minor for this project.

Read in this order:

| Priority | Rust Book chapter | Why it matters in CodeSync |
|---|---|---|
| Essential | Ch. 3: Common Programming Concepts | Variables, functions, control flow, types |
| Essential | Ch. 4: Understanding Ownership | Borrowing, moves, slices, actor-owned state |
| Essential | Ch. 5: Using Structs | Models, configuration, state, request/response types |
| Essential | Ch. 6: Enums and Pattern Matching | Protocol messages, errors, operation types |
| Essential | Ch. 7: Packages, Crates, and Modules | Entire backend folder/module structure |
| Essential | Ch. 8: Common Collections | Strings, vectors, maps, live histories |
| Essential | Ch. 9: Error Handling | `Result`, `Option`, `?`, and application errors |
| Essential | Ch. 10: Generics, Traits, and Lifetimes | Axum/SQLx types, conversions, borrowed inputs |
| Essential | Ch. 13: Closures and Iterators | Query/result transformations and collection logic |
| Essential | Ch. 15: Smart Pointers | `Arc` and shared runtime ownership |
| Essential | Ch. 16: Fearless Concurrency | channels, shared state, `Send`, and `Sync` |
| Essential | Ch. 17: Async and Await | Tokio tasks, streams, async I/O, and `select!` foundations |
| Useful | Ch. 11: Writing Automated Tests | Existing and future backend tests |
| Useful | Ch. 12: An I/O Project | CLI/process/file concepts used by Git and runner integrations |
| Useful | Ch. 14: Cargo and Crates.io | `Cargo.toml`, dependency features, build profiles |
| Useful | Ch. 18: Object-Oriented Features | Trait objects are not central now, but useful for provider abstractions |
| Useful | Ch. 19: Patterns and Matching | Deeper understanding of destructuring and match ergonomics |
| Advanced | Ch. 20: Advanced Features | Advanced traits/types/macros; not required for daily work here |
| Useful | Ch. 21: Final Project: Multithreaded Web Server | Helps connect low-level networking/concurrency to Axum |

### Focused Study Sequence

1. Read Chapters 3 through 10 in order.
2. Re-read this backend's `models`, `errors`, `db`, and `routes`.
3. Read Chapters 13, 15, and 16.
4. Re-read `state.rs` and `ws/session.rs`, tracing ownership and channel flow.
5. Read Chapter 17.
6. Trace one WebSocket connection and the Groq stream end to end.
7. Read Chapters 11, 12, and 14, then expand the backend tests.

Useful official links:

- Rust Book: <https://doc.rust-lang.org/book/>
- Ownership: <https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html>
- Modules: <https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html>
- Error handling: <https://doc.rust-lang.org/book/ch09-00-error-handling.html>
- Traits and lifetimes: <https://doc.rust-lang.org/book/ch10-00-generics.html>
- Smart pointers: <https://doc.rust-lang.org/book/ch15-00-smart-pointers.html>
- Concurrency: <https://doc.rust-lang.org/book/ch16-00-concurrency.html>
- Async/await: <https://doc.rust-lang.org/book/ch17-00-async-await.html>

## 16. How to Trace This Backend While Learning

Use these concrete exercises:

1. **Trace registration:** `main.rs` route -> `routes/auth.rs` -> `db::users` ->
   PostgreSQL -> `UserPublic` response.
2. **Trace one edit:** `ws/handler.rs` -> connection loop -> `ActorMessage` ->
   OT transform/apply -> database snapshot -> broadcast.
3. **Trace ownership:** mark every clone, move, and borrow in
   `ws/session.rs`; explain why each spawned task needs owned values.
4. **Trace one failure:** force an unsupported runner language and follow
   `AppError::BadRequest` into its JSON HTTP response.
5. **Trace backpressure:** follow a `/run` request from semaphore acquisition
   through timeout and cleanup.
6. **Add tests:** write OT unit tests for all operation combinations and
   Unicode text. This will expose the most important correctness edge cases.

## 17. Current Architectural Risks and Natural Next Steps

Understanding limitations is part of understanding the architecture:

- `SessionActor::get_or_create` performs separate lookup and insert operations,
  so simultaneous first connections could create duplicate actors.
- session actors remain registered after their last participant leaves.
- session state sent when a user joins is broadcast to every participant,
  rather than only the joining connection.
- document persistence every ten revisions can lose the latest edits if the
  server stops before the next snapshot.
- snapshots are not explicitly flushed when an actor shuts down.
- the SQL `edit_history` table is currently unused.
- OT operation positions use byte offsets and need UTF-8 boundary validation.
- recent-history trimming does not maintain a corresponding base revision,
  which can make transformations incorrect for sufficiently stale clients.
- Git and Docker subprocess concurrency/security deserve continued production
  hardening.

These are not reasons to discard the design. They show where to evolve it:

- make actor creation atomic and remove idle actors
- persist on a debounce timer and on shutdown
- introduce targeted connection messages alongside broadcasts
- model OT history with a base revision or durable operation log
- add property-based and concurrent integration tests
- move long-running Git/runner work behind dedicated job services as scale grows

