# ADR-005: Single monorepo for client, server, infrastructure, and monitoring

## Status
Accepted

## Context
The project has four distinct deployable concerns:

1. `client/` — React + Vite frontend, deployed to Vercel (see ADR-006).
2. `server/` — Node.js + TypeScript API and BullMQ worker, built into one
   container image and deployed to two ECS/ECR-backed EC2s (app + worker).
3. `infra/` — Terraform modules (VPC, security, compute, ALB, SSM endpoints)
   plus Ansible roles for per-host configuration.
4. `monitoring/` — Prometheus scrape config, alert rules, Grafana dashboards
   provisioned as code.

Each concern has its own toolchain, its own deploy target, and its own
release cadence. The question is whether to put them in one repository with
one Git history or four.

## Decision
**Keep all four concerns in a single monorepo** (this repository).
Directory layout is the one in CLAUDE.md section 3; each concern is a
top-level folder with its own `package.json` / `terraform` / YAML root.

CI/CD is split by path prefix, not by repository (CLAUDE.md section 16):

- `.github/workflows/client.yml` — triggers on `client/**` changes.
- `.github/workflows/server.yml` — triggers on `server/**` changes.
- `.github/workflows/infra.yml` — triggers on `infra/**` or `monitoring/**`
  changes.

A frontend CSS fix does not run Terraform. A security group change does not
run Vite. Path filters enforce blast-radius isolation without needing
separate repositories.

## Rationale
- **Atomic cross-concern changes.** Adding a field to `Client` touches
  `client/src/types/index.ts`, the API router in `server/src/api/`, and the
  migration in `server/src/db/migrations/`. In a monorepo that is one PR,
  one review, one merge — and the CI boundary is "any path that matters
  ran". Split repositories would force either a stale types package or a
  three-PR dance across repos to land a single feature.
- **Shared types without a package release.** `server/tsconfig.json`
  includes `../client/src/types/` directly so the server compiles against
  the exact types the frontend imports. There is no npm publish, no version
  bump, no private registry. If the types change, both sides see it on the
  next `tsc`.
- **Single source of truth for the story.** CLAUDE.md, the build story
  document, the ADRs, and the code it all references live in one Git log.
  A reader reviewing the project can `git log --oneline` once and see every
  decision, every fix, every wrong turn in order. Split repos fragment the
  narrative.
- **Portfolio clarity.** One URL, one README, one `git clone`. A reviewer
  does not have to hunt for the companion `onboarding_platform-infra` or
  `onboarding_platform-client` repositories to form a complete picture.
- **Branching + review discipline is still possible.** Required reviewers,
  path-scoped CODEOWNERS, and the workflow triggers above give essentially
  the same PR isolation that multi-repo setups claim — without paying the
  cross-repo coordination tax.

## Alternatives considered
- **Multi-repo, one per concern** — rejected. The project's weekly cross-
  concern change rate is high (a new endpoint, a new metric, a matching
  dashboard panel, a matching ADR all in one sitting). Multi-repo would
  turn every such change into a chain of PRs that is hard to review
  atomically and easy to land out of order.
- **Monorepo with a package manager workspace (npm/pnpm/yarn workspaces,
  Turborepo, Nx)** — rejected at this scope. Workspaces are valuable when
  there are many packages (>5) with real inter-package build dependencies.
  Here there are two Node packages (`client/`, `server/`) and the rest are
  not JavaScript. The overhead of a workspace tool (root `package.json`,
  lockfile contention, build graph config) buys nothing for this shape.
  Revisit if `server/` ever splits into multiple packages.
- **Monorepo with a build-system layer (Bazel, Buck, Pants)** — rejected
  outright. Overkill for four concerns; high onboarding cost; the CI
  savings they promise do not materialise at this scale.
- **Git submodules** — rejected. Submodules deliver the worst of both
  worlds: a single URL but a multi-repo checkout experience, plus the
  well-known submodule footguns (detached HEADs, forgotten updates,
  submodule SHAs drifting from branch tips).

## Consequences
- Every PR template and issue template lives in `.github/` at the root and
  applies to all four concerns. A server-only PR sees the same checklist
  as an infra PR — annoying in the small, but a forcing function to keep
  the checklist short and generic.
- CODEOWNERS (if/when added) must be path-scoped, not user-scoped, or a
  frontend-only reviewer will be tagged on every infra PR.
- The `.dockerignore` at the repository root is shared between server and
  any future client container build. It must exclude everything no build
  needs — `infra/`, `monitoring/`, `docs/`, `.git/`, other concerns'
  `node_modules` — so the Docker build context stays small. Existing
  `.dockerignore` already does this.
- `git log` becomes the one history for everything. Plain-English commit
  messages (CLAUDE.md section 12) are the disambiguation: `add adr003
  split monitoring` is obviously infra-ish, `add jwt auth middleware` is
  obviously server, `add clientlist progress bars` is obviously client. No
  monorepo prefix convention (`[server] ...`, `[infra] ...`) is imposed
  because the paths in the diff already tell that story.
- If the project is ever extracted into a product with multiple teams, the
  split should happen along the CI workflow boundaries that already exist:
  one team per top-level folder, each folder extractable into its own
  repository without touching any other.
