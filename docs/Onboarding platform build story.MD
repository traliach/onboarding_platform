# onboarding_platform — Build Story

**Author:** Achille Traore | achille.tech
**Period:** 2026-04 → ongoing
**Format:** STAR (Situation → Task → Action → Result)

This document tells the story of building onboarding_platform from scratch —
the key decisions, the roadblocks, and how they were resolved. Written for
portfolio interviews and as a record of the engineering thinking behind the project.

---

## Chapter 1 — Why not a single EC2?

**Situation:**
Every previous lab project (devops-platform-lab, k8s-platform-lab) ran all tools
on a single EC2 instance. The architecture was functional but read as a lab — not
a production system. A senior interviewer looking at a single EC2 with Jenkins,
Prometheus, Grafana, and the app all running side by side would immediately flag
it as a "junior or outdated stack with no separation of concern."

**Task:**
Design an architecture that demonstrates real distributed systems thinking —
tier isolation, inter-service security, fleet management — before writing a single
line of application code.

**Action:**
Chose a five-EC2 architecture with strict tier separation:

| EC2 | Role |
|---|---|
| app | Node.js/Express API only |
| worker | BullMQ + Redis only |
| db | PostgreSQL only |
| prometheus | Metrics scraping only |
| grafana | Dashboards only |

Each EC2 has its own security group. The DB EC2 accepts connections only from the
app and worker security groups — not from a VPC CIDR. The monitoring EC2s accept
traffic only from within the VPC. No EC2 has a public IP. All ingress goes through
the ALB. Port 22 is closed on every instance — access is via SSM Session Manager only.

This design forces you to think about where things live and why before they can
talk to each other — exactly what a managed service like EKS would abstract away.

**Result:**
The architecture demonstrates network segmentation, security group design, and
fleet-level thinking in a way that a single-EC2 lab cannot. During interviews,
the question "why not EKS?" has a clean answer: "k8s is covered by k8s-platform-lab.
This project fills the gap — showing I can design and wire a distributed system
before letting a scheduler manage it."

**Key decision:**
No NAT gateway — SSM VPC endpoints replace it entirely, saving ~$33/month.
No bastion EC2 — SSM Session Manager gives shell access to every private instance.
Total cost: $47/month. Documented in ADR-001.

---

## Chapter 2 — Choosing the right stack for each tier

**Situation:**
The application needed a job queue for async provisioning, a primary database,
and a worker process. Multiple options existed for each. Choosing the wrong tool
would either hide complexity behind a managed service or introduce technology
for its own sake.

**Task:**
Select a stack that is right for the problem, demonstrable in an interview, and
genuinely useful for Dominion Systems as an internal tool.

**Action:**
Evaluated three key decisions:

**Queue: BullMQ over SQS**
SQS would be the "correct" AWS-native answer in production. But SQS abstracts
away queue internals — you never see job states, retry logic, dead-letter handling,
or worker concurrency. BullMQ on Redis exposes all of that. It also ships Bull Board,
a real-time dashboard showing queue depth and job history. For a portfolio project,
BullMQ teaches more than SQS hides. Documented in ADR-002.

**Database: PostgreSQL over MongoDB**
The onboarding data has a clear relational shape — clients own jobs, jobs own steps,
steps own audit entries. Foreign keys, transactions, and cascading deletes are the
right tool. MongoDB was the right call for achille.tech (flexible document shape).
PostgreSQL is the right call here. Running it self-managed on EC2 (not RDS) shows
you can operate a database, not just point a connection string at one.

**Runtime: Node.js + TypeScript over Python or Go**
TypeScript is mandatory across the full stack — React frontend and Node.js backend,
one language everywhere. No context-switching, shared types between client and server,
one tsconfig discipline enforced in both directions.

**Result:**
Every technology choice has a documented rationale. In an interview, the answer to
"why BullMQ and not SQS?" is not "I didn't know SQS" — it's "BullMQ exposes queue
mechanics that SQS hides, and I wanted to demonstrate I understand them."
Documented in full in docs/adr/.

---

## Chapter 3 — Two auth patterns in one project

**Situation:**
The project needed an internal dashboard for Dominion staff and a client-facing
portal for new clients to track their own onboarding progress. The naive approach
would be to use the same auth mechanism for both — or worse, to ship no auth at
all on the internal dashboard because "it's a demo."

**Task:**
Design authentication that is correct for each use case, professional end-to-end,
and worth explaining in an interview.

**Action:**
Applied two different patterns, each appropriate to its context:

**Internal dashboard — JWT:**
Email and password login. JWT stored in an httpOnly, SameSite=Strict cookie —
never in localStorage, never returned in the response body. All `/clients`,
`/jobs`, and `/analytics` routes are protected by a middleware guard that verifies
the token and attaches the user to `req.user`. Single admin user seeded via
`npm run seed` — no registration endpoint, no OAuth complexity. bcrypt with
cost factor 12 for password hashing.

**Client portal — UUID token URL:**
The client receives a link in their welcome email:
`https://onboarding.dominion.tech/portal/a3f9c2b1-7e4d-...`
No password. No session. The token is a UUID generated server-side by PostgreSQL's
`gen_random_uuid()` on client creation — unguessable, non-sequential, scoped to
exactly one client. `GET /portal/:token` returns only that client's data.
Internal job IDs, worker logs, and technical error messages are never exposed.
Plain English labels replace internal step names — the client sees "Account setup"
not "createIamUser".

This pattern is used in production by GuideCX and Rocketlane — it is a legitimate
engineering decision, not a shortcut.

**Result:**
Two auth patterns, one project. The interview talking point: "I matched the auth
mechanism to the use case. Internal staff get JWT with session management. External
clients get a magic link — same security surface as a password reset flow, zero
friction for the end user."

---

## Chapter 4 — Tier-based workflow engine

**Situation:**
Not all clients need the same onboarding steps. A Basic client needs IAM and S3.
A Professional client also needs monitoring and Slack. An Enterprise client gets
all of the above plus a credentials PDF. Hardcoding seven steps that always run
would over-provision Basic clients and under-deliver a real business rule.

**Task:**
Build a workflow engine that runs the correct steps for each client tier without
a giant if-else tree in the worker.

**Action:**
Defined a step registry — a map of tier to ordered step array. When `POST /clients`
is called with a tier, the worker reads the registry and enqueues only the steps
for that tier. Each step is a separate TypeScript file in `server/src/worker/steps/`.
Each step is independently testable without a running queue.

Step table:
| Step | Basic | Professional | Enterprise |
|---|---|---|---|
| createIamUser | ✓ | ✓ | ✓ |
| scaffoldS3Folder | ✓ | ✓ | ✓ |
| addToMonitoring | | ✓ | ✓ |
| generateCredentialsPDF | | | ✓ |
| sendWelcomeEmail | ✓ | ✓ | ✓ |
| createSlackChannel | | ✓ | ✓ |
| postSlackNotification | | ✓ | ✓ |

Every step writes a `plain_label` to the `job_steps` table — the portal-facing
description. The internal name and the client-facing name are stored separately
in the database so the portal never needs application logic to translate.

**Result:**
The new client modal shows exactly which steps will run before the user submits.
The analytics endpoint can break down failure frequency per step across all tiers.
The workflow is extensible — adding a new tier or a new step is a one-line change
to the registry plus a new step file.

---

## Chapter 5 — PostgreSQL on t2.micro

**Situation:**
[TO BE WRITTEN AFTER BUILD]

The DB EC2 is a t2.micro — 1 vCPU, 1GB RAM. PostgreSQL's default configuration
assumes it is the only process on a large server and will allocate memory accordingly.
On a shared 1GB instance also running the SSM agent, node_exporter, and CloudWatch
agent, the defaults will cause swap thrashing under any load.

**Task:**
Tune PostgreSQL to run reliably on 1GB without OOM kills or swap pressure.

**Action:**
[To be filled in when Ansible db role is implemented and tested]

Applied the following tuning in the Ansible `db` role via `postgresql.conf`:
```
shared_buffers = 128MB       # 12.5% of RAM — safe floor
work_mem = 4MB               # per sort/hash — keep low, many concurrent ops
max_connections = 20         # app + worker need ≤10; headroom for migrations
effective_cache_size = 256MB # planner hint — not actual allocation
```

**Result:**
[To be filled in after load testing on the actual instance]

**What was learned:**
[To be filled in]

---

## Chapter 6 — Ansible across five EC2s

**Situation:**
[TO BE WRITTEN AFTER BUILD]

**Task:**
Configure five different EC2 instances, each with a different role, from a single
Ansible run — with the common role running first on all instances before any
role-specific work begins.

**Action:**
[To be filled in when Ansible roles are implemented]

**Result:**
[To be filled in when `ansible-playbook site.yml` converges cleanly]

**What was learned:**
[To be filled in]

---

## Chapter 7 — Getting Terraform modules to talk to Ansible

**Situation:**
[TO BE WRITTEN AFTER BUILD]

Terraform provisions the EC2 instances. Ansible configures them. But Ansible
needs to know the private IP of each instance to build its inventory. Hardcoding
IPs is not an option — they change on every `terraform apply`.

**Task:**
Make Terraform outputs automatically drive the Ansible inventory so the two tools
stay in sync without manual intervention.

**Action:**
[To be filled in when the Terraform → Ansible handoff is implemented in infra.yml]

**Result:**
[To be filled in]

**What was learned:**
[To be filled in]

---

## Chapter 8 — CI/CD: three pipelines, one repo

**Situation:**
[TO BE WRITTEN AFTER BUILD]

A monorepo with three distinct concerns — frontend, backend, infrastructure —
needs a CI/CD design that doesn't run everything on every change. A frontend
CSS fix should not trigger Terraform. An infra security group change should not
run React tests.

**Task:**
Design three separate pipelines with clean trigger boundaries.

**Action:**
[To be filled in when workflows are implemented and tested]

**Result:**
[To be filled in]

**What was learned:**
[To be filled in]

---

## Chapter 9 — Observability as code

**Situation:**
[TO BE WRITTEN AFTER BUILD]

Prometheus and Grafana config hand-configured directly on EC2 instances would
be invisible to version control, irreproducible on a fresh deploy, and
unreviewed in pull requests.

**Task:**
Make the entire observability stack reproducible from a `git clone` and an
Ansible run — no manual steps.

**Action:**
[To be filled in when monitoring/ config is deployed and verified]

**Result:**
[To be filled in]

**What was learned:**
[To be filled in]

---

## Chapter 10 — Making alerts actually fire

**Situation:**
[TO BE WRITTEN AFTER BUILD]

Writing alert rules is straightforward. Verifying they actually fire requires
deliberately triggering the conditions — stopping a node_exporter, flooding the
queue, or intentionally failing a provisioning step.

**Task:**
Verify all four alerting rules fire in the Prometheus UI under real conditions.

**Action:**
[To be filled in after alert verification during deploy]

**Result:**
[To be filled in]

**What was learned:**
[To be filled in]

---

## Chapter 11 — The pool that cached a dead socket

**Situation:**
After wiring `/health/ready` to a real `db.ping()` that executes `SELECT 1`
against the Postgres pool, the obvious next step was to live-test it end-to-end:
stop Postgres, confirm the probe flips to 503; start Postgres, confirm it flips
back to 200. A three-line curl loop. Should have been boring.

**Task:**
Verify the readiness probe accurately reflects database reachability across a
full stop → start cycle, before moving on to the next commit.

**Action:**
The first two assertions passed. With Postgres up, `GET /health/ready` returned
200. After `docker compose stop postgres`, it returned 503 as expected. Then
`docker compose start postgres`, wait two seconds, curl again — and got **503**.
A second curl moments later returned 200.

That first 503 was the wrong answer. The DB was back, it was accepting
connections, `psql` from inside the container worked. Yet the pool was reporting
the database as unreachable.

The server logs made it obvious:

```
{"level":"error","message":"terminating connection due to administrator command"}
{"level":"warn","message":"readiness check failed","error":"Connection terminated unexpectedly"}
```

`Connection terminated unexpectedly` is not "cannot connect." It is "I tried to
reuse an existing connection and the other end had hung up on me." The pg driver
keeps idle TCP sockets inside the pool for reuse. When Postgres restarts, those
sockets are dead, but the pool has no signal to learn that until it tries one.
The first query after restart picks a dead socket, throws, and the pool evicts
it. The next query gets a fresh connection and succeeds.

So the probe was technically telling the truth — the pool genuinely could not
execute a query on that first attempt — but it was not telling the *useful*
truth. A one-shot socket eviction is not the same as "the database is down."

**What I considered but rejected:**
- **Bypass the pool on the ping path** with a one-off `pg.Client`. Would work,
  but readiness checks should exercise the same code path production traffic
  uses. A successful ping that dodges the pool proves nothing about whether
  real queries will succeed.
- **Shorten `idleTimeoutMillis` so sockets die before Postgres restarts can
  outlast them.** Fragile — only works if the restart takes longer than the
  timeout, and burns connection churn during normal operation to fix a rare
  case.
- **Lean on `pg`'s `keepAlive` TCP option.** Helps detect broken links at the
  TCP layer but does not fix the underlying race: the pool hands out cached
  sockets without validating them first.

**What actually fixed it:**
Retry the ping query exactly once, inside `db.ping()`:

```typescript
async ping(): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch {
    // pg caches idle TCP sessions inside the pool. When Postgres restarts,
    // the first query on a cached-but-dead socket throws before the pool
    // evicts it. Retry once so the ping reflects actual DB reachability
    // rather than pool cache freshness. If the retry also fails, the
    // underlying error bubbles and readiness returns 503.
    await pool.query('SELECT 1');
  }
},
```

One retry. No loop, no backoff. If the database is genuinely down, both
attempts fail in milliseconds and 503 is returned correctly. If only a cached
socket was stale, the second attempt pulls a fresh connection and the probe
returns 200 on the same request that would otherwise have returned 503.

**Why that choice over the alternatives:**
The fix lives at the right layer. Not in the HTTP handler — that would leak
pool-implementation details into route code. Not in a wrapper around every
call site — the quirk is specific to the first query after an idle gap, which
is exactly where `ping` sits. Inside `db.ping()` the retry is invisible to the
rest of the codebase, documented in a comment that explains *why* it exists so
a future reader does not delete it as dead code on a cleanup pass.

The re-run of the curl loop after the fix showed the second-try pattern in
the logs clearly — one dropped socket, one evicted, next attempt served by a
new connection — and the probe flipped 200 → 503 → 200 on the first request
after every restart.

**What I learned:**
Connection pools are caches, and every cache can lie. A healthy database is
not the same as a healthy pool socket — the pool has no out-of-band way to
learn that a TCP connection has been closed by the other side. Any health
check that goes through a pool must tolerate exactly one stale read, or it
will fail on the first request after every database restart, every network
blip, every connection the pool didn't notice dying.

The secondary lesson: **live-test the probe, do not rely on unit tests to
catch this.** Mocked unit tests would have confirmed `ping()` executes a
`SELECT 1`. They would not have caught the caching bug — only stopping real
Postgres and curling the endpoint did. Every readiness probe in every future
project goes through that same stop → start → curl loop before it ships.

---

## Chapter 12 — The logger that swallowed its own errors

**Situation:**
After wiring BullMQ's `createQueue` and `createWorker` factories in
`server/src/queue/index.ts`, the natural next step was to live-test the
enqueue path: boot the native `npm run dev` API, boot `npm run dev:worker`
in a second terminal, `POST /clients`, watch the worker pick the job up
and run the three Basic-tier steps. Three terminals, one curl, should
have been boring.

**Task:**
Confirm the full enqueue → consume round-trip works locally before moving
to the worker's step handlers and the API's write endpoints.

**Action:**
Both processes started and logged their listen banners normally. The first
oddity showed up immediately after: every second or so, both terminals
began emitting log lines that looked like this:

```
{"level":"error","service":"onboarding-platform","target":"api","timestamp":"2026-04-20T14:32:11.488Z"}
{"level":"error","service":"onboarding-platform","target":"worker","timestamp":"2026-04-20T14:32:11.522Z"}
{"level":"error","service":"onboarding-platform","target":"api","timestamp":"2026-04-20T14:32:11.551Z"}
```

No `message`. No error text. No stack. A steady stream of structured
error lines that told me *something* was wrong and absolutely nothing
about what it was.

I lost about forty-five minutes chasing the wrong layers:

- **Suspected ioredis configuration.** Pored over `maxRetriesPerRequest`,
  `lazyConnect`, the retry strategy. Everything matched the BullMQ docs
  for ioredis. No obvious bug.
- **Suspected my own error handlers weren't firing.** Added a raw
  `console.error('queue.on error fired')` inside the handler as a sanity
  check. It fired every second or so. The callback path was working; the
  payload simply wasn't making it into the log line.
- **Suspected the Winston log level.** Bumped `LOG_LEVEL=debug`, expecting
  to unlock more context. No change — I was already emitting at `error`,
  which is the loudest level, so this was the wrong knob to turn.
- **Suspected the Error object was empty.** Added
  `console.error(JSON.stringify(err))` next to the Winston call. That
  printed `{}` — which is a red herring, because `Error` instances don't
  enumerate `message` and `stack` as own properties, so `JSON.stringify`
  always renders them as `{}`.

What broke the loop was rereading my own log call one more time:

```typescript
connection.on('error', (err) => {
  logger.error('redis connection error', { message: err.message, code: err.code });
});
```

The metadata object has a key called `message`. Winston's JSON formatter
has a top-level key called `message`. They are the same key.

Winston's documented behavior — which I had read, understood, and
promptly forgotten — is that when a log entry's metadata contains any of
the formatter's reserved keys (`message`, `level`, `timestamp`), the
metadata value **wins**. It silently overwrites the string I passed as
the first argument.

And `err.message` on an `ioredis` connection failure is not always what
you would hope. When ioredis is in its reconnect loop and the socket
closes mid-handshake, the error it emits sometimes has an empty
`.message` — the TCP layer aborted before any protocol-level text got
generated. So the metadata's empty-string `message` was overwriting my
`'redis connection error'` string, and what reached stdout was a log
line whose only human-readable field was now `""`.

The logs were not empty because nothing was happening. They were empty
because the logger had a bug in the field I had chosen to put context
into, and the field it overwrote was the only one I was reading.

**What I considered but rejected:**

- **Switch to Winston's `format.errors({ stack: true })` layer.** It was
  already in the formatter pipeline. It only special-cases `Error`
  instances in the *top-level* position, not inside metadata, so it
  couldn't help here.
- **Pass the `Error` as the first argument — `logger.error(err)`.**
  Winston 3 accepts this and happily logs stack + message. But it
  replaces the free-text "what were we doing when this happened" context
  string with the error's own message. I would lose `"redis connection
  error"` as the thing-that-identifies-the-call-site. That string is what
  `grep` finds in production logs when you need to count how often a
  particular call site failed versus a different one that happens to
  produce the same error text.
- **Migrate to a different structured logger (pino, bunyan).** Pino
  reserves the same handful of top-level keys. Bunyan reserves `msg`.
  Every structured logger has a reserved-key list. Swapping one for
  another moves the problem; it does not remove it.
- **Give up on structured metadata for error logs and interpolate into
  the message string.** That reintroduces the shell-grep era of log
  parsing — you cannot query on `code=ECONNREFUSED` in Grafana if
  `ECONNREFUSED` is fused into a free-text string. A non-option for a
  project whose whole observability story is structured logs.

**What actually fixed it:**

Rename the colliding key. Everywhere in the codebase where metadata
carried an error's `.message`, the key became `error`:

```typescript
connection.on('error', (err) => {
  logger.error('redis connection error', { error: err.message, code: err.code });
});
```

Three files had the same latent collision — I changed them all in one
commit so the next instance of the bug could not go unnoticed while I
was already thinking about it:

- `server/src/queue/index.ts` — the BullMQ connection and worker error
  handlers.
- `server/src/db/pool.ts` — the `pg` pool `'error'` event, which fires
  when Postgres restarts mid-query with `"Connection terminated
  unexpectedly"` — a message I really wanted to see rather than
  shadow.
- `server/src/index.ts` — the process-level `uncaughtException` and
  `unhandledRejection` handlers. `unhandledRejection` got `{ reason:
  describeError(reason) }` rather than `{ message: ... }` for the same
  reason and for extra safety, since the rejected value is not always an
  `Error`.

After the rename the next error line read:

```
{"level":"error","message":"redis connection error","error":"connect ECONNREFUSED 127.0.0.1:6379","code":"ECONNREFUSED"}
```

Which answered the question in one line: the Redis container was not
running. `docker compose up -d redis` unstuck the enqueue loop and the
rest of the commit finished in minutes.

**Why that choice over the alternatives:**

The fix lives at the boundary between the calling code and the logger,
not inside either of them. Renaming the metadata key is a
single-character-per-call-site change that preserves the original
intent (free-text context as the first argument, structured detail as
the metadata) and makes the logger's reserved-key contract impossible
to violate accidentally. The alternatives either move the bug
(different logger), surrender structure (interpolate into the message),
or sacrifice grep-ability (pass the `Error` as the first argument).
Renaming was the smallest fix with the smallest blast radius.

The preemptive cleanup of `db/pool.ts` and `index.ts` was the
non-obvious part of the choice. I could have changed only the file
where the bug had actually manifested. But the collision is a property
of Winston's formatter, not of the queue code — any other file passing
`{ message: err.message }` to `logger.error` was a time bomb that
would fire the next time *its* upstream went unhealthy. The cost of
fixing all three sites while the root cause was fresh was smaller than
the cost of rediscovering the same bug during a different debugging
session three weeks later.

**What I learned:**

Your logger is a data structure with a schema, and that schema has
reserved fields. Treating metadata as a free-form bag is how you
discover the reserved-field list the hard way — by having important
information silently disappear into a collision with a key the library
already owns.

The generalised debugging heuristic: **when a structured log field is
unexpectedly empty, the first place to look is the logger's source for
that exact field name.** Not the code that *produces* the value. Not
the upstream service. The formatter. Logger-layer bugs are invisible
because the artefact they produce is "nothing," which looks identical
to "nothing is wrong."

Secondary lesson: observability is the last layer you should trust and
the first layer to suspect when a system seems to be failing silently.
Readiness probes can lie about the pool (Chapter 11); log formatters
can lie about the errors; metrics can lie about the scrape. Every one
of these lies showed up the same way during this project — not with a
raised exception, but with data that was present and confidently wrong.
The reflex to build: when the system looks healthy but feels broken,
distrust the thing that is telling you it is healthy before distrusting
the code under it.

---

## Summary of key engineering decisions

| Decision | Alternative considered | Why this choice |
|---|---|---|
| Five EC2 tiers | Single EC2 | Forces real security group segmentation and fleet management thinking |
| SSM over SSH | SSH key pairs | No IP restrictions, port 22 closed, works from anywhere |
| No NAT gateway | NAT gateway | SSM VPC endpoints give private internet access for $7/month vs $33/month |
| BullMQ over SQS | SQS | Exposes queue internals — retry logic, dead-letter, worker concurrency |
| PostgreSQL self-managed | RDS | Shows you can operate a database, not just connect to one |
| t2.micro × 5 | Larger instances | $47/month total; PG tuning shows cost-aware operational thinking |
| JWT in httpOnly cookie | localStorage | XSS-safe; industry-standard pattern for session management |
| UUID token for portal | Password login | Magic link pattern — legitimate production approach, zero user friction |
| Plain English portal labels | Show internal step names | Client never sees "createIamUser" — two vocabularies, one data model |
| Tier-based step registry | Hardcoded step list | Extensible; new tiers or steps are one-line additions |
| Split monitoring EC2s | Combined Prometheus + Grafana | Each fits in 1GB alone; together they would need t3.small at $7/month more |
| gp3 over gp2 EBS | gp2 | Same cost, 20% more throughput, 3× baseline IOPS |
| Three separate workflows | One monorepo pipeline | Blast radius isolation — a CSS fix never runs Terraform |
| monitoring/ in repo | Hand-configure on EC2 | Reproducible, reviewable, version-controlled observability |
| ADRs per decision | No documentation | Most candidates don't write ADRs — interviewers notice |