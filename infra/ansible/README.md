# Ansible — `infra/ansible/`

Configures the 5-EC2 fleet after Terraform has provisioned it.

## Layout

```
infra/ansible/
├── ansible.cfg                # project-local defaults
├── requirements.yml           # Galaxy collections
├── requirements.txt           # Python deps (ansible-core, boto3)
├── inventory/
│   └── aws_ec2.yml            # dynamic inventory — tag:Project filter
├── group_vars/all/
│   ├── main.yml               # non-secret shared vars
│   ├── vault.yml              # encrypted secrets (gitignored — see below)
│   └── vault.yml.example      # structure reference, committed
├── playbooks/
│   └── site.yml               # master playbook — runs every role in order
└── roles/
    ├── common/                # baseline on every EC2
    ├── db/                    # PostgreSQL + tuning
    ├── worker/                # Redis + BullMQ worker container
    ├── app/                   # API container behind the ALB
    ├── prometheus/            # Prometheus server
    └── grafana/               # Grafana + provisioned dashboards
```

## Prerequisites

- Terraform applied (bootstrap **and** root module), otherwise the
  dynamic inventory returns zero hosts.
- AWS CLI v2 on PATH (the `aws_ssm` connection plugin shells out to
  `aws ssm start-session`).
- `AWS_PROFILE` and `AWS_REGION` set in the shell. No static keys in
  env files (CLAUDE.md §10).
- An S3 bucket named `onboarding-platform-ansible-ssm` exists in the
  same region. It is created by the root Terraform module — not by
  Ansible, and not by bootstrap. Without it every `copy`/`template`
  task fails at upload time.
- Python 3.10+ and a virtualenv for ansible-core.

## First-time setup

```bash
cd infra/ansible

# 1. Python + Ansible
python -m venv .venv
source .venv/bin/activate          # Git Bash on Windows: source .venv/Scripts/activate
pip install -r requirements.txt

# 2. Galaxy collections (amazon.aws, community.aws, community.postgresql, ...)
ansible-galaxy collection install -r requirements.yml

# 3. Create your local vault
cp group_vars/all/vault.yml.example group_vars/all/vault.yml
# Edit group_vars/all/vault.yml — replace every CHANGE_ME value.
ansible-vault encrypt group_vars/all/vault.yml
# Save the vault password to .vault-pass (gitignored) OR set
# ANSIBLE_VAULT_PASSWORD_FILE in the shell.
```

## Running a full converge

```bash
ansible-playbook playbooks/site.yml
```

Site.yml is the only supported entrypoint. Idempotence keeps
full-fleet runs cheap (~2 minutes once everything is installed);
selective runs via tags are explicitly not supported — the role
ordering in site.yml encodes dependencies that tag-based runs break.

## Running against one host

For debugging only. Scope with `--limit`, not with tags:

```bash
ansible-playbook playbooks/site.yml --limit role_db
```

## Verifying the inventory sees your fleet

```bash
ansible-inventory --list | jq '.role_app, .role_db, .role_worker, .role_prometheus, .role_grafana'
```

Each group should contain exactly one host named
`onboarding-platform-<role>`. If any group is empty, either
Terraform hasn't run or the `Role` tag in the compute module
drifted from what `aws_ec2.yml` expects.

## CI behaviour

`.github/workflows/infra.yml` runs `ansible-playbook playbooks/site.yml`
as the final step of the apply job, after Terraform has reached a
stable state. CI writes the vault password from the
`ANSIBLE_VAULT_PASSWORD` repo secret to a temp file and exports
`ANSIBLE_VAULT_PASSWORD_FILE` before invoking ansible-playbook.

## What this does NOT manage

- **Bootstrap resources** (S3 state bucket, DynamoDB lock, OIDC role)
  — owned by Terraform bootstrap, applied once per AWS account.
- **The fleet itself** (EC2, ALB, VPC, SGs, VPC endpoints) — owned
  by Terraform root module. Ansible configures, Terraform provisions.
- **Application code** — the app and worker roles pull a container
  image from ECR built by `.github/workflows/server.yml`. Code
  changes do not require an Ansible run; a new image tag does.
