# onboarding_platform

> Production-representative client onboarding platform — React frontend,
> Node.js + TypeScript API and BullMQ worker, PostgreSQL, a 5-EC2 AWS fleet
> configured with Terraform and Ansible, Prometheus + Grafana observability,
> JWT + UUID-token dual auth. Built as a portfolio demonstration of
> distributed-systems thinking on a ~$47/month budget.

![License](https://img.shields.io/github/license/traliach/onboarding_platform)
![Tag](https://img.shields.io/github/v/tag/traliach/onboarding_platform)

[![server](https://github.com/traliach/onboarding_platform/actions/workflows/server.yml/badge.svg)](https://github.com/traliach/onboarding_platform/actions/workflows/server.yml)
[![client](https://github.com/traliach/onboarding_platform/actions/workflows/client.yml/badge.svg)](https://github.com/traliach/onboarding_platform/actions/workflows/client.yml)
[![infra](https://github.com/traliach/onboarding_platform/actions/workflows/infra.yml/badge.svg)](https://github.com/traliach/onboarding_platform/actions/workflows/infra.yml)

---

## What it does

- **Internal dashboard** (JWT auth, httpOnly cookie) for staff to create
  clients, watch their provisioning run step-by-step, retry failed steps,
  and read cross-client analytics.
- **Client portal** (UUID token URL, no password) for each new client to
  track their own onboarding in plain English — no internal step names,
  no technical logs, no other clients' data.
- **REST API** that accepts client submissions, writes the client and the
  job/steps to PostgreSQL inside one transaction, then enqueues the job
  on BullMQ. The worker runs the tier-specific step set (3 for Basic,
  6 for Professional, 7 for Enterprise), updating `job_steps` as it goes.
- **Analytics** endpoint surfaces completion rate, average step duration,
  and per-step failure frequency directly from PostgreSQL.
- **Observability**: every EC2 ships metrics to a dedicated Prometheus
  instance; Grafana renders a fleet-overview dashboard and an
  onboarding-jobs dashboard. Four alerting rules are provisioned and
  verified firing (instance down, queue depth, high memory, job failure
  rate).

Provisioning steps (IAM user, S3 scaffold, Slack channel, etc.) are
**simulated** — the side effects are logged, not real AWS / Slack SDK
calls. The portfolio focus is the orchestration layer, the observability
surface, and the infrastructure story, not the integrations themselves.

## Status

| Area | State |
|------|-------|
| Backend | **Complete.** API, worker, dual auth (JWT + UUID token), analytics, tier-based step registry, retry endpoint, Docker image, 45-test suite. |
| Frontend | **Complete.** Dashboard (clients + analytics tabs), portal page, login, client detail with live step polling and retry UI. Deployed to Vercel free tier. |
| Local stack | **Complete.** `docker compose up` starts the full backend in one command. |
| Terraform | **Complete.** VPC, security groups (per-tier SG segmentation), 5 × t2.micro EC2s, ALB, SSM VPC endpoints, S3 remote state + DynamoDB locking, GitHub OIDC role. |
| Ansible | **Complete.** Six idempotent roles (common, db, worker, app, prometheus, grafana) run in order by a single master playbook over SSM. |
| Monitoring | **Complete.** `monitoring/` holds Prometheus scrape config + 4 alert rules + 2 provisioned Grafana dashboards. Ansible deploys from the repo — nothing is hand-configured on the EC2. |
| CI/CD | **Complete.** Three path-scoped workflows. `server.yml` builds + pushes to ECR on main. `infra.yml` runs `terraform apply` + Ansible + ALB smoke test on merge. |
| Docs | **Complete.** 10 ADRs, `cost.md`, `architecture.md`, `runbook.md`. |

Built commit-by-commit with plain-English messages — `git log --oneline` is
the change history.

## Architecture

```
                        ┌────────────────────────────┐
  Browser / Vercel ─────►  ALB  (public, port 80)    │
                        └──────────────┬─────────────┘
                                       │ :3000
                              private subnet only
                        ┌──────────────▼─────────────┐
                        │  app EC2  (Express API)     │
                        └──┬──────────────────────┬──┘
                     :5432 │                :6379  │
              ┌────────────▼──────┐  ┌────────────▼──────┐
              │  db EC2           │  │  worker EC2        │
              │  PostgreSQL 16    │◄─│  BullMQ + Redis    │
              └───────────────────┘  └───────────────────┘
                     :9100 ▲               :9100 ▲
              ┌────────────┴───────────────────┐
              │  prometheus EC2  (:9090)        │
              └───────────────────────────────┬─┘
                                              │ :9090
                                  ┌───────────▼──────┐
                                  │  grafana EC2      │
                                  │  (:3000 via SSM)  │
                                  └──────────────────┘

  Port 22 closed. Shell access: SSM Session Manager only.
  No NAT gateway — SSM/ECR traffic via VPC interface endpoints.
```

Full tier diagram, security-group matrix (exact ports), and data-flow
walkthrough: [`docs/architecture.md`](./docs/architecture.md).

## Quick start — local backend

Prerequisites: Docker Desktop, Node 22+, Git.

```bash
git clone https://github.com/traliach/onboarding_platform.git
cd onboarding_platform
cp .env.example .env          # fill in JWT_SECRET and admin password
docker compose up -d          # postgres, redis, api, worker
docker compose exec api node dist/server/src/db/seed.js   # admin + sample clients
```

Then:

- API root:       http://localhost:4000
- Health:         http://localhost:4000/health
- Readiness:      http://localhost:4000/health/ready
- Default admin:  `admin@onboarding.local` / `changeme-dev-only`

Log in, create a client, and watch the worker output stream step-by-step in
`docker compose logs -f worker`.

Tests:

```bash
cd server
npm test
```

45 tests run in under two seconds (passwords, tokens, step handlers,
workflow registry, auth and invite HTTP integration).

## Auth — two patterns, one project

- **Internal dashboard** uses JWT, issued on `POST /auth/login`, stored
  in an **httpOnly, SameSite=Strict cookie** — never localStorage, never
  returned in the response body. Passwords are hashed with bcrypt
  (minimum cost 12 enforced at config-validation time). All `/clients`,
  `/jobs`, and `/analytics` routes are guarded by the JWT middleware.
- **Client portal** uses **UUID token URLs** generated server-side by
  Postgres `gen_random_uuid()` at client creation. The email the client
  receives carries the link `https://<host>/portal/<uuid>`; no password,
  no session, no other client's data visible. `GET /portal/:token`
  returns plain-English labels instead of internal step names.

The invite-only registration decision is captured in
[ADR-009](./docs/adr/009-invite-only-registration.md). The security contract is
simple: JWTs stay in httpOnly cookies, portal tokens are scoped UUID links, and
new staff accounts require an authenticated admin invite.

## Cost

Target: **~$47/month** end-to-end (AWS fleet + Vercel frontend).

| Resource                  | Spec                  | Monthly  |
|---------------------------|-----------------------|----------|
| 5 × t2.micro EC2          | app/worker/db/prom/graf | $42.35 |
| EBS (5 × 20 GiB gp3)      | $0.08/GiB             | $8.00    |
| ALB                       | $0.0225/hr + LCUs     | $4.50    |
| Data transfer             | Intra-AZ free         | ~$1.00   |
| Frontend (Vercel)         | Free tier             | $0.00    |
| **Total (post-optimisations)** |                  | **~$47** |

Key cost decisions:

- **No NAT gateway** — SSM VPC endpoints instead (ADR-001). Saves ~$33/mo.
- **No bastion EC2** — SSM Session Manager gives shell to every private
  host (ADR-001).
- **BullMQ on the worker EC2** — no managed-queue per-request billing
  (ADR-002).
- **Split Prometheus and Grafana onto two t2.micros** — fleet uniformity
  and failure isolation (ADR-003).
- **Self-managed PostgreSQL with explicit tuning** — 1 GiB box, no RDS
  (ADR-004).
- **Vercel free tier for the frontend** — zero ops overhead, per-PR
  preview URLs, global CDN (ADR-006).

Full breakdown with upgrade-path pricing in [`docs/cost.md`](./docs/cost.md).

## Observability

- **Prometheus** scrapes `node_exporter` on all 5 EC2s plus the API's
  `/metrics` endpoint. BullMQ queue counts (waiting, active, completed,
  failed) are polled from Redis every 30 s by the API process and exposed
  as gauges. Scrape interval 15 s, retention 15 days.
- **Grafana** provisions two dashboards as code:
  `monitoring/grafana/dashboards/fleet-overview.json` and
  `onboarding-jobs.json`. Both are committed; there is no click-to-edit
  dashboard in production.
- **Alerts** (`monitoring/prometheus/alerts.yml`): `EC2Down`,
  `JobQueueDepth`, `HighMemoryUsage`, `JobFailureRate`. Each is verified
  firing by deliberately triggering the condition.

The monitoring EC2s are deliberately separate from the app/worker tier —
see **ADR-003** for the reasoning (fleet uniformity + failure isolation
beats the ~$2-3/month delta from consolidating onto one t3.small).

## CI/CD

Three path-scoped GitHub Actions workflows — a CSS change never triggers
Terraform, an infra change never deploys the frontend. See [ADR-008](./docs/adr/008-ci-cd-pipeline.md).

| Workflow | Trigger path | On PR | On merge to main |
|----------|-------------|-------|-----------------|
| `client.yml` | `client/` | lint, typecheck, test, build | + Vercel deploy |
| `server.yml` | `server/` | lint, typecheck, test, Docker build | + push to ECR |
| `infra.yml` | `infra/`, `monitoring/` | fmt + validate + plan (posted as PR comment) | + apply + Ansible + ALB smoke test |

AWS authentication is OIDC — no static access keys in GitHub secrets.

## Repository layout

```
client/         React 19 + Vite + Tailwind — dashboard + portal
server/         Node.js + TypeScript — Express API, BullMQ worker, Docker image
infra/
  terraform/    VPC, security groups, 5 × EC2, ALB, SSM endpoints
  ansible/      six idempotent roles, master playbook, vault-encrypted secrets
monitoring/     Prometheus config + alert rules + Grafana dashboard JSON
scripts/        render-inventory.sh — Terraform outputs → Ansible hosts.yml
docs/
  adr/          001–010 Architecture Decision Records
  architecture.md  tier diagram, SG matrix, data flow
  runbook.md       deploy, teardown, SSM shell, Ansible per-host
  cost.md          full $47/month breakdown
.github/workflows/  client.yml, server.yml, infra.yml
docker-compose.yml  local backend: postgres, redis, api, worker
.env.example        all required env vars documented
```

## License

[MIT](./LICENSE) © 2026 Achille Traore | [achille.tech](https://achille.tech)
