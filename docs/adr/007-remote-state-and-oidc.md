# ADR-007: Remote Terraform state and OIDC for CI

## Status
Accepted

## Context
Phase 1 of this project used Terraform's default **local** state — a
`terraform.tfstate` file next to the module. That was fine for a
single operator on a single laptop, but it does not survive the
transition to CI:

- GitHub Actions runners are ephemeral. Every workflow run would
  start from an empty state and either re-plan the entire world or,
  worse, try to create already-existing resources.
- Two concurrent `terraform apply` runs (a push to `main` and a
  manual trigger, say) would race and corrupt the state file.
- The state file contains provider credentials, RDS passwords, and
  private IPs in plaintext — it cannot be committed.
- The GitHub Actions workflow needs AWS credentials to run `plan` on
  PRs. The default pattern is `AWS_ACCESS_KEY_ID` +
  `AWS_SECRET_ACCESS_KEY` secrets, which means a long-lived IAM user
  with static keys living in the repo settings. Static keys are the
  #1 cause of AWS account compromises in public GitHub data.

The budget is still $47/month (CLAUDE.md §8). Any remote-state
solution that needs a managed service beyond S3/DynamoDB (Terraform
Cloud, Spacelift, etc.) is off the table.

## Decision
**Store Terraform state in S3 with a DynamoDB lock table, and
authenticate GitHub Actions to AWS via OIDC — never static keys.**

Implementation uses account prerequisites created outside this Terraform root
module. They are intentionally not managed by the app module, because deleting
the app fleet must never delete its own state backend or CI identity. The
required resources are:

1. S3 state bucket — `achille-tf-state`, shared across projects with
   project-scoped keys, versioning, encryption, and public access blocked.
2. DynamoDB lock table — `onboarding-platform-tf-lock`, `PAY_PER_REQUEST`
   billing, used by Terraform's S3 backend for state locking.
3. GitHub OIDC provider + role — `onboarding-platform-github-actions`, scoped
   to this repository and used by GitHub Actions through
   `AWS_ROLE_TO_ASSUME`.

The root module's `versions.tf` declares the backend:

```hcl
backend "s3" {
  bucket         = "achille-tf-state"
  key            = "onboarding-platform/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "onboarding-platform-tf-lock"
  encrypt        = true
}
```

Apply order on a fresh account is strict: create the account prerequisites
first, then run the root module. Running `terraform init` first fails because
the backend bucket or lock table is missing, rather than silently falling back
to local state.

## Consequences

**Good**
- State is shared, locked, and encrypted at rest. Two concurrent
  applies now wait for each other instead of racing.
- No long-lived AWS credentials exist anywhere in the repo or in
  GitHub secrets. The worst case of a leaked repo secret
  (`AWS_ROLE_TO_ASSUME`) is that an attacker knows the ARN of a
  role they cannot assume without a valid GitHub OIDC token for this
  exact repo.
- `apply` is gated to `main` in `infra.yml`. Feature branches can
  still `plan` (the role allows it), so PR plan comments work, but
  a feature branch cannot mutate infra.
- Zero added monthly cost: S3 state bucket is ~$0.02/month, the
  DynamoDB table is $0 at idle on `PAY_PER_REQUEST`, and OIDC is
  free.

**Bad**
- The account prerequisites are not recreated by this repo. New operators have
  to know that the state bucket, lock table, ECR repository, and OIDC role must
  already exist before `terraform init` succeeds.
- `PowerUserAccess` is broader than strictly needed. A handcrafted
  least-privilege policy would be tighter but also 200+ actions of
  churn on every new resource type the root module adds. The
  inline `iam_project_scope` policy is the compromise: the only
  actions broad enough to be dangerous (`iam:*`) are scoped to
  resources whose names start with `onboarding-platform-*`.
- The role trust policy allows any branch to run workflows that
  assume it. Apply-gating lives in the workflow, not the role. If
  `infra.yml` is ever mis-edited to drop the `if: github.ref ==
  'refs/heads/main'` guard, a PR could apply. An alternative —
  two separate roles, one for plan and one for apply — adds a moving
  part without eliminating the workflow-as-gate risk. Keeping it in
  one place (`infra.yml`) makes the gate reviewable in one diff.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Local state, committed to repo | Contains secrets; breaks multi-operator and CI. Non-starter. |
| Local state, `.gitignore`d | No sharing; CI has no state; no locking. Worse than current. |
| Terraform Cloud remote state | Free tier exists, but introduces a third-party dependency and a second credential boundary. The $47 budget has no room for the paid tier, and the free tier is not guaranteed to stay free. |
| S3 backend, static IAM user with access keys | Solves state but not the credential problem. Long-lived keys in GitHub secrets is exactly the pattern this ADR exists to avoid. |
| S3 backend, OIDC, Admin-role trust | Violates CLAUDE.md §10 ("never create IAM roles with AdministratorAccess"). |
| Two OIDC roles (plan-only + apply-only) | Doubles the IAM surface area for a marginal guard; apply-gating in the workflow is equivalent and reviewable. |

## References
- CLAUDE.md §5 (Infrastructure rules) — remote state, credential
  handling, naming convention.
- CLAUDE.md §8 (CI/CD rules) — OIDC secrets and `id-token: write`.
- CLAUDE.md §10 (Security rules) — OIDC-only, no Admin, no static
  keys.
- `infra/terraform/versions.tf` — the S3 backend configuration.
- `infra/terraform/README.md` — root module setup and prerequisites.
