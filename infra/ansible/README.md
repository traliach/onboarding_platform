# Ansible — `infra/ansible/`

Configures the five-EC2 fleet **after** Terraform has created it. Connection is
**SSM Session Manager** only — port 22 is closed on every instance (CLAUDE.md §5).

## Prerequisites (controller laptop or CI runner)

- Ansible ≥ 2.15
- Python 3 + `pip` (for `boto3` if not already installed)
- AWS credentials with `ssm:StartSession` on the fleet (named profile recommended)
- Collections: `ansible-galaxy collection install -r requirements.yml`
- `jq`, `terraform`, and `aws` CLI for `scripts/render-inventory.sh`

## One-time secrets

```bash
cd infra/ansible
cp group_vars/all/vault.yml.example group_vars/all/vault.yml
ansible-vault encrypt group_vars/all/vault.yml
# store the vault password outside the repo
```

Commit the encrypted `group_vars/all/vault.yml`. GitHub Actions needs the
encrypted file from git plus the `ANSIBLE_VAULT_PASSWORD` secret to run the
Ansible deploy. Never commit plaintext vault copies; use a gitignored scratch
name such as `vault.plain.yml` when editing manually.

Use a **URL-safe** database password — it is embedded in `DATABASE_URL` inside
the generated env files.

## Inventory

After every `terraform apply` that changes instance IDs or private IPs:

```bash
bash scripts/render-inventory.sh
```

This writes `inventory/hosts.yml` (gitignored) with `ansible_host` = instance id
for SSM, `private_ip` for Postgres/Redis URLs and Prometheus targets, and
`onboarding_platform_container_image` set to the most recently pushed ECR tag
(DATE-SHORTSHA-MSG format, resolved via `aws ecr describe-images`).

Override the tag by setting `DEPLOY_IMAGE_TAG` before running the script.

## Container image

Ansible does **not** build the image — it pulls from ECR. Push an image built
from repo root (`docker build -f server/Dockerfile .`) before the `app` and
`worker` plays succeed.

## Run

From `infra/ansible`:

```bash
export AWS_PROFILE=your-profile   # or rely on instance profile on a jump box
ansible-playbook playbooks/site.yml --vault-password-file ~/.vault/onboarding
```

## Role map

| Role        | Hosts       | Purpose |
|-------------|-------------|---------|
| `common`    | all         | Python for Ansible, swap, `node_exporter` :9100 |
| `db`        | db          | PostgreSQL 16 + ADR-004 tuning + app DB user |
| `worker`    | worker      | Docker, Redis 6, BullMQ worker container (host network) |
| `app`       | app         | Docker, API container on **:3000** (matches ALB target group) |
| `prometheus`| prometheus  | Prometheus binary, scrapes all `:9100` targets |
| `grafana`   | grafana     | Grafana OSS + Prometheus datasource (dashboard JSON = phase 4) |

## Terraform coordination

- **Redis ingress:** the worker security group allows **6379 from the app SG**
  so the API can enqueue BullMQ jobs. Applied in `infra/terraform/modules/security`.
- **`project_name` output:** used by `render-inventory.sh` for the default ECR
  repository name (`onboarding-platform` by default).

## Troubleshooting

- **`community.postgresql` errors** — ensure `python3-psycopg2` installed on the
  db host (the `db` role installs it).
- **Redis service name** — Amazon Linux 2023 uses `redis6.service` and
  `/etc/redis6/redis6.conf`.
- **PostgreSQL service name** — if `postgresql` fails, try `postgresql-16` and
  patch the role (AMI drift).
