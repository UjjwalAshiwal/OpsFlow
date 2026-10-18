# OpsFlow — work-item management

A work-item tracker with a controlled workflow, optimistic concurrency, transactional
activity history, idempotent creation, and resource-level authorization.

> **Provenance.** The original project brief was not available when this was built.
> The domain model is therefore a documented set of assumptions rather than
> confirmed requirements. §Domain below and `ENGINEERING_DECISIONS.md` §1 list each
> assumption with the one file to change if the real specification differs. Nothing
> here has been verified against a specification.

## Domain

- **Resource:** `WorkItem` — `title`, `description`, `status`, `priority`
  (`LOW|MEDIUM|HIGH|URGENT`, default `MEDIUM`), `creator`, optional `assignee`,
  optional `team`, `version` (concurrency token), timestamps.
- **Workflow:** `OPEN → IN_PROGRESS → REVIEW → DONE`, plus `→ CANCELLED` from
  `OPEN`/`IN_PROGRESS`/`REVIEW`, plus `REVIEW → IN_PROGRESS` (rework). Entering
  `IN_PROGRESS` requires an assignee. `DONE`/`CANCELLED` are terminal.
- **Teams:** users join many teams with `MEMBER`/`LEAD` roles; team items are
  visible to members (and `ADMIN`) only. Teamless items stay visible to all
  authenticated users.
- **Auth:** email + password, server-side sessions in an `httpOnly` cookie.
- **Authorization:** teamless reads open to authenticated users; team items to
  members/`ADMIN`, where invisible ids are `404`s. Mutating requires creator,
  assignee, `ADMIN`, or `LEAD` of the item's team (`403` on visible-but-forbidden).
  Assignees must exist, and must belong to the item's team when it has one.
- **Pagination:** cursor-based on `(createdAt DESC, id DESC)`, filters `status`,
  `priority`, `q` (title/description), `assigneeId`, `creatorId`, `teamId`,
  `limit` 1–100. A malformed cursor is `400`, never silently page one.
- **Idempotency:** `POST /api/work-items` accepts an optional `Idempotency-Key`
  (1–64 chars, `[A-Za-z0-9_-]`). Same key + same payload replays; same key +
  different payload → `409`; concurrent same-key → at most one item. Completed
  results replay for 24h; crashed claims free the key within 5 minutes. See
  `ENGINEERING_DECISIONS.md` §4.1 for why this is kept rather than inferred from
  the disabled submit button.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · Zod 4 ·
PostgreSQL 16 · Prisma 6 · Vitest 5 · ESLint 9. Auth, hashing, and sessions use
Node stdlib (`node:crypto` scrypt) — no Auth.js, no permission framework, no
workflow or audit-log library, no icon or animation library. Rationale in
`ENGINEERING_DECISIONS.md` §10.

### UI

shadcn/ui (new-york style, `components.json` at the repo root) on Tailwind CSS 4
with CSS-variable theming:

- `src/components/ui/*` — shadcn primitives: `button`, `input`, `textarea`,
  `label`, `select`, `card`, `badge`, `table`, `skeleton`, `separator`, `avatar`,
  `alert`, `alert-dialog`, `dropdown-menu`, `sheet`.
- `src/components/kit.tsx` — app components composed from those primitives:
  session hooks, `Field`, `FormSection`, `PageHeader`, `KeyValueRow`,
  `FilterChip`, `WorkItemRow`, status/priority/team/role badges, the shared status
  tone maps, `EmptyState`/`ErrorState`/`LoadingPanel`/`TableSkeleton`,
  `Pagination`, `ConfirmDialog`, toasts.
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge). Colour tokens live in
  `src/app/globals.css` (`@theme inline`); no component hardcodes a colour.

**Art direction: warm neutrals + forest green.** Warm paper surfaces, a
charcoal-green navigation rail, forest green reserved for meaningful actions and
selected states. Structure comes from borders and spacing; shadows are a hairline
at rest and one lift for overlays.

**State vocabulary** — one colour per state, reused identically in badges, tiles,
tables, the workflow stepper, and the activity timeline, always paired with a
text label (never colour alone):

| Status | Text | Surface | | Priority | Text |
|---|---|---|---|---|---|
| `OPEN` | `#586B60` | `#E9EEE9` | | `LOW` | `#586B60` |
| `IN_PROGRESS` | `#476A9C` | `#E9EFF8` | | `MEDIUM` | `#5B6570` |
| `REVIEW` | `#8B6324` | `#F5EEDC` | | `HIGH` | `#8B6324` |
| `DONE` | `#28634E` | `#E3EEE6` | | `URGENT` | `#A34D45` |
| `CANCELLED` | `#A34D45` | `#F5E7E4` | | | |

`REVIEW`/`HIGH` are darker than the original art-direction value (`#936A28`,
4.19:1) so the 11px badge text clears WCAG AA at 4.64:1. `muted-foreground` is
likewise `#6A6E67` rather than `#777B74` (3.99:1 → 4.81:1).

## Prerequisites

Node.js 20+ (developed on 26), npm, and Docker (for PostgreSQL).

## Quick start

```bash
cp .env.example .env            # safe placeholders only; never commit real secrets
docker compose up -d db         # PostgreSQL 16 on localhost:5434
npx prisma migrate dev          # apply migrations (creates DB objects)
npm run db:seed                 # dev accounts + sample items (dev only)
npm run dev                     # http://localhost:3000
```

Dev accounts (seeded, dev-only): `admin@newtonite.local / admin12345` (`ADMIN`),
`alice@newtonite.local / alice12345`, `bob@newtonite.local / bob12345`.

## Deployment safety

Everything above is **local development only**. Read this before deploying anywhere.

- **The database credentials in `.env.example` and `docker-compose.yml` are
  development placeholders.** They exist so `docker compose up -d db` works on a
  laptop. The compose file binds PostgreSQL to `localhost:5434` — do not change
  that binding to expose it.
- **Never expose the development database** to a public interface, and never reuse
  it as a production database. A production deployment needs its own separately
  provisioned database.
- **Production must use separately generated credentials.** Create a dedicated
  database user and a fresh password; do not copy the values from `.env.example`
  or `docker-compose.yml`.
- **The seed accounts are for local testing only.** `npm run db:seed` creates
  `ADMIN`, `alice`, and `bob` with the passwords shown above. Never run the seed
  against a production database, and delete these accounts before going live.
  Hiding the credential panel in the login page does not make seeded accounts safe
  — the accounts and their passwords come from `prisma/seed.ts`.
- **Real secrets belong in environment variables** supplied by your host or
  platform's secret manager (Vercel, Docker `--env-file`, Kubernetes Secrets,
  CI/CD secret stores). Never commit a `.env` file; `.gitignore` already blocks
  the common ones and deliberately allows only `.env.example`.
- Before exposing this app publicly, also address
  [Known limitations](#known-limitations) — notably the in-memory login rate
  limit, which does not coordinate across instances.

## Tests

```bash
npm run test:unit                # pure unit tests (no database)
# Integration tests need a REAL PostgreSQL test database:
docker exec newtonite-postgres psql -U newtonite -d newtonite -c "CREATE DATABASE newtonite_test;"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push   # sync schema into test DB
DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration
DATABASE_URL="$TEST_DATABASE_URL" npm run test          # everything, against the test DB
```

Unit tests cover the transition matrix, the authz policy, cursors, schemas, the
rate limiter, filter/URL mapping, and the client's request/error mapping.
Integration tests prove transaction, uniqueness, concurrency, authorization,
registration/login rate-limit, and demo-seed reconciliation behavior against real
PostgreSQL. Mocked-DB tests are deliberately absent for those guarantees.

Every integration file refuses to run unless `DATABASE_URL` contains `test`, and
they share one database, reset per test (`src/test/integration/helpers.ts`).

## Other commands

```bash
npm run lint          # ESLint
npx tsc --noEmit      # typecheck
npm run build         # production build
npm start             # serve production build (needs DATABASE_URL)
npm run db:prune      # delete expired idempotency records (run on a schedule)
npx prisma migrate deploy   # fresh-DB / CI migration check
```

## API

All responses are JSON. Errors are `{ error: { code, message, details? } }` —
never stack traces or SQL. `401` = missing/invalid session, `403` = forbidden,
`404` = not found, `400` = validation, `422` = bad transition
(`INVALID_TRANSITION`) or unmet precondition (`PRECONDITION_FAILED`), `409` =
`VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSE`, `IDEMPOTENCY_IN_PROGRESS`,
`TEAM_IN_USE`, or rate-limit exceeded (`RATE_LIMITED`, after 5 failed logins per
10 min per client+email).

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | no | `{email, password}` → sets `nt_session` cookie |
| POST | `/api/auth/register` | no | `{name, email, password}` → new `USER`, signed in, 201 |
| POST | `/api/auth/demo-login` | no | one fixed demo identity, never `ADMIN`; 503 if unseeded |
| GET | `/api/auth/session` | no | `{user \| null}` |
| DELETE | `/api/auth/session` | yes | logout |
| GET | `/api/users` | yes | assignee directory `{users}` |
| GET | `/api/teams` | yes | own teams (`ADMIN`: all) `{teams}` |
| POST | `/api/teams` | yes | `{name}` → creator becomes `LEAD`, 201 |
| GET | `/api/teams/:id` | yes, member/admin | `{team}` with roster + item count |
| DELETE | `/api/teams/:id` | yes, lead/admin | 409 if the team still has items |
| POST | `/api/teams/:id/members` | yes, lead/admin | `{userId, role}` → upsert roster entry |
| DELETE | `/api/teams/:id/members/:userId` | yes, lead/admin | last `LEAD` cannot be removed |
| GET | `/api/work-items?status&priority&q&assigneeId&creatorId&teamId&limit&cursor` | yes | `{items, nextCursor}`, visibility-scoped |
| GET | `/api/work-items/stats` | yes | exact per-status `{counts, total}` via `GROUP BY`, visibility-scoped |
| POST | `/api/work-items` | yes | `Idempotency-Key` header optional; 201 new, 200 replay (`Idempotent-Replayed: true`); `teamId` needs membership, assignee must be eligible |
| GET | `/api/work-items/:id` | yes, visible | `{item}` (includes `version`, `priority`, `team`); invisible ids 404 |
| PATCH | `/api/work-items/:id` | yes, creator/assignee/admin/team-lead | `{version, title?, description?, assigneeId?, teamId?, priority?}` |
| POST | `/api/work-items/:id/transitions` | yes, creator/assignee/admin/team-lead | `{version, to, assigneeId?}` |
| GET | `/api/work-items/:id/activity` | yes, visible | newest-first `{events}` (cap 100) |

Example:

```bash
# login (cookie jar keeps the session)
curl -s -c jar -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@newtonite.local","password":"alice12345"}'
# idempotent create
curl -s -b jar -X POST localhost:3000/api/work-items \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"title":"First item","description":"hello"}'
```

## Project layout

```
prisma/            schema.prisma, migrations/, seed.ts, demo-seed.ts, prune.ts
src/app/           pages (login, register, dashboard, work-items list/detail/new, my-work, teams list/detail) + api/ routes
src/components/   ui/ (shadcn primitives), kit.tsx (app components), shell.tsx (nav),
                   icons.tsx (zero-dep SVG set), work-items-table.tsx
src/lib/           db, auth (sessions), password (scrypt), errors, cursor, client, rate-limit,
                   filters (list URL<->API mapping, pure), use-team-roster, dates, utils (cn)
src/modules/teams.ts          team + roster rules (create/list/roster/delete)
src/modules/work-items/  workflow (pure) · schemas (zod) · authz (pure) · service (db orchestration)
src/test/unit/     workflow, authz, cursor, schemas, rate-limit, filters, client-api (no DB)
src/test/integration/  helpers.ts + service tests against real PostgreSQL
```

Capability and coverage detail: `FEATURE_MATRIX.md`.
Design and engineering rationale: `ENGINEERING_DECISIONS.md`.

Route handlers do auth + validation + serialization only; all business rules live
in `src/modules/work-items/` and `src/modules/teams.ts`.

## What the UI covers

Every endpoint in the table above has a UI path: login/register/logout, the demo
entry, work-item list (search, status/priority/assignee/creator/team filters,
cursor pagination), create, detail, edit, workflow transitions, activity history,
dashboard stats, My Work, and full team management (`/teams`: create, list, roster
with role changes, add/remove member, delete). Filters are deep-linkable, e.g.
`/work-items?status=REVIEW&assignee=mine&teamId=<id>`. The client imports the
server's `authz.canMutate` and `workflow.allowedTransitions` rather than
re-implementing them, so the UI does not under-offer what the API allows.

## Demo data

`prisma/demo-seed.ts` builds a realistic demo workspace behind the "Explore Demo"
button. It is safe by construction:

- **Opt-in twice.** It refuses to write without `--yes`, and refuses a localhost
  database unless `--force` is also passed.
- **Demo-owned records only.** Users with `@demo.opsflow.invalid` emails, two
  fixed team ids, and work items carrying a `demo-seed-v1-*` idempotency key.
  Unrelated users and teams are never touched, and nothing is ever deleted.
- **Idempotent.** Every record is reconciled by a stable identifier, so re-running
  converges instead of duplicating. Verified: a second run creates nothing.
- **No ADMIN.** Demo users are always `USER`; the script fails if any is an
  `ADMIN`, and `POST /api/auth/demo-login` also refuses an admin account.
- **Through the domain layer.** Items are created via `createWorkItem` and moved
  via `transitionWorkItem`, so workflow rules and history are enforced rather than
  hand-written.

## Known limitations

- No committed e2e or component suite. UI flows have been exercised manually and by
  throwaway harnesses, so they are **not** reproducible from a clean checkout.
  Backend guarantees are covered by the integration tests. See `FEATURE_MATRIX.md`.
- Activity history is capped at 100 entries per item, with no pagination.
- Login rate limiting is an in-memory token bucket per process (plus scrypt cost
  per attempt); add a shared store and a CAPTCHA before public exposure.
- Sessions are DB-backed and survive restarts, but there is no rotation or
  revocation UI.
- Teams cannot be renamed and work items cannot be deleted — no endpoint exists,
  so no UI control offers them.
- The assignee picker lists the team roster once it loads; until then it shows
  every user. An ineligible pick is still rejected server-side with 400.
- Accessibility: status and priority are always paired with a text label, and form
  errors carry `role="alert"`, but **no formal WCAG conformance audit was
  performed**. Measured: body text 14.4:1, status badges ≥4.6:1, focus ring 4.6:1.
  Borders sit at ~1.3:1 against cards (below the 3:1 of WCAG 1.4.11 for input
  boundaries) — a deliberate trade for the soft-border look; focus rings and text
  carry the state instead. Only Chrome was verified; Safari, Firefox, and
  screen-reader output are untested.
- The work-item table is ~820px wide and scrolls horizontally on narrow screens
  rather than collapsing into cards.
- See `ENGINEERING_DECISIONS.md` §14 for the full trade-off list.