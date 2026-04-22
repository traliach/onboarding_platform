# ADR-009: Invite-only registration

## Status
Accepted

## Context
The platform needs a way to add new staff users without open self-registration — the team is 3–5 people and adding user accounts is a deliberate action, not something that should happen on demand.

The existing seed creates one admin user for local development. Without an invite flow, adding a second real user in production requires either direct SQL (`INSERT INTO users`) or shipping a registration endpoint that any visitor could hit.

## Decision
Implement invite-only registration as a third auth pattern alongside the JWT session (internal staff) and UUID portal token (external clients):

- `POST /auth/invite` [JWT required]: admin generates a single-use UUID token stored in `invite_tokens`, expiring after 24 hours. Returns the token; the frontend constructs the registration URL.
- `GET /auth/invite/:token` [public]: validates token exists, is unused, and not expired. Returns `{ email, valid: true }` or 404.
- `POST /auth/register/:token` [public]: accepts `{ password }` (minimum 12 characters), creates the user, marks the token as used in a single transaction.

The admin copies the generated link from `InviteUserModal` and sends it manually — no SMTP dependency, no email delivery risk, no third-party service.

## Rationale

**Why not open registration?**
The platform has no concept of tenants or plans — every registered user is a full admin. Open registration would make the dashboard accessible to anyone who found the URL.

**Why not a CLI script or direct SQL?**
Either works locally but breaks the "hand off to CI" story. An invite endpoint means production user provisioning goes through the same auth-protected API the rest of the platform uses, with a full audit trail (invite_tokens.created_by references the admin who generated it).

**Why 24-hour expiry?**
Long enough to send, open, and complete in the same working day. Short enough that a leaked link is automatically invalidated the next morning. Expiry is enforced at query time (`expires_at > NOW()`) not background sweep, so there are no scheduler dependencies.

**Why construct the URL client-side?**
The API has no reliable way to know the frontend origin (Vercel preview URLs are unpredictable). The admin is already on the frontend when they click "Invite user", so `window.location.origin + /register/:token` is always correct and requires no extra config.

**Meta-story for interviews:**
The platform uses token-based flows for both external access (client portal, UUID token, no expiry) and internal provisioning (staff invite, UUID token, 24h expiry). Same pattern, different constraints — shows deliberate auth design rather than copying one pattern everywhere.

## Alternatives considered
- **Open registration** — rejected: no multi-tenancy, every user is full admin, unacceptable risk.
- **CLI seed script** — rejected: requires SSH/SSM access and manual SQL knowledge from the person doing onboarding. The API path is better guarded and auditable.
- **OAuth / SSO** — out of scope per CLAUDE.md §17. Token invite is appropriate for a 3–5 person internal team.
- **Email delivery (SES/SMTP)** — the copy-link approach is deliberately simpler. Email delivery is the obvious upgrade path once SMTP config exists; no code change needed in the invite endpoint itself.

## Consequences
- `invite_tokens` table added (migration 0009).
- `POST /auth/invite`, `GET /auth/invite/:token`, `POST /auth/register/:token` added to the API surface.
- Admin UI gains "Invite user" button on Dashboard → `InviteUserModal`.
- Frontend gains public `/register/:token` route → `RegisterPage`.
- No SMTP or email delivery dependency introduced.
- Invite links are one-time-use and expire — no revocation endpoint needed; unused links expire automatically.
