# ADR-001: SSM VPC Endpoints over NAT Gateway

## Status
Accepted

## Context
The 5-EC2 fleet lives in a single private subnet with **no public IP on any
instance**. Private EC2s still need:

1. Outbound connectivity to AWS Systems Manager so Session Manager works and
   the SSM agent can register.
2. The ability to pull Docker images from ECR (the API and worker image).
3. Access to Amazon Linux 2023 package repositories for `dnf` updates.

The platform runs on a $47/month budget (CLAUDE.md section 8). A managed NAT
gateway is ~$33/month on its own (`$0.045/hour` + data processing), which
alone is ~70% of the total budget.

## Decision
**Route all outbound AWS traffic through VPC endpoints. Do not provision a
NAT gateway. Do not provision a bastion EC2.**

Endpoints created by `infra/terraform/modules/ssm/`:

| Service | Type | Purpose |
|---|---|---|
| `com.amazonaws.<region>.ssm` | Interface | Session Manager control plane |
| `com.amazonaws.<region>.ssmmessages` | Interface | Session Manager shell tunnel |
| `com.amazonaws.<region>.ec2messages` | Interface | SSM agent registration |
| `com.amazonaws.<region>.ecr.api` | Interface | ECR auth for image pulls |
| `com.amazonaws.<region>.ecr.dkr` | Interface | ECR image pull |
| `com.amazonaws.<region>.s3` | Gateway | ECR layer blobs + `dnf` mirrors |

Shell access to every private EC2 is via **SSM Session Manager** (not SSH).
Port 22 is closed in every security group (CLAUDE.md section 9).

## Rationale
- **Cost.** VPC interface endpoints cost ~$0.01/hour per endpoint per AZ
  (≈ $7.20/month each). Five interface endpoints in one AZ is ~$36/month;
  however the S3 gateway endpoint is free and carries the heaviest byte
  volume (container layers + package mirrors). The net savings vs NAT are
  smaller than the headline $33 once endpoints are counted, but the
  architectural benefits below outweigh the narrow cost delta.
- **Security posture.** With no NAT and no IGW route on the private route
  table, private EC2s have **no path to the public internet at all**. This
  is a stronger security boundary than a NAT-gated egress. Only whitelisted
  AWS services are reachable.
- **No bastion.** SSM Session Manager makes SSH/bastion redundant. This
  removes a persistent t2.micro, an SSH keypair, a public IP, and an extra
  security group from the attack surface.
- **Portfolio signal.** Running a private fleet with zero NAT and zero
  bastion demonstrates senior-level AWS networking fluency and cost
  discipline. Explicitly called out in CLAUDE.md section 17 as a
  non-negotiable portfolio decision.

## Alternatives considered
- **NAT gateway** — rejected. ~$33/month baseline + data processing fees,
  and it would give private EC2s unrestricted internet egress, which is
  weaker security than the endpoint-only model.
- **NAT instance (self-managed)** — rejected. Cheaper than NAT gateway but
  reintroduces a failure-prone custom box to operate. Also still permits
  unrestricted egress.
- **Bastion EC2 + SSH keys** — rejected. Extra instance, extra key material
  to manage, port 22 exposed somewhere, auditability weaker than SSM.
- **Public IPs on all EC2s** — rejected outright. Violates CLAUDE.md
  section 9 ("No EC2 has a public IP").

## Consequences
- Every AWS service that the fleet needs must have a VPC endpoint declared in
  `infra/terraform/modules/ssm/`. If we later add CloudWatch Logs, SES, or
  Secrets Manager, the corresponding `com.amazonaws.<region>.*` interface
  endpoint must be added to `local.interface_endpoints`.
- Private route table has **no** `0.0.0.0/0` route. Any attempt to `curl`
  an arbitrary URL from a private EC2 will fail, by design.
- Ansible reaches the private EC2s through SSM (`ansible-playbook -c
  community.aws.aws_ssm ...`) — see `docs/runbook.md` (Phase 6) for the
  target syntax.
- If we ever move to multi-AZ compute, each interface endpoint needs an
  additional ENI in the second AZ — that cost must be added to the upgrade
  path section of `docs/architecture.md`.
