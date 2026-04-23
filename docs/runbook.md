# Runbook

Operational reference for the `onboarding_platform` fleet. During an incident,
start with the alert or symptom, identify the affected tier, then use the
targeted playbook below.

Deployment procedures live in [deploy.md](deploy.md). Keep first-deploy,
preflight, GitHub secret setup, Terraform apply, image push, and production
cutover steps there so this runbook stays focused on on-call response.

## Prerequisites

- AWS CLI v2 configured with a named profile (`AWS_PROFILE=onboarding`)
- Session Manager Plugin installed (`session-manager-plugin`)
- Terraform >= 1.5
- Ansible >= 2.16, `amazon.aws` + `community.postgresql` collections
- `jq` for Terraform output parsing
- GitHub CLI (`gh`) authenticated to this repository

All command blocks assume repo root unless they explicitly `cd` elsewhere.
Use Git Bash on Windows for the Bash snippets.

## Incident Loop

1. Identify the signal: alert name, failed workflow, user-facing symptom, or
   smoke test failure.
2. Scope the blast radius: frontend only, ALB/API, worker/queue, database,
   observability, or CI/CD.
3. Gather current IDs and endpoints:

```bash
export REGION="${AWS_REGION:-${REGION:-us-east-1}}"
export PROJECT_NAME="${PROJECT_NAME:-onboarding-platform}"

APP_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.app')
WORKER_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.worker')
DB_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.db')
PROM_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.prometheus')
GRAF_ID=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.grafana')
ALB=$(cd infra/terraform && terraform output -raw alb_dns_name)
```

4. Check the top-level health signal:

```bash
curl -i "http://${ALB}/health"
curl -i "http://${ALB}/health/ready"
gh run list --limit 5
```

5. Apply the smallest safe fix. Prefer service restart, rerunning the relevant
   Ansible tag, or rerunning a failed workflow before changing infrastructure.
6. After resolution, record the alert, root cause, action taken, and follow-up
   in the issue/PR/run notes. Do not record secret values.

## Alerts

| Alert or symptom | Likely tier | First checks | Usual resolution |
|---|---|---|---|
| `EC2Down` | EC2/node_exporter | Instance state, SSM online status, `node_exporter` service | Start/reboot instance, rerun `common` Ansible tag, investigate AWS status checks |
| `HighMemoryUsage` | Any EC2 | `free -h`, `top`, `docker stats`, service logs | Restart leaking service, drain queue pressure, resize only after repeated events |
| `JobQueueDepth` | Worker/Redis | Worker service, Redis service, worker logs, queue gauges | Restart worker, fix Redis, rerun worker role, retry jobs after root cause is fixed |
| `JobFailureRate` | Worker/app logic | Failed `job_steps`, worker logs, recent deploys | Fix config/code/data issue, redeploy if needed, retry failed steps from dashboard |
| ALB `/health` fails | API/ALB/app EC2 | Target health, API service logs, container status | Restart API, rerun app role, verify image exists in ECR |
| `/health/ready` fails | API/database | API logs, PostgreSQL service, DB connectivity | Fix DB service/connectivity, rerun DB or app role depending on failure |
| `infra.yml` smoke test fails | Deploy/API | Workflow failed step, ALB health, API logs | Use the ALB/API playbook, then rerun the failed workflow |
| Grafana or Prometheus unavailable | Observability | SSM port-forward, service status, config files | Restart service, validate config, rerun `prometheus` or `grafana` Ansible tag |

## Triage Playbooks

### ALB Or API Unhealthy

Symptoms: ALB smoke test fails, `/health` is not `200`, dashboard cannot reach
the API, or ALB target is unhealthy.

```bash
curl -i "http://${ALB}/health"

TG_ARN=$(aws elbv2 describe-target-groups \
  --names "${PROJECT_NAME}-api-tg" \
  --region "$REGION" \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text)

aws elbv2 describe-target-health \
  --target-group-arn "$TG_ARN" \
  --region "$REGION"
```

On the app host:

```bash
aws ssm start-session --target "$APP_ID"

sudo systemctl status onboarding-api --no-pager
sudo journalctl -u onboarding-api -n 100 --no-pager
sudo docker ps -a --filter name=onboarding-api
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/health/ready
```

Resolution:

- If `onboarding-api` is stopped or crash-looping, restart it and tail logs:

```bash
sudo systemctl restart onboarding-api
sudo journalctl -u onboarding-api -f
```

- If `/health` works locally but ALB is unhealthy, inspect target health and
  security groups before changing app code.
- If `/health/ready` fails, switch to the database playbook.
- If the container image cannot be pulled, verify `server.yml` pushed to ECR
  and rerun the infra workflow or the app Ansible tag after the image exists.

### Worker Queue Or Job Failures

Symptoms: `JobQueueDepth`, `JobFailureRate`, jobs stuck in `pending`, or
operator retry does not move a job forward.

```bash
aws ssm start-session --target "$WORKER_ID"

sudo systemctl status onboarding-worker --no-pager
sudo systemctl status redis6 --no-pager
sudo journalctl -u onboarding-worker -n 150 --no-pager
sudo journalctl -u redis6 -n 80 --no-pager
sudo docker ps -a --filter name=onboarding-worker
```

Inspect recent failures in the database:

```bash
aws ssm start-session --target "$DB_ID"
sudo -u postgres psql -d onboarding
```

```sql
SELECT c.name, c.tier, j.status AS job_status, js.step_name, js.status,
       js.error_message, js.started_at
FROM job_steps js
JOIN jobs j ON j.id = js.job_id
JOIN clients c ON c.id = j.client_id
WHERE js.status = 'failed'
ORDER BY js.started_at DESC
LIMIT 20;
```

Resolution:

- Restart the worker if it is down or stuck:

```bash
sudo systemctl restart onboarding-worker
sudo journalctl -u onboarding-worker -f
```

- Restart Redis only when Redis is unhealthy:

```bash
sudo systemctl restart redis6
sudo systemctl restart onboarding-worker
```

- After fixing the underlying cause, use the dashboard retry action for failed
  steps. Do not bulk-edit job state in SQL unless you are intentionally doing a
  data repair and have written down the exact rows affected.

### EC2Down Or SSM Unreachable

Symptoms: `EC2Down`, Prometheus target down, or SSM cannot connect.

```bash
aws ec2 describe-instances \
  --instance-ids "$APP_ID" "$WORKER_ID" "$DB_ID" "$PROM_ID" "$GRAF_ID" \
  --region "$REGION" \
  --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,Role:Tags[?Key==`Role`]|[0].Value,Status:StateTransitionReason}'

aws ssm describe-instance-information \
  --region "$REGION" \
  --query 'InstanceInformationList[].{Id:InstanceId,Ping:PingStatus,Agent:AgentVersion,Platform:PlatformName}'
```

Resolution:

- If an instance is `stopped`, start it:

```bash
aws ec2 start-instances --instance-ids "$APP_ID" --region "$REGION"
```

- If AWS status checks are failing, reboot once. If the DB host is involved,
  avoid replacement unless you have a data recovery plan.
- If only `node_exporter` is down and SSM works, rerun the common role:

```bash
cd infra/ansible
ansible-playbook playbooks/site.yml --ask-vault-pass --tags common --limit onboarding-platform-app
```

### High Memory

Symptoms: `HighMemoryUsage`, slow API responses, worker lag, or OOM-like
service restarts.

```bash
aws ssm start-session --target "$APP_ID"

free -h
uptime
ps aux --sort=-%mem | head -15
sudo docker stats --no-stream
sudo journalctl -p warning -n 100 --no-pager
```

Resolution:

- Restart only the affected service (`onboarding-api`, `onboarding-worker`,
  `prometheus`, or `grafana-server`) when memory is not recovering.
- For worker pressure, confirm queue depth and job failures before restarting.
- If the same tier repeatedly breaches memory on normal load, document the
  evidence and plan a right-size change. The current t2.micro footprint is a
  budget decision, not a hard scalability target.

### Database Or Readiness Failure

Symptoms: `/health/ready` fails, API logs show Postgres connection errors, or
queries are slow/failing.

```bash
aws ssm start-session --target "$DB_ID"

sudo systemctl status postgresql --no-pager
sudo journalctl -u postgresql -n 150 --no-pager
sudo -u postgres psql -d onboarding -c "SELECT now();"
```

Useful checks:

```sql
SELECT status, count(*) FROM jobs GROUP BY status;

SELECT c.name, c.tier, c.status, j.status AS job_status
FROM clients c
JOIN jobs j ON j.client_id = c.id
ORDER BY c.created_at DESC
LIMIT 10;

SELECT pid, state, wait_event_type, query
FROM pg_stat_activity
WHERE datname = 'onboarding'
ORDER BY state, pid
LIMIT 20;
```

Resolution:

- If PostgreSQL is stopped, inspect logs first, then restart:

```bash
sudo systemctl restart postgresql
sudo journalctl -u postgresql -f
```

- If credentials or network targets changed, rerun the app role so
  `/etc/onboarding-platform/api.env` is regenerated from inventory and vault.
- Do not run `terraform destroy` against the DB host during an incident. The DB
  instance has `prevent_destroy = true` for a reason.

### Prometheus Or Grafana Unavailable

Prometheus and Grafana are private. Use SSM port-forwarding first to distinguish
service failure from network exposure assumptions.

```bash
aws ssm start-session \
  --target "$PROM_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["9090"],"localPortNumber":["9090"]}'
```

Open `http://localhost:9090`.

```bash
aws ssm start-session \
  --target "$GRAF_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
```

Open `http://localhost:3000`.

On the affected host:

```bash
sudo systemctl status prometheus --no-pager
sudo journalctl -u prometheus -n 100 --no-pager
sudo /opt/prometheus/promtool check config /etc/prometheus/prometheus.yml

sudo systemctl status grafana-server --no-pager
sudo journalctl -u grafana-server -n 100 --no-pager
```

Resolution:

- Rerun `prometheus` after alert or scrape config changes.
- Rerun `grafana` after datasource or dashboard provisioning changes.
- Restart only the affected service if configuration validates.

### CI/CD Failure

Start with the failed workflow log:

```bash
gh run list --limit 10
RUN_ID=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
gh run view "$RUN_ID" --log-failed
```

Common failure mapping:

| Failed step | Meaning | Fix |
|---|---|---|
| Configure AWS credentials | OIDC role, trust policy, or `AWS_ROLE_TO_ASSUME`/`AWS_REGION` secret problem | Verify account prerequisites and GitHub secrets |
| Terraform init | S3 state bucket or DynamoDB lock table missing/inaccessible | Create or fix account prerequisites |
| Terraform plan/apply lock timeout | Another apply is active or stale lock exists | Wait first; only clear a lock after proving no apply is running |
| Check Ansible vault is encrypted | `vault.yml` missing or plaintext | Commit encrypted `infra/ansible/group_vars/all/vault.yml` |
| Run Ansible | Host config, vault value, ECR image, or package install problem | Read failed task, rerun targeted Ansible tag after fix |
| Smoke test ALB health endpoint | App is not reachable through ALB | Use ALB/API playbook |
| Vercel deploy | Vercel token/org/project/env problem | Verify Vercel secrets and `VITE_API_BASE_URL` |

## Operational Commands

### SSM Shell Access

No SSH keys, no bastion. All shell access goes through SSM Session Manager.

```bash
aws ssm start-session --target "$APP_ID"
aws ssm start-session --target "$WORKER_ID"
aws ssm start-session --target "$DB_ID"
aws ssm start-session --target "$PROM_ID"
aws ssm start-session --target "$GRAF_ID"
```

### Logs

```bash
# API
aws ssm start-session --target "$APP_ID"
sudo journalctl -u onboarding-api -f

# Worker
aws ssm start-session --target "$WORKER_ID"
sudo journalctl -u onboarding-worker -f

# Redis
aws ssm start-session --target "$WORKER_ID"
sudo journalctl -u redis6 -f

# PostgreSQL
aws ssm start-session --target "$DB_ID"
sudo journalctl -u postgresql -f

# Prometheus
aws ssm start-session --target "$PROM_ID"
sudo journalctl -u prometheus -f

# Grafana
aws ssm start-session --target "$GRAF_ID"
sudo journalctl -u grafana-server -f
```

### Restarts

```bash
sudo systemctl restart onboarding-api
sudo systemctl restart onboarding-worker
sudo systemctl restart redis6
sudo systemctl restart postgresql
sudo systemctl restart prometheus
sudo systemctl restart grafana-server
```

Restart dependencies before dependents when both are affected:
PostgreSQL/Redis first, then API/worker.

### Database Access

```bash
aws ssm start-session --target "$DB_ID"
sudo -u postgres psql -d onboarding
```

Common queries:

```sql
SELECT c.name, c.tier, c.status, j.status AS job_status
FROM clients c
JOIN jobs j ON j.client_id = c.id
ORDER BY c.created_at DESC
LIMIT 10;

SELECT step_name, status, error_message, started_at
FROM job_steps
ORDER BY started_at DESC
LIMIT 20;

SELECT status, count(*) FROM jobs GROUP BY status;
```

### Ansible Targeting

Full fleet:

```bash
cd infra/ansible
ansible-playbook playbooks/site.yml --ask-vault-pass
```

Single role:

```bash
ansible-playbook playbooks/site.yml --ask-vault-pass --tags app
ansible-playbook playbooks/site.yml --ask-vault-pass --tags worker
ansible-playbook playbooks/site.yml --ask-vault-pass --tags db
ansible-playbook playbooks/site.yml --ask-vault-pass --tags prometheus
ansible-playbook playbooks/site.yml --ask-vault-pass --tags grafana
```

Limit to one host:

```bash
ansible-playbook playbooks/site.yml --ask-vault-pass \
  --limit onboarding-platform-app
```

Dry run:

```bash
ansible-playbook playbooks/site.yml --ask-vault-pass --check --diff
```

Available tags: `common`, `db`, `worker`, `app`, `prometheus`, `grafana`.

## Teardown

Stop incurring EC2 compute costs without destroying state:

```bash
aws ec2 stop-instances \
  --instance-ids "$APP_ID" "$WORKER_ID" "$DB_ID" "$PROM_ID" "$GRAF_ID" \
  --region "$REGION"
```

Full teardown is irreversible and deletes application infrastructure:

```bash
cd infra/terraform
terraform destroy
```

The DB EC2 and its EBS volume have `prevent_destroy = true` in Terraform.
Remove that lifecycle rule only when you intentionally want to destroy the DB.

The state bucket, lock table, ECR repository, and GitHub OIDC role are shared
account prerequisites. Do not delete them as part of app teardown unless you
are retiring the AWS account setup.
