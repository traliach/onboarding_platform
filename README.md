# onboarding_platform

> Production-representative client onboarding platform — multi-tier AWS, Terraform modules, Ansible fleet config, BullMQ, PostgreSQL, Prometheus/Grafana

![CI](https://github.com/traliach/onboarding_platform/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/github/license/traliach/onboarding_platform)
![Tag](https://img.shields.io/github/v/tag/traliach/onboarding_platform)

## Overview

<!-- Brief description of the project and what it does -->

## Architecture

<!-- Add architecture diagram here -->

## Packages

| Package | Description |
|---------|-------------|
| `apps/web` | React + TypeScript frontend |
| `apps/api` | Node.js + Express backend |
| `packages/shared` | Shared TypeScript types |

## Quick start

```bash
git clone https://github.com/traliach/onboarding_platform.git
cd onboarding_platform
npm install
npm run dev
```

## Environment variables

```bash
cp apps/api/.env.example apps/api/.env
# fill in values
```

## CI/CD

Every push to `main` runs the full pipeline. PRs require all checks to pass before merge.

## License

[MIT](./LICENSE) © 2026 Achille Traore | [achille.tech](https://achille.tech)
