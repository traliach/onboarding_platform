# onboarding_platform

> Production-representative client onboarding platform — React frontend,
> Node.js + TypeScript API and BullMQ worker, PostgreSQL, a 5-EC2 AWS fleet
> configured with Terraform and Ansible, Prometheus + Grafana observability,
> JWT + UUID-token dual auth. Built as a portfolio demonstration of
> distributed-systems thinking on a ~$47/month budget.

![License](https://img.shields.io/github/license/traliach/onboarding_platform)
![Tag](https://img.shields.io/github/v/tag/traliach/onboarding_platform)

<!-- CI badges (client.yml, server.yml, infra.yml) added when the workflows land. -->

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

| Tier              | State                                                   |
|-------------------|---------------------------------------------------------|
| Backend           | **Complete.** API, worker, auth, analytics, tier-based step registry, retry endpoint, Docker image, backend test suite (33 tests). |
| Local stack       | **Complete.** `docker compose up` runs API + worker + Postgres + Redis + migrations + seed. |
| Frontend          | Scaffold only (types, tsconfig). React app pending.     |
| Terraform modules | Scaffold only. Networking, security, compute, ALB, SSM endpoints pending. |
| Ansible roles     | Scaffold only. common, app, worker, db, prometheus, grafana pending. |
| Monitoring config | Pending — `prometheus.yml`, `alerts.yml`, dashboards.   |
| CI/CD             | Pending — three path-scoped workflows.                  |
| Docs              | ADRs 001-006 complete; `cost.md` complete; `architecture.md` and `runbook.md` pending (land with infra). |

The project is built in small, reviewable commits with plain-English
messages (see `git log --oneline`). The exact checklist lives in the
working document used to coordinate AI-assisted commits across sessions.

## Architecture

```
                          ┌──────────────────┐
  Browser ───HTTPS────►   │  ALB (public)    │
  (Vercel frontend)       └──────┬───────────┘
                                 │ TLS
                 ┌───────────────┼────────────────┐
                 │               │                │
                 ▼               ▼                ▼
          ┌──────────┐    ┌──────────┐    ┌──────────┐
          │  app EC2 │    │ grafana  │    │  (ALB    │
          │ (API)    │    │  EC2     │    │  target  │
          └────┬─────┘    └─────┬────┘    │  groups) │
               │                │          └──────────┘
               │                │
               ▼                ▼
          ┌──────────┐    ┌──────────┐    ┌──────────┐
          │ worker   │    │ prom EC2 │    │  db EC2  │
          │ EC2      │    │          │    │ Postgres │
          │ + Redis  │    │ scrapes  │    │          │
          └──────────┘    │ all 5    │    └──────────┘
                          │ tiers    │
                          └──────────┘

     All EC2s are private — no public IPs. Port 22 is closed.
     Shell access via SSM Session Manager only (no bastion, no SSH keys).
     Outbound AWS access via VPC endpoints (no NAT gateway).
```

Full diagram, security-group matrix, and data flow will land in
`docs/architecture.md` alongside the Terraform modules.

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

Log in, create a client, watch the worker output stream step-by-step in
`docker compose logs -f worker`. End-to-end transcript for a fresh
`POST /clients` through to completed `job_steps` is in the build story
document under "Chapter 4 — Tier-based workflow engine".

Tests:

```bash
cd server
npm test
```

33 tests run in under two seconds (passwords, tokens, step handlers,
workflow registry, auth HTTP integration).

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

The "two patterns, one project" reasoning — and why this is a legitimate
production pattern (GuideCX and Rocketlane ship the same split) — is
captured as **Chapter 3** of the build story document. The non-negotiable
security rules that both patterns obey live in CLAUDE.md section 10.

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

- **Prometheus** scrapes `node_exporter` on all 5 EC2s plus the server's
  `/metrics` endpoint (app + worker counters/gauges/histograms). Scrape
  interval 15 s, retention 15 days.
- **Grafana** provisions two dashboards as code:
  `monitoring/grafana/dashboards/fleet-overview.json` and
  `onboarding-jobs.json`. Both are committed; there is no click-to-edit
  dashboard in production.
- **Alerts** (`monitoring/prometheus/alerts.yml`): `InstanceDown`,
  `JobQueueDepth`, `HighMemoryUsage`, `JobFailureRate`. Each is verified
  firing by deliberately triggering the condition — build-story Chapter
  10 will document the verification runs.

The monitoring EC2s are deliberately separate from the app/worker tier —
see **ADR-003** for the reasoning (fleet uniformity + failure isolation
beats the ~$2-3/month delta from consolidating onto one t3.small).

## CI/CD

Three separate GitHub Actions workflows, path-scoped — a CSS fix never
runs Terraform, an infra change never runs Vite. See **ADR-005** for
the monorepo rationale.

- `.github/workflows/client.yml` — lint → test → `vite build` → Vercel
  deploy (on changes under `client/`).
- `.github/workflows/server.yml` — lint → test → Docker build → push ECR
  (on changes under `server/`).
- `.github/workflows/infra.yml` — `terraform plan` on PR →
  `terraform apply` + Ansible + ALB smoke test on merge (on changes
  under `infra/` or `monitoring/`).

None are wired yet — pending the Terraform and Ansible work.

## Repository layout

```
client/       React 19 + Vite + Tailwind frontend (pending)
server/       Node.js + TypeScript API + BullMQ worker (complete)
infra/
  terraform/  VPC, security, compute, ALB, SSM endpoints (pending)
  ansible/    common, app, worker, db, prometheus, grafana roles (pending)
monitoring/   Prometheus scrape + alerts, Grafana dashboards (pending)
docs/
  adr/        Architecture Decision Records (001-006 complete)
  cost.md     Full cost breakdown
  architecture.md  (pending)
  runbook.md       (pending)
CLAUDE.md     Working rules for AI-assisted development (private)
docker-compose.yml
```

Full tree, with per-file purpose comments, is in CLAUDE.md section 3.

## License

[MIT](./LICENSE) © 2026 Achille Traore | [achille.tech](https://achille.tech)
