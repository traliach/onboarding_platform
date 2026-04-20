# ADR-006: Deploy the React frontend to Vercel instead of the AWS fleet

## Status
Accepted

## Context
The project has two tiers that could host the `client/` React + Vite build:

1. **The AWS fleet itself** — put the static bundle behind the ALB, either
   served by a lightweight nginx container on the `app` EC2 or through an
   S3 + CloudFront stack in front of the existing VPC.
2. **Vercel** — Git-connected, zero-config deploy for Vite apps, automatic
   preview builds per PR, global edge CDN.

The project is browser-only at the frontend (no SSR requirement today) and
the API is already on its own host exposed via ALB over HTTPS. CORS is
already a first-class concern (CLAUDE.md section 10: explicit origin list,
no wildcards). Adding a separate frontend origin is not additional
complexity — it is already priced in.

## Decision
**Deploy the `client/` build to Vercel on the free tier.** The AWS fleet
hosts only the API, the worker, the database, and the monitoring stack.
The production frontend URL (e.g. `onboarding.dominion.tech`) points at
Vercel; Vercel makes cross-origin credentialled calls to the API host.

CORS is configured on the server to allow exactly the Vercel domain(s) —
no wildcard — via the `CORS_ALLOWED_ORIGINS` environment variable that
`server/src/config/index.ts` validates on startup.

## Rationale
- **Cost.** Vercel's free tier covers this project's traffic comfortably
  (static build, low QPS, no serverless functions used). The alternative
  — adding nginx to the `app` EC2 or standing up S3 + CloudFront +
  ACM + Route 53 + an OAI + a bucket policy — adds complexity and
  potential cost with no user-visible benefit.
- **Global CDN for free.** Vercel fronts the build with its edge network
  out of the box. CloudFront can match this, but only after writing the
  Terraform, the cache behaviours, the invalidation policy, and the
  deployment pipeline to push build artefacts to S3 and invalidate
  CloudFront — every one of which is a topic the project explicitly does
  **not** want to spend tokens on. AWS CDN infrastructure is not the
  portfolio story; the backend fleet is.
- **Preview deployments per PR.** Every pull request that touches
  `client/**` gets a unique preview URL via Vercel's Git integration.
  That is a real UX win for design review, and it is one line of
  configuration (no preview URL infrastructure to build).
- **Separation of concerns, not a shortcut.** Putting the frontend on a
  different platform than the API is a deliberate architectural signal,
  not a cost dodge. Production frontends increasingly live on edge
  platforms (Vercel, Cloudflare, Netlify) while the API stays on cloud IaaS.
  The project models that split honestly.
- **Deploy is a `git push`.** The `client.yml` workflow
  (CLAUDE.md section 3) just builds and lets Vercel's Git integration
  deploy. The workflow itself has almost nothing to do — lint, test,
  `vite build`, done. The AWS fleet deploy is where the interesting
  infra work lives; the frontend should not compete for that attention.

## Alternatives considered
- **Serve static assets from the `app` EC2 behind the ALB** — rejected.
  Bundles nginx (or Express `express.static`) into the API container,
  mixes two concerns into one artefact, and ties frontend releases to
  backend releases. Also means the API EC2 is now serving mixed
  traffic, which complicates ALB listener rules and cache headers.
- **S3 + CloudFront + ACM + Route 53** — rejected as the *initial* target.
  Technically the right AWS-native answer for a production frontend, and
  it would be the upgrade path if Vercel's free tier were outgrown. But
  the infrastructure cost to build it (Terraform module, cert validation,
  origin access, cache behaviours, CI deploy step, invalidation hooks) is
  real, and none of it advances the portfolio story that the backend
  fleet is already telling. Documented as the upgrade path in
  `docs/cost.md` for when real production traffic justifies it.
- **Netlify or Cloudflare Pages** — on paper equivalent to Vercel for this
  use case. Vercel chosen because the project already follows Vercel's
  conventions (Vite, Git-connected deploy) and no other criterion
  differentiates them. Not a technical rejection; a coin-flip resolved
  by "pick one and move on."
- **Dockerised nginx as a sixth EC2** — rejected outright. Adds a sixth
  t2.micro (~$8.47/month) to serve files that belong on a CDN, and
  ruins the five-tier fleet story from ADR-001.

## Consequences
- CORS must be strict and explicit. The server refuses to start if
  `CORS_ALLOWED_ORIGINS` is empty or contains `*` (enforced in
  `server/src/config/index.ts`). Production must list every Vercel domain
  the frontend is served from — the main production domain plus any
  custom domains, but **never** the preview URLs, which are generated
  per-PR and would require a wildcard match the server rejects.
- The API must be reachable from Vercel's edge over public HTTPS — i.e.
  through the ALB. The API EC2 and the database and the worker all stay
  private; only the ALB has a public listener. That is already the
  architecture (ADR-001, CLAUDE.md section 9).
- Preview deployments (`*.vercel.app`) cannot authenticate against the
  production API because their origin is not on the CORS allow-list.
  Either add a separate staging API deployment with a permissive CORS
  list, or run previews pointed at `localhost:4000` (the default when
  `VITE_API_URL` is unset). The second is what the Vite dev server
  already does; the former is a future infra choice.
- The `client.yml` CI workflow is thinner than the other two — lint,
  test, build, and let Vercel's Git integration take over. It does not
  deploy via CLI; Vercel reads the pushed commit on `main` directly.
- Frontend errors and traffic metrics live on Vercel's dashboard, not in
  the Prometheus / Grafana stack. The backend dashboards (`fleet-overview`,
  `onboarding-jobs`) deliberately ignore frontend metrics — the split is
  honest: the fleet owns the things the fleet runs.
- If a future requirement demands SSR, server actions, or edge runtime
  code that must share the API's network, the upgrade path is either
  self-host Next.js on the fleet or move to a CloudFront + S3 + Lambda@Edge
  setup. Both are documented as future work, neither is this project.
