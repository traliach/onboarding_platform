# onboarding_platform

> Production-representative client onboarding platform — multi-tier AWS, Terraform modules, Ansible fleet config, BullMQ, PostgreSQL, Prometheus/Grafana

![License](https://img.shields.io/github/license/traliach/onboarding_platform)
![Tag](https://img.shields.io/github/v/tag/traliach/onboarding_platform)

<!-- CI badges (app.yml, infra.yml) added when the workflows land. -->

## Overview

`onboarding_platform` accepts new client submissions via a REST API, enqueues
a provisioning job (BullMQ + Redis), and tracks each provisioning step
(IAM user, S3 folder, welcome email, Slack notification) in PostgreSQL with
full audit logging. Metrics and dashboards cover the entire 5-EC2 fleet.

Provisioning steps are mocked — the portfolio goal is the distributed
architecture, not live AWS side effects.

## Status

Scaffold phase. See the checklist in the project working doc for the current
deliverables state. Items below will be populated as each phase ships.

## Architecture

<!-- Tier diagram lands with docs/architecture.md. -->

## Quick start

<!-- `docker compose up` instructions land with docker-compose.yml in Phase 1. -->

## Cost

<!-- Cost table lands with docs/cost.md in Phase 6. -->

## Observability

<!-- Prometheus + Grafana summary lands with monitoring/ in Phase 4. -->

## CI/CD

Two separate workflows:

- `.github/workflows/app.yml` — lint, test, Docker build, push to ECR (on changes to `app/`).
- `.github/workflows/infra.yml` — `terraform plan` on PR, `apply` + Ansible + ALB smoke test on merge (on changes to `infra/` or `monitoring/`).

Neither is wired yet — tracked under Phase 5.

## License

[MIT](./LICENSE) © 2026 Achille Traore | [achille.tech](https://achille.tech)
