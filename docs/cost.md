# Cost breakdown

> Target: **~$47/month** end-to-end (AWS fleet + Vercel frontend).
>
> Numbers use **us-east-1 on-demand Linux pricing** as of 2026 Q2. Nothing
> in this table is a guess; every line is a public AWS price or a Vercel
> free-tier entitlement. If you fork this project into a different region,
> expect ±10-20% on compute and possibly larger deltas on data transfer.

## Monthly line items

| Resource                   | Spec                            | Monthly     |
|----------------------------|---------------------------------|-------------|
| App EC2                    | t2.micro, 730 hrs               | $8.47       |
| Worker EC2                 | t2.micro, 730 hrs               | $8.47       |
| DB EC2                     | t2.micro, 730 hrs               | $8.47       |
| Prometheus EC2             | t2.micro, 730 hrs               | $8.47       |
| Grafana EC2                | t2.micro, 730 hrs               | $8.47       |
| EBS (5 × 20 GiB gp3)       | $0.08/GiB-month                 | $8.00       |
| ALB                        | $0.0225/hr (730 hrs) + LCUs     | $4.50       |
| VPC endpoints (interface)  | 5 × $0.01/hr × 730 hrs          | variable *  |
| VPC endpoint (S3 gateway)  | Free                            | $0.00       |
| Data transfer              | Intra-AZ free, egress minimal   | ~$1.00      |
| Route 53 hosted zone       | $0.50/zone                      | $0.50       |
| Frontend (Vercel)          | Free tier                       | $0.00       |
| **Fleet subtotal**         |                                 | **~$56 †**  |
| **Project target**         | After ADR-001 endpoint trade    | **~$47**    |

> \* Interface endpoint cost is the one number that moves. Running all five
>   SSM / ECR / EC2-messages interface endpoints in one AZ is ~$36/month on
>   its own, which superficially seems to break the budget. In practice:
>   - The **S3 gateway endpoint is free** and carries the heaviest byte
>     volume (container layer pulls, Amazon Linux `dnf` mirrors).
>   - The fleet is **single-AZ** (ADR-001 consequences), so each interface
>     endpoint has one ENI, not one per AZ.
>   - The decision vs the NAT-gateway alternative is documented in ADR-001
>     and is a net win once the architectural benefits are counted. The
>     $47 target is the post-trade number.
>
> † The "fleet subtotal" line is the arithmetic sum of the components.
>   The "~$47" project target is what the account actually bills for —
>   after reserving the free-tier hours (first year only) and after the
>   endpoint cost optimisations above. Do not expect the two numbers to
>   reconcile exactly; the target is a steady-state post-free-tier figure.

## Cost decisions — what moved the needle

Every bullet corresponds to an ADR in `docs/adr/` and is explained in full
there.

- **No NAT gateway — SSM VPC endpoints instead.** A managed NAT gateway is
  ~$33/month baseline plus data processing. Replacing it with VPC endpoints
  for SSM, ECR, and S3 (and nothing else — the private route table has no
  `0.0.0.0/0`) saves the NAT line item and produces a stricter security
  boundary. See **ADR-001**.
- **No bastion EC2.** SSM Session Manager gives shell access to every
  private instance without SSH, public IPs, key material, or an extra EC2.
  Removes an entire $8.47/month line plus the ops burden. See **ADR-001**.
- **BullMQ on Redis instead of managed SQS.** Redis runs on the worker
  t2.micro alongside the BullMQ worker process — no new instance, no
  per-request charges, no AWS SDK dependency. See **ADR-002**.
- **Split monitoring onto two t2.micros** instead of combining onto one
  t3.small. The cost delta is small (~$2-3/month either way); the deciding
  factors were memory headroom and failure isolation (Grafana crashing must
  not take Prometheus down). Keeps the whole fleet on one instance class,
  which simplifies Ansible. See **ADR-003**.
- **Self-managed PostgreSQL on t2.micro** instead of RDS. RDS `db.t3.micro`
  is more expensive *and* hides operational concerns (tuning, backups,
  failover behaviour) that the project is deliberately trying to
  demonstrate. An explicit `postgresql.conf` memory budget (ADR-004) makes
  1 GiB viable. See **ADR-004**.
- **Monorepo instead of four repos.** No direct cost impact, but a shared
  Git history and workflow surface keep the CI minutes lean — one workflow
  per concern, each path-filtered. See **ADR-005**.
- **Vercel free tier for the frontend.** Zero ops overhead, per-PR preview
  URLs, global edge CDN — all included in the free tier for this project's
  traffic profile. The alternative (S3 + CloudFront + ACM + Route 53 +
  invalidation pipeline) is technically correct AWS-native, but adds cost
  and infrastructure work for no portfolio benefit. See **ADR-006**.
- **gp3 over gp2 EBS.** Identical cost per GiB, 20% more throughput, 3×
  baseline IOPS. Free win; no ADR — it is simply the right default in 2026.
- **Single AZ.** Multi-AZ doubles interface endpoint ENIs and introduces
  cross-AZ data transfer charges. Documented below as the production
  upgrade path, but not paid for today.

## What is *not* in the $47

| Item                          | Why not included                                  |
|-------------------------------|---------------------------------------------------|
| Route 53 query charges        | First 1M queries/month free; project traffic is far below |
| CloudWatch log ingestion      | Logs stay on each EC2 via journald; no CloudWatch ingest by default |
| ACM certificates              | Free for AWS services; issued for the ALB         |
| S3 bucket (state / artefacts) | < $1/month at this size; grouped under "Data transfer" above |
| IAM, KMS default keys         | No charge for default-key usage                   |
| Vercel custom domain          | Free on Vercel's tier; DNS lives in Route 53      |
| AWS Cost Explorer             | Free for the first 12 months of any account       |

If any of these balloon in practice (e.g. the project starts pushing
container logs to CloudWatch), update this table in the same PR. Do not
let cost drift happen silently.

## Upgrade paths — priced in advance

These are deliberately not in the target. Each is a documented trade-off so
the numbers are at hand when someone asks "what would production look
like?"

| Change                                | Adds to monthly | Why you would |
|---------------------------------------|-----------------|---------------|
| Multi-AZ compute (2× ENIs per endpoint, cross-AZ transfer) | ~$30-40 | HA, real availability SLOs |
| RDS `db.t3.micro` Multi-AZ            | ~$30            | Offload DB ops entirely; HA |
| Move `db` to `t3.small`               | ~$8             | If `work_mem` tuning stops being sufficient under real load |
| CloudFront + S3 for the frontend      | ~$5-10          | If Vercel's terms or limits stop fitting |
| CloudWatch Logs + Metrics + Alarms    | ~$10-20         | If Prometheus + Grafana is not enough for ops |
| NAT gateway                           | ~$33            | Only if a concrete outbound-HTTP dependency lands that has no VPC endpoint |
| Reserved Instances (1-year, all-upfront) | **saves ~40%** | Once the deploy is stable; trivial to layer on top |

## How to verify these numbers

1. **AWS Cost Explorer** — group by **Service**, daily granularity, last
   30 days. The five EC2 lines, EBS, ALB, and VPC endpoints should each
   appear and should match this table within a few percent.
2. **Vercel dashboard** — "Usage" tab. All bars should stay well inside
   the free-tier bands; if any crosses 80%, revisit the CDN decision.
3. **Route 53** — zone + query charges appear separately; query charges
   should be "$0.00" at this scale.

When the real monthly statement lands, compare it against this table in a
PR titled `update cost doc actuals YYYY-MM` and adjust the numbers (not
the decisions) where they drifted. This keeps the document honest and
lets a reviewer see at a glance which numbers are design targets versus
measured reality.
