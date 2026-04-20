# ADR-003: Split Prometheus and Grafana onto separate t2.micro EC2s

## Status
Accepted

## Context
The fleet (CLAUDE.md section 3) includes an observability tier composed of
two services: **Prometheus** (TSDB + scrape engine) and **Grafana**
(dashboards + alert UI). Both could plausibly run on one host. The question
is whether to co-locate them on a single instance or split them onto two.

Constraints that force the question:

- The project's fleet is deliberately all **t2.micro (1 GiB RAM, 1 vCPU
  burstable)** — see ADR-004 for the rationale on the DB tier, which applies
  equally here.
- The $47/month total budget leaves no room for upsized monitoring hardware.
- Prometheus is memory-heavy (WAL + in-memory index + recent chunks). Grafana
  is relatively light at rest but spikes under concurrent dashboard loads.
- Every EC2 in this fleet runs `node_exporter`, the SSM agent, and
  systemd-journald, which already claim ~100 MiB before the application
  process starts.

## Decision
**Run Prometheus and Grafana on two separate t2.micro instances**
(`prometheus` and `grafana`), each with its own security group, rather than
co-locating them on a single instance.

Prometheus scrapes all five hosts (app, worker, db, prometheus itself,
grafana) on 9090. Grafana reads from the Prometheus instance over the
private subnet. Neither host is publicly addressable; the Grafana UI is
reached through the ALB (section 3).

## Rationale
- **Memory headroom.** Prometheus alone comfortably fits in 1 GiB with the
  retention and scrape interval used in this project (15 s scrape, 15-day
  retention, five targets). Grafana alone likewise fits. Stacking them on
  one host would leave almost no headroom for the kernel page cache on an
  already-constrained 1 GiB box, risking OOM kills under any dashboard
  refresh storm.
- **Failure isolation.** Grafana crashing (OOM, plugin fault, config reload
  gone wrong) must never take Prometheus down — alert evaluation and metric
  ingest have to keep working so the `JobQueueDepth` /
  `HighMemoryUsage` / `InstanceDown` alerts still fire. Splitting the
  processes onto separate hosts is the simplest guarantee; no amount of
  systemd slice tuning matches an OS boundary.
- **Scrape topology clarity.** When `prometheus.yml` lists `grafana:9100`
  alongside `app:9100`, `worker:9100`, etc., the symmetry makes the scrape
  config readable at a glance. A co-located setup would have one host that
  is both the scraper and a target of its own scrape — a legal
  configuration but an unusual one to explain in a review.
- **Portfolio signal.** A five-tier fleet that deliberately splits
  monitoring is a small but clear senior-level signal: the author reasoned
  about failure domains, not just about the price tag.

## Alternatives considered
- **Co-locate on one t2.micro** — rejected. Saves one $8.47/month instance
  but violates the memory headroom and failure-isolation points above. The
  saved dollars are not worth an alert tier that can be brought down by a
  Grafana dashboard loop.
- **Upsize to one t3.small (2 GiB) hosting both** — rejected. t3.small is
  ~$15/month; combined with the extra EBS volume reduction, the net saving
  versus two t2.micros is ~$2-3/month. Paying the full $8.47 × 2 to get a
  clean failure boundary and identical hardware across the whole fleet is
  the better trade. Also: keeping every instance on the same class
  simplifies Ansible (one `common` role, one set of baseline tuning) and
  cost forecasting (multiply by instance count).
- **Move Grafana to Grafana Cloud (managed)** — rejected. Free tier exists
  but the portfolio point is to operate the stack end-to-end; handing
  Grafana to a managed service undoes half the observability story. Also
  would force either a public Prometheus or a tunnel to reach it.
- **Run both inside one EC2 as containers under a single Docker daemon**
  — rejected. Same host, same OOM risk, and adds Docker-in-production
  complexity to the monitoring tier without solving the isolation problem.
- **Drop Grafana entirely and use Prometheus's built-in UI** — rejected.
  Prometheus's expression browser is a debugging tool, not a dashboard
  surface; interview demos require Grafana.

## Consequences
- Two `t2.micro` instances appear in `infra/terraform/modules/compute/`
  rather than one. The Ansible inventory has distinct `prometheus` and
  `grafana` groups (CLAUDE.md section 3).
- Two security groups: `prometheus-sg` allows inbound 9090 only from
  `grafana-sg`; `grafana-sg` allows inbound 3000 only from the ALB. Neither
  allows inbound from the VPC CIDR at large.
- Scrape targets in `monitoring/prometheus/prometheus.yml` explicitly
  include both `prometheus:9100` and `grafana:9100` (node_exporter on each
  host). Neither host is self-referential in any scrape rule.
- If the fleet is ever consolidated (e.g. moved to a managed container
  platform), the split becomes a no-op — the two processes still run as
  separate pods / services with the same failure boundary.
- The cost table in `docs/cost.md` lists both monitoring instances as
  distinct line items. The "split monitoring" note under "Cost decisions"
  cites ~$7/month saved versus a single t3.small — a saving that only
  exists because t3.small and 2× t2.micro are priced very close and the
  non-cost benefits (failure isolation, fleet uniformity) decide it.
