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

---

## Chapter 8 — The partial apply trap

**Situation:**
After smoke preflight finally went green, the next step was the first real AWS
deploy: one Terraform apply to bring up the VPC, ALB, five private EC2s, VPC
endpoints, and the EC2 IAM role/profile. The plan was clean — 35 to add, 0 to
change, 0 to destroy — and on paper this was supposed to be the boring part:
apply infra, push the image, run Ansible.

**Task:**
Get the first smoke fleet through `terraform apply` without repairing anything
manually in the AWS console, and keep Terraform as the only source of truth even
if the first apply only half-succeeds.

**Action:**
The first apply did not fail cleanly. It created a large part of the stack:
VPC, subnets, route tables, IGW, target group, ALB, security groups, VPC
endpoints, and the EC2 IAM role/profile. Then every EC2 launch failed with the
same error:

```text
InvalidBlockDeviceMapping: Volume of size 20GB is smaller than snapshot ... expect size >= 30GB
```

That was the first wrong assumption. The Terraform default still forced
`ebs_volume_size = 20`, but the current Amazon Linux 2023 AMI's root snapshot
had grown to 30 GiB. The code was valid, the plan was valid, and AWS still
rejected the instances because the moving part was not Terraform syntax — it
was the upstream AMI shape.

So the first fix was straightforward but had to be done in code, not in the
console:

- changed the Terraform default root volume size from 20 GiB to 30 GiB
- updated `terraform.tfvars.example`
- added a validation rule so future plans fail early if anything below 30 GiB
  is set

That should have been the end of it. It was not.

During the same deploy pass, I also cleaned the security group descriptions:
first because AWS had already rejected characters like `>` / em dashes in one
earlier plan, and second because I did not want internal documentation names in
live AWS resource descriptions.

That exposed the second wrong assumption: for this ALB security group, changing
the description was not an in-place update. Terraform planned a replacement.
Applying that replacement naively caused a new stall — Terraform sat for more
than ten minutes trying to destroy the ALB security group while the ALB was
still attached to it.

**What didn't work:**
- Reusing the old `tfplan` after the first partial apply. Once the first apply
  had created real resources, the next run was no longer "finish the original
  plan" — it was a migration from the current state.
- Treating the ALB security group description cleanup as harmless metadata.
  On an attached security group, that metadata change effectively became a
  replacement operation.
- Letting Terraform destroy the original ALB security group under the same
  name. The ALB dependency made the destroy hang long before the EC2 part of
  the apply could finish.

**What actually fixed it:**
Two code changes, both in Terraform:

1. **Raise the EC2 root volume floor to 30 GiB.**
   That aligned the module with the actual AL2023 snapshot size and allowed the
   EC2 instances to launch at all.

2. **Turn the ALB security group cleanup into an explicit create-before-destroy
   migration.**
   The group was renamed from `onboarding-platform-alb-sg` to
   `onboarding-platform-alb-public-sg` and given:

```hcl
lifecycle {
  create_before_destroy = true
}
```

That forced Terraform to create the replacement security group first, move the
ALB over to it, and only then destroy the old one. No console edits, no manual
detach/reattach, no state surgery.

The final apply completed successfully:

- `7 added, 2 changed, 1 destroyed`
- ALB DNS output available
- all five EC2 instance IDs and private IPs returned

**Why that choice over the alternatives:**
The tempting alternatives were all operational shortcuts:

- manually increase the EBS size in the console
- manually detach or delete the old ALB security group
- force the state forward and "clean it up later"

All three would have made the immediate deploy look faster while making the next
fresh-account deploy fail in exactly the same way. The point of the project is
not "I can eventually get AWS resources to appear." The point is that the repo
itself contains the deployable truth.

Raising the root volume default and making the ALB security group replacement
explicit in Terraform fixed the real problem once, in the place future applies
actually read from. It also kept the failure legible: the first issue was an
AMI/root-volume mismatch; the second was a replacement-order problem on an
attached resource. Neither needed a human workaround if the module described the
migration correctly.

**Result:**
The smoke fleet came up without any manual AWS console repair:

- `alb_dns_name = onboarding-platform-alb-637111522.us-east-1.elb.amazonaws.com`
- five EC2 instances created (`app`, `db`, `worker`, `prometheus`, `grafana`)
- VPC and private-networking layer intact
- ALB replacement completed cleanly with the new public security group

Just as important, the deploy documentation now reflects the wrong turns:
partial apply, stale plan reuse, AMI root-volume drift, and the attached
security-group replacement trap. The next operator does not have to rediscover
them.

**What I learned:**
A partial Terraform apply is not just "a failed apply." It is a state-changing
event that turns the next run into a migration problem. Once AWS has created
half the stack, the right question is no longer "how do I rerun the command?"
but "what does Terraform believe exists now, and what transition am I asking it
to perform next?"

The second lesson was more specific: seemingly minor metadata cleanups can have
real infrastructure consequences. On AWS, a security group description can be
"just a string" right up until that string implies a replacement on a live,
attached resource. If the replacement order is wrong, the apply stalls in a
way that looks like AWS is slow when the actual problem is the migration shape.

The practical takeaway is now permanent in the module: validate moving
assumptions like AMI-backed volume size, and when an attached network resource
must be replaced, make the create-before-destroy path explicit instead of
hoping the provider will infer it.

---

## Archived Expanded Draft Notes

The section below preserves the older private build-story draft so there is one
private build-story file on disk and no tracked build-story document in Git.

# onboarding_platform — Build Story

**Author:** Achille Traore | achille.tech
**Period:** 2026-04 → ongoing
**Format:** STAR (Situation → Task → Action → Result)

This document tells the story of building onboarding_platform from scratch —
the key decisions, the roadblocks, and how they were resolved. Written for
portfolio interviews and as a record of the engineering thinking behind the project.

---

## Chapter 1 — The email thread problem

**Situation:**
Dominion Systems is a remote MSP serving mid-size companies (10-200 employees)
across multiple countries. The services span IT support, cloud infrastructure, and
software deployment — the exact scope depending on what each client contracted for.
At any given month, the team of 3-5 people was onboarding between 5 and 15 new clients.

The onboarding process had no system behind it. When a contract was signed, someone
on the team would start an email thread. Over the next 1-2 weeks, they would manually
create an IAM user, set up an S3 bucket, configure monitoring if the client's tier
included it, send a welcome email, create a Slack channel, and notify the internal
team — all tracked through replies in that same email thread. There was no central
view of where any client was in the process. No audit trail of who did what and when.
No way to hand off mid-onboarding if the person who started it was unavailable.
No consistency between clients — the steps happened in whatever order the person
remembered them.

At 5 clients a month this was manageable. At 15 it was genuinely chaotic.

**Task:**
Replace the email thread process with a system that:
- Gives the whole team a single view of every client's onboarding status
- Runs the correct provisioning steps automatically based on the client's tier
- Gives each new client visibility into their own onboarding progress
- Creates an audit trail of every action taken and when
- Is production-grade enough to actually deploy for real Dominion clients once
  the mocked provisioning steps are connected to real AWS APIs

This is a real operational problem at a real company. The portfolio angle is secondary.

**Action:**
Before writing a single line of application code, the architecture had to be designed
correctly — because the architecture itself is part of what the project demonstrates.

Every previous lab project (devops-platform-lab, k8s-platform-lab) ran all tools on
a single EC2 instance. That was fine for labs. For a tool that would eventually run
in production for Dominion clients, a single EC2 with the API, worker, database, and
monitoring all colocated would read as exactly what it was — a lab, not a system.

Chose a five-EC2 architecture with strict tier separation:

| EC2 | Role |
|---|---|
| app | Node.js/Express API only |
| worker | BullMQ + Redis only |
| db | PostgreSQL only |
| prometheus | Metrics scraping only |
| grafana | Dashboards only |

Each EC2 has its own security group. The DB EC2 accepts connections only from the
app and worker security groups — not from a blanket VPC CIDR. The monitoring EC2s
accept traffic only from within the VPC. No EC2 has a public IP. All ingress goes
through the ALB. Port 22 is closed on every instance — access is via SSM Session
Manager only.

This design forces explicit decisions about where things live and why before they
can talk to each other — exactly what a managed service like EKS would abstract away.

The cost constraint was also real: the platform needed to run for under $50/month
so it could stay live between client demonstrations without becoming a budget line
item. Choosing t2.micro across all five instances with SSM VPC endpoints instead of
a NAT gateway brought the total to $47/month.

**Result:**
The operational problem now has a system behind it. When a contract is signed, the
team creates a client in the dashboard, selects their tier, and submits. The provisioning
job runs automatically. Every step is logged. The team has a single view across all
active onboardings. The client receives a link to their own portal where they can
see their progress without needing to ask.

The 1-2 week manual process is not eliminated on day one — the provisioning steps
are currently mocked — but the workflow, the visibility, and the audit trail are real
from the first deploy. Connecting the steps to real AWS APIs is the next phase.

In interviews, the answer to "why did you build this?" is concrete:

> "At Dominion we were onboarding 5 to 15 clients a month through email threads
> across a team of 3-5 people. Each onboarding took 1-2 weeks. No visibility,
> no audit trail, no consistency between clients. I built a system to fix that —
> and designed it to be production-grade from the start so it could actually go live."

**Key decisions made at this stage:**
- Five EC2 tiers instead of one — forces real security group segmentation and
  demonstrates fleet-level thinking that a single-EC2 lab cannot
- No NAT gateway — SSM VPC endpoints replace it, saving ~$33/month (ADR-001)
- No bastion EC2 — SSM Session Manager provides shell access to every private instance
- t2.micro across all five instances — $47/month total, viable as a permanent deployment
- PostgreSQL tuned for 1GB RAM — not just installed, but configured for the constraint

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
