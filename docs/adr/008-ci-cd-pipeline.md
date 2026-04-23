# ADR-008: CI/CD pipeline shape

## Status
Accepted

## Context
The monorepo now has three independent deployables — the React
dashboard (`client/`), the Express API + worker (`server/`), and the
AWS infrastructure (`infra/terraform/`). Each has a different release
cadence, a different failure mode, and different secrets. A single
"CI" workflow that ran everything on every PR would:

- Punish the fast codebase for the slow one (Terraform plans take
  ~90s in a cold cache; the frontend build is ~15s).
- Force a single credential boundary — either every job gets AWS
  access it doesn't need, or no job does and infra CI is pointless.
- Make the red/green signal on a PR noisy: "client failed, server
  passed, infra skipped" is much less useful than three independent
  checks.

Two more requirements shape this:

1. **No static AWS credentials**, per project rules §10 and ADR-007. The
   infra workflow authenticates via OIDC; the client and server
   workflows don't need AWS at all (for now).
2. **Feature-branch previews**: the Vercel integration (ADR-006)
   already builds a preview for every PR touching `client/`. CI
   doesn't need to replicate that.

## Decision
**Three independent GitHub Actions workflows, one per deployable,
gated by path filters. No umbrella workflow.**

| Workflow | Path filter | Jobs | AWS? |
|---|---|---|---|
| `client.yml` | `client/**` | install → lint → typecheck → test → build | no |
| `server.yml` | `server/**` | `ci` (lint/typecheck/test/build) + `docker` (image build, no push) | no |
| `infra.yml` | `infra/terraform/**` | `check` (fmt+validate) → `plan` (OIDC, PR comment) → `apply` (OIDC, main only) | yes (OIDC) |

Shared patterns across all three:

- **Concurrency per-ref**: rapid-fire pushes to the same branch
  cancel in-flight PR runs (`cancel-in-progress: true`), but `main`
  pushes queue (`cancel-in-progress: false` on infra.yml — a
  cancelled mid-apply is worse than a waiting one).
- **Least-privilege `permissions`** block at the top of every
  workflow: `contents: read` by default, plus `id-token: write` and
  `pull-requests: write` only on `infra.yml`.
- **Path-filtered triggers**: a docs-only PR touches none of the
  three. A PR that edits both client and server runs both, in
  parallel, with independent check columns.
- **Cache the package manager, not the build output**: `npm ci`
  with `cache: npm` on node setup, `type=gha` buildx cache for
  Docker, no custom cache steps.

Infrastructure-specific patterns (new in this ADR):

- **PR plan comment**: `infra.yml` runs `terraform plan
  -detailed-exitcode -out=tfplan` on every PR touching Terraform,
  then posts the rendered plan as a PR comment via
  `actions/github-script`. Reviewers see the diff in the PR thread
  without checking out the branch. The exit code (0 = no changes,
  2 = changes, 1 = error) drives the comment's status line.
- **Plan-file hand-off to apply**: on pushes to main, the plan job
  uploads `tfplan` as an artifact; the apply job downloads it and
  runs `terraform apply tfplan`. This guarantees the applied plan
  is byte-identical to the reviewed one. Running a fresh plan inside
  the apply job would allow drift between PR review and apply time.
- **Branch gate on apply**: `if: github.event_name == 'push' &&
  github.ref == 'refs/heads/main'`. The comment in infra.yml calls
  out that a `production` GitHub environment can be added in a
  single line when human approval is wanted — the rest of the
  workflow is unchanged.

Account prerequisites are deliberately **not** created by CI. The state bucket,
lock table, ECR repository, and OIDC role must exist before the workflows run;
`infra.yml` only plans and applies the root application infrastructure.

## Consequences

**Good**
- Each workflow is under 200 lines and readable end-to-end. The
  reviewer can audit the full CI behavior for one deployable
  without scrolling past the other two.
- Failures are scoped: a red `infra` check on a client-only PR is
  impossible, so a red check always means something on the
  relevant codebase broke.
- The infra role's blast radius is capped by OIDC and the role policy attached
  to `onboarding-platform-github-actions`. The client and server workflows
  have no AWS identity at all, so an exploited build step in
  `client.yml` cannot touch S3/EC2/IAM.
- Adding a fourth deployable (say, a `docs/` static site or a
  `monitoring/` dashboards-as-code publisher) is a new workflow
  file, not a branch in an existing one.

**Bad**
- Three `actions/setup-node` blocks exist across client.yml and
  server.yml with the same Node 22 pin. A reusable workflow could
  dedupe this. Deferred — the duplication is small, the DRY
  indirection makes each workflow less self-contained, and we'd
  still need separate workflows for the path filters.
- The plan → apply artifact hand-off costs one artifact upload
  (~50 KB) per push to main. Negligible in the free tier; worth
  noting in case plan output ever balloons with a data-heavy
  module.
- PR plan comments can grow noisy on long-lived PRs — every push
  that touches Terraform adds a new comment. An alternative ("edit
  the existing comment in place") is a known pattern but adds code
  and a hidden failure mode (missing permissions). Deferred until
  it actually becomes annoying.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Single umbrella workflow, conditional jobs | Path filters still work but the top-level permissions block has to be the union of all jobs' needs — least-privilege is lost. The "one red check column" problem (above) also regresses. |
| Reusable workflow called from three thin callers | Solves node-setup duplication at the cost of indirection. The callers become ~20 lines each, the reusable workflow becomes ~150, and auditing "what runs on an infra PR" now requires reading two files instead of one. |
| `tfsec` / `checkov` in infra.yml today | Security scanning is a net-positive addition, but the first run surfaces a backlog of low-severity findings that would block the deployment path. Scheduled as a separate PR so backlog triage does not stall the happy path. |
| Running `terraform apply` on PR merge-to-main via a `pull_request.closed` event | Feels clever, actually loses: merge commits on `main` already trigger `push`, and `pull_request.closed` also fires on cancelled/unmerged PRs — we'd need to filter on `github.event.pull_request.merged`, at which point the `push` trigger is simpler and more obvious. |
| Applying from a protected long-lived `staging` branch before `main` | Worth doing when there's a staging environment. For a single-environment $47/month lab, a staging branch is ceremony. Revisit when a second AWS account or a non-prod Vercel project lands. |

## References
- project rules §8 (CI/CD rules) — OIDC secrets, `id-token: write`.
- project rules §10 (Security rules) — no static keys, no Admin roles.
- ADR-006 — Vercel frontend; explains why `client.yml` does not
  deploy.
- ADR-007 — Remote state + OIDC; explains where
  `AWS_ROLE_TO_ASSUME` comes from.
- `.github/workflows/client.yml`, `server.yml`, `infra.yml`.
