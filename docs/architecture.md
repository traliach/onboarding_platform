# Architecture

## System overview

```
                        ┌──────────────────────────────┐
  Browser / Vercel ─────►  ALB  (public, port 80/443)  │
                        └──────────────┬───────────────┘
                                       │ :3000
                         private subnet │ (no public IPs)
                        ┌──────────────▼───────────────┐
                        │  app EC2  (API, port 3000)    │
                        │  onboarding-platform-app      │
                        └──┬───────────────────────┬───┘
                           │ :5432                 │ :6379
               ┌───────────▼──────┐    ┌───────────▼──────┐
               │  db EC2          │    │  worker EC2       │
               │  PostgreSQL 16   │    │  BullMQ processor │
               │  :5432           │◄───│  Redis :6379      │
               └──────────────────┘    └──────────────────┘
                           ▲                     ▲
                     :9100 │               :9100 │
               ┌───────────┴─────────────────────┴──────┐
               │  prometheus EC2  (scrapes all 5 × :9100)│
               │  :9090                                  │
               └───────────────────────────────────────┬─┘
                                                       │ :9090
                                           ┌───────────▼──────┐
                                           │  grafana EC2      │
                                           │  :3000            │
                                           └──────────────────┘

  Shell access: SSM Session Manager only — port 22 closed on all hosts.
  Outbound AWS API: VPC interface endpoints — no NAT gateway, no bastion.
```

## EC2 fleet

| Name | Role | Listens on | Security group |
|------|------|-----------|----------------|
| `onboarding-platform-app` | Node.js/Express API | 3000 | `onboarding-platform-app-sg` |
| `onboarding-platform-worker` | BullMQ processor + Redis | 6379 (Redis) | `onboarding-platform-worker-sg` |
| `onboarding-platform-db` | PostgreSQL 16 | 5432 | `onboarding-platform-db-sg` |
| `onboarding-platform-prometheus` | Prometheus | 9090 | `onboarding-platform-monitoring-sg` |
| `onboarding-platform-grafana` | Grafana | 3000 | `onboarding-platform-monitoring-sg` |

All instances: `t2.micro`, `gp3` EBS 20 GiB, private subnet only, no public IP,
SSM IAM role attached, `node_exporter` running on port 9100.

## Security group matrix

Each row is a source; each column is a destination. Numbers are allowed TCP ports.

| Source | app-sg | worker-sg | db-sg | monitoring-sg | alb-sg |
|--------|--------|-----------|-------|---------------|--------|
| Internet (0.0.0.0/0) | — | — | — | — | 80, 443 |
| alb-sg | 3000 | — | — | — | — |
| app-sg | — | 6379 | 5432 | — | — |
| worker-sg | — | — | 5432 | — | — |
| monitoring-sg | 9100 | 9100 | 9100 | — | — |
| VPC CIDR (10.0.0.0/16) | — | — | — | all | — |

Rules not shown: all SGs allow unrestricted outbound (required for SSM,
ECR, and dnf package installs via VPC endpoints / internet egress). The
VPC CIDR → monitoring-sg rule covers SSM port-forward sessions to the
Prometheus and Grafana UIs.

## Networking

```
VPC: 10.0.0.0/16
  Public subnets  (10.0.1.0/24, …)  — ALB only
  Private subnets (10.0.11.0/24, …) — all 5 EC2s
```

**No NAT gateway.** Private EC2s reach AWS APIs through VPC interface
endpoints (SSM, ECR, EC2 Messages) and a gateway endpoint for S3.
See [ADR-001](adr/001-ssm-over-nat.md).

**No bastion.** Shell access to every EC2 goes through SSM Session Manager.
See the [runbook](runbook.md) for the exact commands.

**Single AZ.** All subnets and EC2s land in one AZ to eliminate cross-AZ
data transfer charges. Multi-AZ is documented as the production upgrade
path below.

## Data flow

### Write path — `POST /clients`

```
Browser
  │  POST /clients  (JWT cookie)
  ▼
ALB :80
  │  forward to app target group :3000
  ▼
app EC2 — Express handler
  │  INSERT INTO clients  (portal_token = gen_random_uuid())
  │  INSERT INTO jobs + job_steps  (status = pending)
  │  BullMQ.add(jobId)
  ▼
worker EC2 — BullMQ processor
  │  For each step in STEP_REGISTRY[tier]:
  │    UPDATE job_steps SET status = in_progress
  │    execute step (mocked; logs the side-effect)
  │    UPDATE job_steps SET status = done | failed
  │  UPDATE jobs SET status = done | failed
  ▼
db EC2 — PostgreSQL
  Persistent store for clients, jobs, job_steps, audit_log
```

### Read path — portal token

```
Client browser
  │  GET /portal/<uuid>  (no auth)
  ▼
ALB → app EC2
  │  SELECT * FROM clients WHERE portal_token = $1
  │  SELECT * FROM job_steps WHERE job_id = $2
  │  Map step_name → plain_label
  │  Return { client, steps[], humanTasks[] }
  ▼
Client browser — PortalPage.tsx
  Progress bar + plain-English step labels only.
  No internal IDs, no logs, no other clients' data.
```

### Observability path

```
All 5 × EC2s — node_exporter :9100
app EC2       — Express /metrics :3000  (prom-client gauges/counters)
  │
  │  scrape every 15s
  ▼
prometheus EC2 :9090
  │  evaluate alerts.yml every 15s
  │
  ▼  (SSM port-forward for access)
grafana EC2 :3000
  Dashboards provisioned from monitoring/grafana/dashboards/
```

## Production upgrade paths

These are documented trade-offs, not planned work:

| Current | Upgrade | Trigger |
|---------|---------|---------|
| Single AZ | Multi-AZ with RDS read replica | SLA requirement |
| HTTP smoke path on ALB port 80 | ACM-backed HTTPS listener via `alb_certificate_arn` | Custom API domain |
| SSM-only access | Jump host or Tailscale | Compliance audit requirement |
| Self-managed PostgreSQL | RDS | Eliminating DBA operational burden |
| BullMQ on EC2 | SQS + Lambda | Burst workloads > 50 concurrent jobs |
| t2.micro | t3.small per tier | >100 concurrent clients |
| Single Grafana instance | Grafana Cloud or HA pair | Dashboard SLA requirement |
