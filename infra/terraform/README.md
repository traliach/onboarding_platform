# Terraform — `infra/terraform/`

The full AWS footprint for `onboarding_platform`. Two Terraform
configurations live here and are applied in a strict order:

1. **`bootstrap/`** — one-time-per-account setup (S3 state bucket,
   DynamoDB lock table, GitHub OIDC role). Uses **local** state.
2. **Root module (this directory)** — the actual fleet (VPC, SGs,
   EC2s, ALB, SSM endpoints). Uses the **S3 backend** created by
   bootstrap.

## Prerequisites

- Terraform ≥ 1.5
- AWS credentials resolvable via a named profile — set `AWS_PROFILE`
  in your shell. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in a
  `.env` file is forbidden (CLAUDE.md §10).
- A default region (`us-east-1`) — matched in `variables.tf` and the
  `backend "s3"` block in `versions.tf`.

## First-time setup (new AWS account)

```bash
# 1 — create the state bucket + lock table (local state, applied once)
cd infra/terraform/bootstrap
terraform init
terraform plan
terraform apply
cd ..

# 2 — init the root module against the S3 backend you just created
terraform init
terraform plan
# (review output — expect 5 EC2s, 1 VPC, 2 subnets, 5 SGs, ALB, 6 VPCEs)
terraform apply
```

The root module's `terraform init` will fail until step 1 completes —
this is by design. See the NOTE at the top of `versions.tf`.

## Day-to-day

Only the root module is touched. `bootstrap/` is static; it does not
get re-applied unless you're rotating state storage or adding a new
CI role (unlikely).

```bash
cd infra/terraform
terraform fmt -check -recursive   # CI-equivalent
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

## Outputs consumed by Ansible

`outputs.tf` exposes:

- `project_name` — same as `var.project_name` (`onboarding-platform` by
  default); used by `ansible/scripts/render-inventory.sh` when composing the
  default ECR image URI.
- `alb_dns_name` — public entrypoint; used by the `infra.yml`
  workflow's smoke test and (later) by a Route53 alias record.
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

`bootstrap/` itself should almost never be destroyed — tearing down
the state bucket orphans the root module's history and makes the next
`terraform plan` think the entire infrastructure is new. Both the
bucket and the lock table are also protected by `prevent_destroy`.

## Cost shape

Applying the root module from scratch takes ~4 minutes and is
effectively free: the t2.micro fleet is within the always-free tier
for the first 12 months, EBS gp3 is pennies, the ALB is ~$4.50/mo,
and data transfer is negligible. Full breakdown in `docs/cost.md`
(total ~$47/mo).
