# ADR-002: BullMQ over SQS

## Status
Accepted

## Context
The onboarding platform needs a reliable job queue for provisioning workflows
(IAM user, S3 scaffold, welcome email, Slack notification). The workflow must
be resumable, inspectable per step, and observable via Prometheus.

The platform is self-hosted across a 5 EC2 fleet on a $47/month budget. 
Managed AWS services that add cost or complexity are
out of scope.

## Decision
Use **BullMQ backed by Redis** as the job queue. Redis runs on the worker EC2
alongside the BullMQ worker process.

## Rationale
- **Cost** — zero marginal AWS cost. Redis fits comfortably on the existing
  worker t2.micro; no new instance is needed.
- **Observability** — BullMQ exposes queue depth, active/completed/failed
  counts, and per-job timing in memory. These map directly onto the Prometheus
  `onboarding_queue_depth`, `onboarding_jobs_completed_total`, and
  `onboarding_jobs_failed_total` metrics exposed by the server (metrics
  endpoint lives alongside the other routers in `server/src/api/`).
- **Developer loop** — BullMQ + Redis run locally under Docker Compose in
  seconds, with no AWS account or LocalStack mocking needed.
- **Fit with Node-first stack** — the API and worker both run on Node +
  TypeScript, share the same `server/` package, and are produced by a single
  Dockerfile (`server/Dockerfile`) whose runtime is selected by
  `APP_TARGET=api|worker`.
- **Step-level state** — per-step status (`pending`, `in_progress`, `done`,
  `failed`) is persisted to PostgreSQL (`job_steps` table, migrations under
  `server/src/db/migrations/`). The queue only needs to coordinate attempts;
  durable workflow state is in Postgres regardless of the queue layer.

## Alternatives considered
- **AWS SQS** — rejected. Adds per-request cost, requires a DLQ plus a
  separate mechanism for step-level status, and pulls in an AWS SDK
  dependency into a path that does not otherwise need live AWS. 
- **AWS Step Functions** — rejected. Same cost/coupling as SQS, and the
  visual state machine is wasted effort when the workflow is four sequential
  mocked calls.
- **node-resque / kue / bee-queue** — rejected. BullMQ is the current
  best-maintained Redis-backed queue for Node with first-class TypeScript
  types (unused here but a future-proofing signal) and the richest
  instrumentation API.
- **RabbitMQ** — rejected. Adds a second stateful service to operate across
  the fleet and offers nothing over Redis for this workload.
- **In-process EventEmitter queue** — rejected. Jobs would be lost on worker
  restart; no inspectability; no path to horizontal scale.

## Consequences
- Redis must be deployed, tuned, and backed up on the worker EC2 (handled by
  the Ansible `worker` role in Phase 3).
- The worker EC2's security group must permit 6379 **only** from itself
  (localhost) — no cross-instance Redis traffic. Enforced in Terraform
  `infra/terraform/modules/security/`.
- BullMQ metrics are scraped by the Prometheus EC2 off the app's `/metrics`
  endpoint; the worker does not expose its own HTTP port.
- If we later need multi-region or fan-out, the queue layer can be swapped by
  replacing `server/src/queue/index.ts` and `server/src/worker/processor.ts`
  only — the API route handlers interact with the queue exclusively through
  the injected `JobQueue` dependency.
