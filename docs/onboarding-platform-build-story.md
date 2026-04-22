# onboarding_platform — Build Story

**Author:** Achille Traore | achille.tech
**Format:** STAR (Situation → Task → Action → Result)

This document records the engineering decisions and obstacles encountered while
building onboarding_platform — written for portfolio interviews and as a
permanent record of the thinking behind the project.

---

## Chapter 1 — The email thread problem

**Situation:**
A remote MSP serving mid-size companies (10–200 employees) was onboarding
5–15 new clients per month through a team of 3–5 people. Every onboarding
started as an email thread. Over the next 1–2 weeks the team would manually
create an IAM user, scaffold an S3 folder, configure monitoring (if the client's
tier included it), send a welcome email, create a Slack channel, and notify the
internal team — all tracked through replies in the same thread. No central view,
no audit trail, no consistency between clients.

**Task:**
Design and build a production-representative platform that automates the
provisioning workflow, gives the team a single dashboard, and gives each client
a portal to track their own onboarding — without adding cloud cost beyond what
the $47/month budget allowed.

**Action:**
- Chose a monorepo (ADR-005) so a single TypeScript codebase covers the React
  frontend, Express API, and BullMQ worker without duplication.
- Designed three authentication patterns in one project: JWT session cookie for
  staff, UUID portal token for clients, invite-only registration for new staff
  accounts (ADR-009).
- Built a tier-based step registry pattern so adding a new tier or step is one
  file and one registry entry, never an if-else tree.
- Provisioning steps (IAM, S3, Slack, etc.) are simulated with structured log
  output — the portfolio focus is the orchestration layer, not the integrations.

**Result:**
A working full-stack platform: React dashboard (Vercel), Express API + BullMQ
worker (EC2), PostgreSQL (EC2), Prometheus + Grafana observability (two EC2s),
an ALB, and SSM-only access — all for approximately $47/month on AWS.

---

## Chapter 2 — The infrastructure decision: SSM over NAT

**Situation:**
Five t2.micro EC2 instances in a private subnet with no public IPs. The team
needs shell access without spending $33/month on a NAT gateway or adding
bastion attack surface.

**Task:**
Find an access path that is secure, cost-free, and compatible with Ansible
(which needs to execute commands on each host).

**Action:**
Deployed five SSM VPC endpoints (ADR-001): `ssm`, `ssmmessages`, `ec2messages`,
`ecr.api`, `ecr.dkr`, and `s3` (gateway, free). This lets `aws ssm start-session`
reach every instance over HTTPS without a NAT gateway. Port 22 is closed on every
security group.

Configured Ansible's `community.aws.aws_ssm` connection plugin so the standard
`ansible-playbook` command tunnels through SSM — no SSH keys, no key pairs, no
bastion.

**Result:**
- Zero NAT gateway cost saved ~$33/month.
- Security posture improved: no inbound rules for SSH anywhere in the fleet.
- All five instances show up in SSM Fleet Manager within 60 seconds of launch.
- The `render-inventory.sh` → `ansible-playbook` flow works identically locally
  and in CI.

---

## Chapter 3 — Remote state and OIDC: no static credentials

**Situation:**
Terraform's default local state doesn't survive ephemeral CI runners. The
standard fix (static `AWS_ACCESS_KEY_ID` in GitHub secrets) is the leading
cause of AWS account compromises in public repos.

**Task:**
Set up remote state with locking and eliminate all long-lived credentials from
the repo and CI pipeline.

**Action:**
Created an S3 backend (`achille-tf-state`, shared bucket, project-scoped key)
with a DynamoDB lock table (ADR-007). Configured GitHub Actions to authenticate
via OIDC: the runner exchanges a short-lived GitHub token for an AWS role
(`onboarding-platform-github-actions`) scoped to the exact repo and branch.
No access keys exist anywhere — not in GitHub secrets, not in `.env`, not
in the codebase.

**Result:**
- `terraform apply` is gated to `refs/heads/main` in `infra.yml`; feature
  branches can only `plan`.
- The worst case of a leaked secret (`AWS_ROLE_TO_ASSUME`) is an ARN an
  attacker cannot use without a valid GitHub OIDC token for this repository.
- Zero added monthly cost (S3 state: ~$0.02/month; DynamoDB: $0 at idle).

---

## Chapter 4 — Observability that lives in the repo

**Situation:**
Prometheus and Grafana are running on dedicated EC2s, but their configuration
(scrape targets, alert rules, dashboards) is often hand-configured — meaning
it disappears on a fresh deploy and can't be reviewed in a PR.

**Task:**
Treat observability configuration as code: version-controlled, reviewed, and
deployed by Ansible — never hand-configured on the EC2.

**Action:**
All Prometheus and Grafana config lives in `monitoring/` (ADR-003):
- `prometheus.yml`: scrape config for all five EC2s (node_exporter on :9100,
  API on :3000/metrics).
- `alerts.yml`: four rules — EC2Down, HighMemoryUsage, JobQueueDepth,
  JobFailureRate.
- `grafana/dashboards/`: two JSON dashboards provisioned via Grafana's
  provisioning API — never created in the UI.

Ansible's `prometheus` and `grafana` roles deploy from the repo on every
`infra.yml` run. A dashboard edit is a PR, not an SSH session.

Instrumented the Express API with `prom-client`: default Node.js metrics
plus BullMQ gauges (`bullmq_queue_depth`, `bullmq_jobs_active`,
`bullmq_jobs_completed`, `bullmq_jobs_failed`) polled from Redis every 30 s
and exposed on `GET /metrics` at :3000.

**Result:**
- `git log monitoring/` is the full history of every observability change.
- Alert rules fire in Prometheus UI within seconds of a scrape miss.
- No configuration drift between environments: whatever is in `monitoring/`
  is what runs on the fleet.

---

## Chapter 5 — Three auth patterns, one project

**Situation:**
The platform has two distinct user types (internal staff, external clients)
and a controlled team growth path (no open registration). Each requires a
different auth mechanism appropriate to its threat model.

**Task:**
Implement all three without coupling them or reusing the wrong pattern for
the wrong context.

**Action:**

**JWT sessions (internal staff):**
`POST /auth/login` sets an httpOnly, SameSite=Strict cookie — never the
response body. The JWT middleware in `server/src/middleware/auth.ts` is the
single point of verification; routes never inline it. `JWT_SECRET` comes
from environment only (minimum 32 random characters).

**UUID portal tokens (external clients):**
`GET /portal/:token` is public. Tokens are UUIDs generated server-side by
`gen_random_uuid()` in PostgreSQL — never client-supplied, never guessable.
The response is scoped strictly to the one client's data; no internal IDs or
other clients' rows are ever returned.

**Invite-only registration (new staff accounts):**
`POST /auth/invite` (JWT required) generates a single-use UUID token stored
in `invite_tokens` with a 24-hour expiry. The admin copies the link from
`InviteUserModal` and sends it manually — no SMTP dependency. Registration
atomically creates the user and marks the token used in a single transaction.

The meta-story: the platform provisions its own users with a token-based
invite flow — the same mechanism it uses for external clients.

**Result:**
- Zero open registration surface.
- JWT never touches localStorage.
- Portal never leaks internal data.
- Invite tokens are single-use, time-limited, and tamper-proof.
- All three patterns exercise different security tradeoffs in one codebase —
  a demonstrable answer to "how do you think about authentication design?"

---

## Chapter 6 — CI/CD: three workflows, three blast radii

**Situation:**
One monorepo, three deployables (frontend, backend, infra) with different
cadences, different credentials, and different failure modes. A single
umbrella workflow would mix AWS credentials into frontend jobs and make every
PR's check column noisy.

**Task:**
Design three independent, path-filtered workflows with the smallest possible
credential footprint per workflow (ADR-008).

**Action:**
- `client.yml`: triggered by `client/**`. ESLint → typecheck → Vitest → Vite
  build → Vercel deploy (main only). No AWS access.
- `server.yml`: triggered by `server/**`. ESLint → typecheck → Jest → Docker
  build (PR) → ECR push with traceable `DATE-SHORTSHA-MSG` tag (main only,
  OIDC). No mutable `:main` or `:latest` alias.
- `infra.yml`: triggered by `infra/**` + `monitoring/**`. Terraform fmt/validate
  → plan (PR comment) → apply + Ansible + ALB smoke test (main only, OIDC).

Each workflow has `permissions: contents: read` by default; only `infra.yml`
adds `id-token: write` and `pull-requests: write`.

**Result:**
- A client-only PR never triggers the infra workflow.
- An infra misconfiguration never blocks a frontend deploy.
- CI credentials are scoped: a compromised frontend build step has no AWS
  identity to exploit.
- Image tags are traceable: `20260420-a3f9c2b-add-jwt-auth` is unambiguous;
  `:latest` and `:main` are not.

---

## Chapter 7 — BullMQ counters the scraper could never read

**Situation:**
The platform has a worker process (BullMQ consumer on the worker EC2) and an
API process (Express on the app EC2). Both import the same `server/src/metrics.ts`
module, which registered two prom-client Counters:
`bullmq_jobs_completed_total` and `bullmq_jobs_failed_total`. The worker
incremented them on `completed` and `failed` BullMQ events. The API exposed
`GET /metrics` using the same shared Registry. On paper it looked wired up.

**Task:**
During a review pass, confirm that Prometheus was actually receiving BullMQ
metrics — not just that the code compiled and the endpoint responded.

**Action:**
Two separate failures surfaced, one at the network layer and one at the process
model layer.

**Failure 1 — the security group was wrong:**
The app EC2's security group allowed port 3000 inbound only from the ALB
security group. Prometheus runs on the monitoring EC2, which is in a different
security group. There was no ingress rule allowing the monitoring SG to reach
port 3000 on the app SG. Prometheus would have connected and timed out — the
scrape target would show as `DOWN` for a reason that had nothing to do with the
application code.

Fix: added a second ingress rule to `aws_security_group.app` — TCP 3000 from
`aws_security_group.monitoring.id`, description "API metrics from Prometheus".
Scoped to the monitoring SG only, not the VPC CIDR.

**Failure 2 — the counters lived in the wrong process:**
prom-client metrics are in-process state. The worker increments
`bullmq_jobs_completed_total` inside the worker process's Registry. The API
exposes `/metrics` from the API process's Registry. These are two separate
OS processes on two separate EC2s — they share no memory. The API's Registry
had those counters registered (because it imports the same module) but they
were always at zero, because the API never processes jobs and never increments
them. Prometheus scrapes the API. The worker's counters are never scraped at all.

The initial code passed typecheck and linting cleanly, the endpoint returned
valid Prometheus text, and the dashboard would have loaded without error —
showing a flat zero line for two metrics that appeared to be working.

Fix: removed the counters entirely. Added `getJobCounts()` to the `JobQueue`
interface: a single method that calls `queue.getWaitingCount()`,
`getActiveCount()`, `getCompletedCount()`, and `getFailedCount()` in parallel
against Redis. The API polls this every 30 seconds in `main()` and writes the
results into four Gauges (`bullmq_queue_depth`, `bullmq_jobs_active`,
`bullmq_jobs_completed`, `bullmq_jobs_failed`). The API is the only process
that talks to Redis as a producer — it already owns the queue connection —
so this adds no new dependency.

**What didn't work:**
The alternative was to give the worker its own HTTP server on a separate port
(e.g. :9102) and add a second Prometheus scrape job targeting the worker EC2.
This would have required: a new ingress rule on the worker SG, a new `job`
block in `prometheus.yml`, and a second `app.listen()` in the worker entry
point. It also would have produced two separate metric endpoints that had to
be correlated in Grafana. More surface, more config, harder to reason about.

The API-polls-Redis approach consolidates everything into the one endpoint
Prometheus already scrapes, adds no new ports, and the polling cost (four
Redis commands every 30 s) is negligible on a t2.micro.

**What also needed fixing as a consequence:**
- `alerts.yml`: `JobFailureRate` used `increase(bullmq_jobs_failed_total[10m]) > 5`.
  A gauge does not accumulate monotonically, so `increase()` is not valid.
  Changed to `bullmq_jobs_failed > 5` — a threshold on the current failed-state
  count, which is what the alert was always trying to express.
- `onboarding-jobs.json`: the Grafana dashboard referenced four metric names
  (`bullmq_pending_jobs_total`, `bullmq_active_jobs_total`, etc.) that were
  never emitted. The HTTP Request Duration panel used
  `http_request_duration_seconds_bucket`, which requires a Histogram that was
  never instrumented. All panels were updated to use the actual emitted names;
  the HTTP latency panel was removed.

**Result:**
- Prometheus can reach `/metrics` on port 3000 (security group fixed).
- All four BullMQ queue counts are scraped from a single endpoint, from a
  single process, with no worker HTTP server.
- `JobFailureRate` fires on a meaningful condition — current failed-job count
  above threshold — rather than a `increase()` expression over a metric that
  was permanently zero.
- The Grafana dashboard loads without "No data" panels.
- The lesson: a metric that is registered, incremented, and exposed at
  compile time can still be invisible to Prometheus at runtime if the topology
  is wrong. Code review is not enough — you have to trace the scrape path.
