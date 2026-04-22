# Terraform — `infra/terraform/`

The full AWS footprint for `onboarding_platform`. This directory is the single
Terraform root module in the repo: VPC, security groups, EC2s, ALB, and SSM
endpoints. It uses a pre-existing S3 backend and DynamoDB lock table.

## Prerequisites

- Terraform ≥ 1.5
- AWS credentials resolvable via a named profile — set `AWS_PROFILE`
  in your shell. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in a
  `.env` file is forbidden (CLAUDE.md §10).
- A default region (`us-east-1`) — matched in `variables.tf` and the
  `backend "s3"` block in `versions.tf`.

## First-time setup (new AWS account)

Before `terraform init`, create or confirm the account prerequisites described
in `docs/runbook.md`: S3 state bucket, DynamoDB lock table, ECR repository, and
GitHub OIDC role. They are intentionally outside this root module so app
teardown cannot destroy the state backend or CI identity.

```bash
terraform init
terraform plan
# review output — expect 5 EC2s, 1 VPC, 2 public subnets, 1 private subnet,
# 5 SGs, ALB, and SSM/ECR/S3 endpoints
terraform apply
```

`terraform init` will fail if the backend bucket or lock table is missing. That
is intentional; fix the account prerequisites rather than switching to local
state.

## Day-to-day

Only this root module is touched during normal work. Backend storage, the ECR
repository, and the GitHub OIDC role are account-level prerequisites, not app
infrastructure.

```bash
cd infra/terraform
export TF_VAR_alb_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id  # browser-ready HTTPS API
terraform fmt -check -recursive   # CI-equivalent
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

`alb_certificate_arn` is optional for backend smoke-test deployments. Set it
when attaching a production API domain; the ALB module will add a 443 listener
using that ACM certificate.

## Outputs consumed by Ansible

`outputs.tf` exposes:

- `project_name` — same as `var.project_name` (`onboarding-platform` by
  default); used by `ansible/scripts/render-inventory.sh` when composing the
  default ECR image URI.
- `alb_dns_name` — public entrypoint; used by the `infra.yml`
  workflow's smoke test and (later) by a Route53 alias record.
- `alb_https_listener_arn` — null unless `alb_certificate_arn` is set.
- `instance_ids` — role → EC2 id map; used by Ansible for SSM-based
  dynamic inventory.
- `instance_private_ips` — role → private IPv4 map; also used by the
  inventory builder.
- `vpc_id` / `region` — echoed for downstream tooling.

The Ansible inventory is generated from these outputs, never
hand-edited (CLAUDE.md §5 "Ansible"). After `terraform apply`, push the
server image to ECR, run `../ansible/scripts/render-inventory.sh`, then
`ansible-playbook ../ansible/playbooks/site.yml` — see `../ansible/README.md`.

## Destroy

```bash
cd infra/terraform
terraform destroy   # tears down the fleet
```

The DB EC2 and its EBS volume are protected by `prevent_destroy = true`
(CLAUDE.md §5). To actually destroy them, remove the lifecycle block
temporarily — do not amend the root module in a PR that claims to be
a refactor.

Do not delete the state bucket, lock table, ECR repository, or OIDC role during
application teardown. They are shared account prerequisites and deleting them
will break future plans/deploys.

## Cost shape

Applying the root module from scratch takes ~4 minutes and is
effectively free: the t2.micro fleet is within the always-free tier
for the first 12 months, EBS gp3 is pennies, the ALB is ~$4.50/mo,
and data transfer is negligible. Full breakdown in `docs/cost.md`
(total ~$47/mo).
