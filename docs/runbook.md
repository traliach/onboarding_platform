# Runbook

Operational reference for the `onboarding_platform` fleet.

## Prerequisites

- AWS CLI v2 configured with a named profile (`AWS_PROFILE=onboarding`)
- Session Manager Plugin installed (`session-manager-plugin`)
- Terraform >= 1.5
- Ansible >= 2.16, `amazon.aws` + `community.postgresql` collections
- `jq` (used by `scripts/render-inventory.sh`)
- GitHub CLI (`gh`) for CI/CD checks
- Node.js >= 22 + npm/npx for Vercel CLI commands

---

## First deploy (account prerequisites → live fleet)

This sequence runs once per AWS account. After it completes, the CI/CD pipeline
handles subsequent client, server image, and Terraform deploys. For `infra.yml`
to run Ansible, the encrypted `infra/ansible/group_vars/all/vault.yml` must be
committed and `ANSIBLE_VAULT_PASSWORD` must exist in GitHub Actions secrets.

Before applying changes, run the smoke-phase preflight from repo root. This is
the correct mode before DNS and ACM exist; it checks the backend deploy path and
allows the temporary HTTP ALB health-check URL:

```bash
ARTIFACT_STRATEGY=controlled-outbound \
bash scripts/deploy-preflight.sh --phase=smoke
```

`ARTIFACT_STRATEGY` is an operator decision for first-install package access:
`controlled-outbound`, `s3-artifacts`, or `prebaked-ami`.

After the smoke deploy is healthy and you have a real API domain plus ACM
certificate, run the production-phase preflight before deploying the browser
bundle:

```bash
FINAL_API_ORIGIN=https://api.example.com \
TF_VAR_alb_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id \
ARTIFACT_STRATEGY=controlled-outbound \
bash scripts/deploy-preflight.sh --phase=production
```

### First-deploy execution log

Append to this table as each deployment step is completed. Do not record secret
values here; record only the action and verification result.

| Date | Step | Action | Result |
|------|------|--------|--------|
| 2026-04-22 | Vault setup | Created `infra/ansible/group_vars/all/vault.yml` from the example, filled production values, encrypted it with `ansible-vault`, and set the same password in GitHub secret `ANSIBLE_VAULT_PASSWORD`. | `vault.yml` begins with `$ANSIBLE_VAULT;1.1;AES256`, is not gitignored, GitHub secret exists, and commit `8b8454e` added the encrypted vault. |
| 2026-04-22 | Smoke preflight | Ran `ARTIFACT_STRATEGY=controlled-outbound bash scripts/deploy-preflight.sh --phase=smoke` from Git Bash. | Vault checks passed. Blocked on missing Windows Ansible commands, DynamoDB lock table, GitHub OIDC role, ECR repository, and GitHub secrets `AWS_ROLE_TO_ASSUME` / `AWS_REGION`. HTTPS/Vercel checks correctly skipped for smoke phase. |

**Step 1 — Confirm pre-existing AWS resources**

The S3 state bucket (`achille-tf-state`), DynamoDB lock table
(`onboarding-platform-tf-lock`), ECR repository (`onboarding-platform`), and
OIDC role (`onboarding-platform-github-actions`) are account prerequisites
created outside this Terraform root module. They must exist before running
`terraform init`; this repo no longer contains a separate Terraform
account-setup module.

**Step 2 — Set GitHub repo secrets**

```bash
MSYS_NO_PATHCONV=1 gh secret set AWS_ROLE_TO_ASSUME   # paste OIDC role ARN
MSYS_NO_PATHCONV=1 gh secret set AWS_REGION           # e.g. us-east-1
MSYS_NO_PATHCONV=1 gh secret set VERCEL_TOKEN
MSYS_NO_PATHCONV=1 gh secret set VERCEL_ORG_ID
MSYS_NO_PATHCONV=1 gh secret set VERCEL_PROJECT_ID
```

Set `ANSIBLE_VAULT_PASSWORD` after Step 5, once the real vault has been
created and encrypted.

**Step 3 — Apply root Terraform module**

```bash
cd infra/terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Set `TF_VAR_alb_certificate_arn` or `alb_certificate_arn` in an ignored
`terraform.tfvars` when you are ready for the ALB HTTPS listener.

**Step 4 — Build and push the Docker image to ECR**

```bash
# Get ECR registry URL from AWS
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION="${REGION:-us-east-1}"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
DATE=$(date +%Y%m%d)
SHORT_SHA=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=format:"%s" | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-30)
TAG="${DATE}-${SHORT_SHA}-${MSG}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR"
docker build -t "${ECR}/onboarding-platform:${TAG}" -f server/Dockerfile .
docker push "${ECR}/onboarding-platform:${TAG}"
export DEPLOY_IMAGE_TAG="$TAG"
```

**Step 5 — Create and encrypt the Ansible vault**

```bash
cp infra/ansible/group_vars/all/vault.yml.example \
   infra/ansible/group_vars/all/vault.yml
```

Edit `vault.yml` — replace every `CHANGE_ME_BEFORE_ENCRYPTING` value:

| Key | How to generate |
|-----|-----------------|
| `onboarding_platform_db_password` | `openssl rand -base64 24` |
| `onboarding_platform_jwt_secret` | `openssl rand -base64 48` (must be ≥ 32 chars) |
| `onboarding_platform_grafana_admin_password` | Choose a strong password |

Encrypt (the vault password becomes `ANSIBLE_VAULT_PASSWORD` in GitHub):

```bash
ansible-vault encrypt infra/ansible/group_vars/all/vault.yml
MSYS_NO_PATHCONV=1 gh secret set ANSIBLE_VAULT_PASSWORD
git add infra/ansible/group_vars/all/vault.yml
```

Commit the encrypted `vault.yml`; it is safe to commit after Ansible Vault
encryption and is required for CI. Never commit plaintext vault copies.

**Step 6 — Render inventory and run Ansible**

```bash
bash scripts/render-inventory.sh    # reads terraform output, writes hosts.yml
cd infra/ansible
FRONTEND_ORIGIN=https://app.example.com
ansible-playbook playbooks/site.yml \
  --ask-vault-pass \
  -e "onboarding_platform_frontend_origin=${FRONTEND_ORIGIN}"
```

**Step 7 — Verify**

```bash
ALB=$(cd infra/terraform && terraform output -raw alb_dns_name)
curl -sf "http://${ALB}/health"
# Expected: {"status":"ok"}
```

After a successful first deploy, push a commit to `main` and let the CI/CD
pipeline own routine deploys.

---

## Routine deploy (CI/CD)

Push to `main` — the three GitHub Actions workflows handle the rest:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `client.yml` | changes under `client/` | lint → test → build → Vercel deploy |
| `server.yml` | changes under `server/` | lint → test → Docker build → push ECR |
| `infra.yml` | changes under `infra/` or `monitoring/` | fmt/validate → plan (PR) → apply + Ansible + smoke test (main); requires committed encrypted vault.yml |

Monitor progress: `gh run list --limit 5`

---

## SSM shell access

No SSH keys, no bastion. All shell access goes through SSM Session Manager.

```bash
# Instance IDs from Terraform outputs
APP_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.app')
WORKER_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.worker')
DB_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.db')
PROM_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.prometheus')
GRAF_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.grafana')

# Start a shell session
aws ssm start-session --target "$APP_ID"
aws ssm start-session --target "$DB_ID"
# etc.
```

**Port-forward to Prometheus UI (localhost:9090)**

```bash
aws ssm start-session \
  --target "$PROM_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["9090"],"localPortNumber":["9090"]}'
# Then open http://localhost:9090 in your browser
```

**Port-forward to Grafana UI (localhost:3000)**

```bash
aws ssm start-session \
  --target "$GRAF_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
# Then open http://localhost:3000 in your browser
```

---

## Ansible — per-host targeting

Full fleet (all roles in dependency order):

```bash
cd infra/ansible
ansible-playbook playbooks/site.yml --ask-vault-pass
```

Single role against one host group:

```bash
# Re-run only the app role
ansible-playbook playbooks/site.yml --ask-vault-pass --tags app

# Re-deploy only the db role
ansible-playbook playbooks/site.yml --ask-vault-pass --tags db

# Limit to one host
ansible-playbook playbooks/site.yml --ask-vault-pass \
  --limit onboarding-platform-app
```

Available tags: `common`, `db`, `worker`, `app`, `prometheus`, `grafana`

Dry run (check mode, no changes applied):

```bash
ansible-playbook playbooks/site.yml --ask-vault-pass --check --diff
```

---

## Viewing logs

```bash
# API service logs (live)
aws ssm start-session --target "$APP_ID"
# on the EC2:
sudo journalctl -u onboarding-api -f

# Worker service logs (live)
aws ssm start-session --target "$WORKER_ID"
sudo journalctl -u onboarding-worker -f

# PostgreSQL logs
aws ssm start-session --target "$DB_ID"
sudo journalctl -u postgresql -f

# Prometheus logs
aws ssm start-session --target "$PROM_ID"
sudo journalctl -u prometheus -f
```

---

## Restarting services

```bash
# Restart API (e.g. after env var change)
aws ssm start-session --target "$APP_ID"
sudo systemctl restart onboarding-api

# Restart worker
aws ssm start-session --target "$WORKER_ID"
sudo systemctl restart onboarding-worker

# Restart Redis
aws ssm start-session --target "$WORKER_ID"
sudo systemctl restart redis
```

---

## Database access

```bash
# Connect to PostgreSQL via SSM
aws ssm start-session --target "$DB_ID"
# on the EC2:
sudo -u postgres psql -d onboarding
```

Common queries:

```sql
-- Check client + job status
SELECT c.name, c.tier, c.status, j.status AS job_status
FROM clients c JOIN jobs j ON j.client_id = c.id
ORDER BY c.created_at DESC LIMIT 10;

-- Inspect step failures
SELECT step_name, error_message, started_at
FROM job_steps
WHERE status = 'failed'
ORDER BY started_at DESC LIMIT 20;

-- Count jobs by status
SELECT status, count(*) FROM jobs GROUP BY status;
```

---

## Teardown

**Stop incurring costs without destroying state:**

```bash
cd infra/terraform
# Scale EC2s down by stopping them (preserves EBS, IP assignments)
# Note: t2.micros stop billing for compute when stopped; EBS continues.
aws ec2 stop-instances --instance-ids \
  "$APP_ID" "$WORKER_ID" "$DB_ID" "$PROM_ID" "$GRAF_ID"
```

**Full teardown (irreversible — deletes all data):**

```bash
cd infra/terraform
terraform destroy
# Confirm by typing "yes"
```

> The DB EC2 and its EBS volume have `prevent_destroy = true` in Terraform.
> Remove that lifecycle rule before running `terraform destroy`, or the
> destroy will fail with a lifecycle error.

The state bucket, lock table, ECR repository, and OIDC role are shared account
prerequisites. Do not delete them as part of app teardown unless you are
intentionally retiring the AWS account setup.
