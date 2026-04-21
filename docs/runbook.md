# Runbook

Operational reference for the `onboarding_platform` fleet.

## Prerequisites

- AWS CLI v2 configured with a named profile (`AWS_PROFILE=onboarding`)
- Session Manager Plugin installed (`session-manager-plugin`)
- Terraform >= 1.9
- Ansible >= 2.16, `amazon.aws` + `community.postgresql` collections
- `jq` (used by `scripts/render-inventory.sh`)
- GitHub CLI (`gh`) for CI/CD checks

---

## First deploy (bootstrap → live fleet)

This sequence runs once per AWS account. After it completes, the CI/CD
pipeline (`infra.yml`) handles all subsequent deploys.

**Step 1 — Bootstrap remote state and OIDC role**

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
# Outputs: bucket name, lock table name, OIDC role ARN
```

**Step 2 — Set GitHub repo secrets**

```bash
MSYS_NO_PATHCONV=1 gh secret set AWS_ROLE_TO_ASSUME   # paste OIDC role ARN
MSYS_NO_PATHCONV=1 gh secret set AWS_REGION           # e.g. us-east-1
MSYS_NO_PATHCONV=1 gh secret set ANSIBLE_VAULT_PASSWORD
MSYS_NO_PATHCONV=1 gh secret set VERCEL_TOKEN
MSYS_NO_PATHCONV=1 gh secret set VERCEL_ORG_ID
MSYS_NO_PATHCONV=1 gh secret set VERCEL_PROJECT_ID
```

**Step 3 — Apply root Terraform module**

```bash
cd infra/terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

**Step 4 — Build and push the Docker image to ECR**

```bash
# Get ECR registry URL from AWS
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region)
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
SHA=$(git rev-parse HEAD)

aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR"
docker build -t "${ECR}/onboarding-platform:${SHA}" -f server/Dockerfile .
docker push "${ECR}/onboarding-platform:${SHA}"
```

**Step 5 — Create and encrypt the Ansible vault**

```bash
cp infra/ansible/group_vars/all/vault.example.yml \
   infra/ansible/group_vars/all/vault.yml
# Edit vault.yml — fill in all onboarding_platform_* values
ansible-vault encrypt infra/ansible/group_vars/all/vault.yml
```

**Step 6 — Render inventory and run Ansible**

```bash
bash scripts/render-inventory.sh    # reads terraform output, writes hosts.yml
cd infra/ansible
ansible-playbook playbooks/site.yml --ask-vault-pass
```

**Step 7 — Verify**

```bash
ALB=$(cd infra/terraform && terraform output -raw alb_dns_name)
curl -sf "http://${ALB}/health"
# Expected: {"status":"ok"}
```

After a successful first deploy, push a commit to `main` and let the
CI/CD pipeline own all future deploys.

---

## Routine deploy (CI/CD)

Push to `main` — the three GitHub Actions workflows handle the rest:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `client.yml` | changes under `client/` | lint → test → build → Vercel deploy |
| `server.yml` | changes under `server/` | lint → test → Docker build → push ECR |
| `infra.yml` | changes under `infra/` or `monitoring/` | fmt/validate → plan (PR) → apply + Ansible + smoke test (main) |

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

**Bootstrap teardown (run after root module is destroyed):**

```bash
cd infra/terraform/bootstrap
# Empty the S3 state bucket first (versioned — must delete all versions)
BUCKET="onboarding-platform-tfstate"
aws s3api delete-objects --bucket "$BUCKET" \
  --delete "$(aws s3api list-object-versions --bucket "$BUCKET" \
    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')"
terraform destroy
```
