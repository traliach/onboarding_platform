# ADR-004: t2.micro with explicit PostgreSQL tuning

## Status
Accepted

## Context
The fleet is five t2.micro EC2 instances.
One of them — the `db` host — runs self-managed PostgreSQL and serves both
the API and the worker.

t2.micro has **1 GiB of RAM and 1 vCPU (burstable)**. PostgreSQL's defaults
were set in an era of much larger hosts: `max_connections = 100`,
`shared_buffers` scales with available memory on modern packages, etc. Left
untuned, Postgres on t2.micro exhausts memory under even modest load and
starts swapping against the 1 GiB ceiling, at which point latency collapses
and the OOM killer gets involved.

Managed databases (RDS, Aurora) are explicitly out of scope. Upgrading the instance
class to t3.small (2 GiB) would double the DB cost line in the $47/month
budget.

## Decision
**Keep the `db` host on t2.micro and apply an explicit PostgreSQL memory
budget via the Ansible `db` role.**

The role writes (or renders) `postgresql.conf` with the following values:

```
shared_buffers         = 128MB
work_mem               = 4MB
effective_cache_size   = 256MB
max_connections        = 20
```


## Rationale
- **`shared_buffers = 128MB`** — ~12.5 % of RAM. Postgres documentation
  recommends 25 % of RAM on dedicated hosts, but on a 1 GiB host that leaves
  too little headroom for the kernel page cache, node_exporter, and SSM
  agent. 128 MB keeps resident-set size predictable.
- **`work_mem = 4MB`** — bounded per-sort memory. With `max_connections = 20`,
  the worst-case working memory is `20 × 4MB = 80MB`, safely below the
  remaining RAM after `shared_buffers`.
- **`effective_cache_size = 256MB`** — the planner's estimate of OS page
  cache available for reads. Tuned conservatively for the 1 GiB envelope.
- **`max_connections = 20`** — hard cap the connection pool. The API uses a
  `pg` pool with `max = 10` and the worker uses another small pool; 20
  total leaves room for migrations and `psql` diagnostics without being
  wide open.

## Alternatives considered
- **Accept defaults** — rejected. Leads to swap thrash and OOM kills under
  load, observable on the `HighMemoryUsage` Prometheus alert defined in
  `monitoring/prometheus/alerts.yml`.
- **Upgrade `db` to t3.small** — rejected. Doubles the DB line to ~$16/month
  and defeats the "cost-conscious design" signal in project rules section 1.
  Keep this as a documented upgrade path when real production traffic arrives.
- **RDS db.t3.micro** — (managed DB is out of scope) and costs more than self-managed.
- **PgBouncer in front of Postgres** — deferred. Useful later when real
  clients outnumber connections, but adds an operational component not
  needed for a lab-scale onboarding queue that sees bursty, low-volume
  writes.

## Consequences
- The Ansible `db` role (Phase 3) owns the tuned `postgresql.conf`. A drift
  in that file is a failure: the role must be idempotent and authoritative.
- The API and worker `pg` pool sizes must stay below the 20-connection
  ceiling with headroom. Current configuration: API `max = 10`, worker pool
  is single-connection BullMQ semantics, total ≤ 12.
- The `HighMemoryUsage` Prometheus alert (fires when free memory < 100MB)
  and the `JobQueueDepth` alert together give early warning that the tuning
  has been violated — either by a change to `postgresql.conf` or by a leak
  in the API.
- If the load profile changes materially (for example, the provisioning
  worker stops being mocked and begins real AWS calls that return large
  payloads), re-evaluate `work_mem` and `shared_buffers` before scaling
  the instance up.
