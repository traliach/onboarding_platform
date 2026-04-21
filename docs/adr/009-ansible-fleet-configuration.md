# ADR-009: Ansible fleet configuration over SSM

## Status
Accepted

## Context
Terraform provisions raw EC2 instances (AL2023, SSM-only, no public IPs on the
fleet). Something still has to install PostgreSQL, Redis, Docker images,
Prometheus, and Grafana, apply the ADR-004 memory tuning, and keep those
settings reproducible.

SSH is intentionally unavailable (port 22 closed — CLAUDE.md §10). The only
supported operator access path is SSM Session Manager, so configuration
management must work over the same transport.

## Decision
**Use Ansible with the `amazon.aws.aws_ssm` connection plugin.** Inventory is
generated from Terraform outputs (`instance_ids`, `instance_private_ips`) via
`infra/ansible/scripts/render-inventory.sh`, which writes `ansible_host` as the
EC2 instance id (required for SSM) and carries `private_ip` for DB URLs, Redis
URLs, and Prometheus static scrape targets.

Secrets live in **Ansible Vault** under `group_vars/all/vault.yml` (gitignored
plaintext; encrypted file is the intended CI shape once a password file exists
in GitHub Actions secrets).

## Rationale
- **SSM-native** — matches the security model (no SSH keys, no bastion).
- **Idempotent roles** — `common` → `db` / `worker` → `app` → `prometheus` →
  `grafana` ordering encodes real dependencies (API waits for Postgres + Redis).
- **Docker pull, not git pull on prod** — the app/worker artifact is the same
  ECR image CI builds; Ansible only lays down systemd units + env files.
- **Explicit Redis network path** — the worker runs Redis bound on the private
  subnet; the app reaches it on TCP 6379 after a dedicated security-group rule
  (Terraform), replacing the old “Redis is localhost” comment that was only
  true for the worker process.

## Alternatives considered
| Option | Why rejected |
|--------|----------------|
| User-data only | Unmaintainable at five roles; no Vault story; hard to re-run safely. |
| SSH + Ansible | Violates the closed-port-22 decision. |
| ECS/EKS | Out of scope — this project demonstrates bare EC2 fleet discipline. |
| Manual shell runbooks | Not reproducible; fails the portfolio signal. |

## Consequences
- Operators must run `ansible-galaxy collection install -r requirements.yml`
  once per controller.
- A first-time deploy requires **Terraform apply → ECR push → render-inventory
  → ansible-playbook** in that order.
- Grafana ships with datasource provisioning only; dashboard JSON lives in
  `monitoring/` (phase 4) and will be wired when that directory exists.

## References
- `infra/ansible/README.md` — runbook for inventory + Vault + playbook.
- ADR-004 — PostgreSQL tuning values applied in the `db` role.
- ADR-003 — split Prometheus/Grafana hosts (two roles, two plays).
