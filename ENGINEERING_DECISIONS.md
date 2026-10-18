# Engineering decisions

Durable rationale for how OpsFlow works. Change log lives in `git log`.

> **Provenance.** The original project brief was not available when this was
> built. The domain choices below are therefore *documented assumptions*, not
> confirmed requirements — §1 lists each one with the single file that would
> change if the real spec differs. Nothing here has been verified against a
> specification.

## 1. Provisional assumptions

| # | Assumption | Where to change |
|---|---|---|
| 1 | Resource = `WorkItem(title, description, status, creator, assignee?, version)` | `prisma/schema.prisma`, `modules/work-items/schemas.ts` |
| 2 | States OPEN/IN_PROGRESS/REVIEW/DONE/CANCELLED; edges §5 | `modules/work-items/workflow.ts` |
| 3 | `IN_PROGRESS` requires an assignee | `workflow.ts` `checkTransition` |
| 4 | Email+password sessions, `USER`/`ADMIN` roles | `lib/auth.ts`, `lib/password.ts`, schema |
| 5 | Reads open to authenticated users; mutations need creator/assignee/ADMIN; invisible ids are 404s | `modules/work-items/authz.ts` |
| 6 | Cursor pagination `(createdAt DESC, id DESC)`, filters status/q/assignee/creator, limit ≤100 | `service.ts` `listWorkItems` |
| 7 | `Idempotency-Key` optional header; 24h replay TTL; 5-min pending fuse | `service.ts` `createWorkItem` |
| 8 | Teams: many-to-many membership with `MEMBER`/`LEAD` roles | `modules/teams.ts`, §8 |

## 2. Architecture fit

Route handlers (`src/app/api/...`) do authentication, Zod validation, and response
shaping only. All rules live in `src/modules/work-items/`: `workflow.ts` (pure
transitions), `authz.ts` (pure policy), `schemas.ts` (contracts), `service.ts`
(PostgreSQL orchestration). Workflow rules are separate from DB code so the
transition table is unit-testable without a database and reusable by any caller.

The client imports the same pure modules rather than restating them: the detail
page calls `authz.canMutate` and `workflow.allowedTransitions`, and the status and
priority literals come from `workflow.ts`. One policy, one table, one home. The
server still re-validates everything; sharing the module only stops the UI from
under-offering.

## 3. Optimistic concurrency

`WorkItem.version` starts at 1 and increments on every mutation. Mutations use a
conditional `updateMany` with `{ id, version: expected }` (transitions additionally
`{ status: expectedFrom }`) in the WHERE clause. `count === 0` is never reported as
success — the item's existence was proven before the write and items are never
deleted, so zero rows always means a lost race → `409 VERSION_CONFLICT`. The UI
carries `version` opaquely; the server pre-checks it for a fast 409 and the
database condition closes the race. No silent retries of business mutations.

## 4. Idempotency under concurrency

Retained deliberately; see §4.1.

`IdempotencyRecord @@unique([scope, key])`, scope = `POST:/api/work-items:{userId}`.
Fingerprint = sha256 of canonical `{title, description, assigneeId, teamId, priority}`.
Claim-then-complete: (1) `create` a PENDING claim — the unique constraint elects
exactly one winner; (2) losers read the committed row in their own transaction:
same fingerprint + COMPLETED → replay the stored body; different fingerprint →
`409 IDEMPOTENCY_KEY_REUSE`; fresh PENDING → `409 IDEMPOTENCY_IN_PROGRESS`; (3)
the winner runs item + CREATED-event + claim-completion in one transaction. A
rolled-back business write deletes its PENDING claim, so retries start clean and
no completed result survives a rollback. Claims start with a 5-minute fuse
(crashed requests free the key quickly); completion extends expiry to the 24h
replay window. No in-memory map or lock is involved, so this survives restarts
and multiple instances. A failed statement never poisons a later read because the
losing path uses a separate transaction, not a savepoint.

### 4.1 Why this is kept

A simplification review proposed deleting it on the grounds that the create form
already disables its submit button. That reasoning does not hold:

- **It is a published part of the API contract.** `POST /api/work-items` documents
  the `Idempotency-Key` header, `201` for a new item vs `200` for a replay, and the
  `Idempotent-Replayed: true` response header. Removing it would silently change
  the contract.
- **A disabled button does not cover the failure this prevents.** It stops a
  double-click, but not a response lost to a timeout, a dropped connection, or a
  proxy retry — precisely the cases where a second item would be created.
- **It is load-bearing for another consumer.** `prisma/demo-seed.ts` passes a
  stable `demo-seed-v1-*` key so re-running the demo dataset converges instead of
  duplicating 26 work items; `src/test/integration/demo-seed.test.ts` asserts that.
- **The duplicate-write guarantee is tested, not assumed.** Six integration tests
  cover replay, fingerprint mismatch, and a 5-way concurrent same-key race that
  asserts `workItem.count() === 1` with exactly one `CREATED` activity event.
- **The cost is proportionate.** One small table with a TTL, plus
  `npm run db:prune`.

Known writes that nothing reads: `IdempotencyRecord.statusCode` (the replay path
hardcodes 200) and `serializeWorkItem.idempotencyKey` (no client type or consumer
reads it). Both are left alone — dropping either means a schema migration or an
API response change, neither of which earns its churn.

## 5. Transactional writes

Each business write and its history share one Prisma `$transaction`: create =
item + CREATED event (+ claim completion); update = conditional `updateMany` +
FIELD_UPDATED event; transition = conditional `updateMany` + STATE_CHANGED event.
Throwing inside the callback rolls everything back. History insertion is never
best-effort, and a failed conditional update throws before any event insert.

## 6. Activity history

Domain events (`CREATED`/`FIELD_UPDATED`/`STATE_CHANGED` with from/to states and a
structured `changes` diff), not a generic ORM audit log — generic logs record
*what changed* without *why it means*, and cost a dependency for no domain value.
Append-only via ordinary operations (no update/delete API for events). Not claimed
tamper-proof: anyone with DB write access can alter history; that would need
append-only DB roles or hash-chaining.

## 7. Authorization

`getSessionUser()`/`getSessionUserByToken()` derive identity from the session
cookie server-side on every protected route and page; actor ids are never taken
from client input. `canMutate()` (creator/assignee/ADMIN/team-LEAD) gates each
mutation after loading the item; list/read/activity need authentication plus the
visibility rule. One pure function covers the whole policy, so no permission
framework.

Invisible resources are `404`, never `403`, so existence does not leak across
teams. Visible-but-forbidden mutations are `403`. List, search, and stats share one
visibility clause, so counts cannot leak either. Mutation auth is re-checked
inside the write transaction against a freshly read row.

## 8. Teams and assignment

- **Model.** `Team(id, name)` + `TeamMembership(user, team, role)` with
  `@@unique([userId, teamId])`. `WorkItem.teamId` is nullable (teamless items keep
  prior behavior) with `ON DELETE RESTRICT`, so a team holding items cannot vanish
  (`409 TEAM_IN_USE`).
- **Roles.** `MEMBER` reads team items and mutates only items they created or own;
  `LEAD` additionally manages the roster and may mutate any team item; global
  `ADMIN` bypasses both. Team creators start as LEAD, and the last LEAD cannot be
  removed.
- **Assignees.** Must exist; on team items must be team members. Eligibility is
  checked inside the transaction against the *target* team, so moving an item
  cannot strand an ineligible owner — such a move fails `400` instead. Clearing
  the assignee is always allowed to someone who may mutate.
- **Priority.** `LOW|MEDIUM|HIGH|URGENT`, default `MEDIUM`; settable at creation,
  editable, filterable, and part of the idempotency fingerprint. No due dates or
  overdue derivation, because nothing required them.
- **No framework.** Three rules and two roles stay in one pure module plus a
  ~200-line service. A permission library is unjustified at this size.

## 9. Search & pagination

Filters validated by Zod and applied in PostgreSQL (`contains mode: insensitive`
for `q`, equality for the rest). Ordering `(createdAt DESC, id DESC)` with the
unique `id` tie-breaker is deterministic; the cursor is base64url `{createdAt, id}`
and malformed cursors are `400` (never silently "first page"). `take(limit+1)`
detects the next page. Indexes: `(status, createdAt DESC, id DESC)`, `assigneeId`,
`creatorId`, `teamId`, `priority`, and `(workItemId, createdAt DESC, id DESC)` for
history.

## 10. Dependencies adopted / rejected

Adopted: Next.js + React (required), Prisma 6, Zod 4 (contracts), Vitest 5 + tsx
(tests/seed), `clsx` + `tailwind-merge` + `class-variance-authority` and five Radix
packages underpinning shadcn/ui. Auth, hashing, sessions, icons, toasts, and the
password hasher use Node stdlib and local code.

Rejected: Auth.js (OAuth machinery is unneeded for email+password; the whole
authentication module — scrypt hashing, session issue/lookup/destroy, trusted-edge
client keys for rate limiting, the timing-parity failure path, and registration —
is ~140 lines of local code with no framework), CASL or any permission framework
(one-rule policy, §7), XState
(five-state linear flow), generic audit-log libraries (§6), an icon library
(§13), and an animation library (CSS transitions only). New deps need a
justification stronger than "might need it later."

## 11. Frontend stance

Server validates everything; the client only mirrors states (loading/empty/error,
field errors, 409 conflict with reload, replay-safe retries via a per-form
idempotency key). Workflow buttons show currently-legal actions as a convenience —
the API re-validates every transition.

## 12. Testing strategy

Unit (no DB, `npm run test:unit`): full transition matrix, preconditions, authz
policy, cursor round-trip/malformed, schemas, rate-limit behaviour, filter/URL
mapping, and the client's request/error mapping.

Integration (real PostgreSQL, `TEST_DATABASE_URL`, `npm run test:integration`):
happy-path walk, illegal transitions, stale-version rejection, racing updates
(one winner + one event), no event on failed writes, rollback, idempotency
replay/reuse-race/rollback-cleanup, outsider 403s, full pagination traversal,
filter correctness, deterministic ordering, invalid cursor, registration and login
rate-limit policy, team/roster rules, and demo-seed reconciliation.

Integration files share one test database and each resets it in `beforeEach`
(`helpers.ts`); `fileParallelism: false` keeps files sequential. Mocked-DB tests are
deliberately absent for the transaction, uniqueness, and concurrency guarantees —
those claims are only credible against a real database.

## 13. Frontend design system

shadcn/ui on Tailwind v4. `src/app/globals.css` holds the token layer
(`--status-*`, `--priority-*` → `@theme inline` → utilities) and
`src/components/ui/*` the primitives; `components.json` lets `npx shadcn add …`
drop new components in beside the existing ones.

**Hue names encode meaning, not colour** — `--status-{open,progress,review,done,cancelled}`
rather than `--slate/--violet`. Renaming the axis keeps a token name from becoming
a lie when the art direction changes. One tone map in `kit.tsx` drives badges,
tiles, the stepper, and the timeline, so a status cannot drift between them.
Colour tokens are never hardcoded in a component; the only raw hex values left are
the four avatar identity swatches.

**Deliberately not added:** Radix `Select` (every filter uses `""` for "no
filter", which Radix forbids; native `<select>` also gives the mobile OS picker and
keyboard support, and `ui/select.tsx` keeps the swap to one file); an animation
library (overlays use two CSS keyframes, everything else is a 150ms colour
transition, and motion respects `prefers-reduced-motion`); a toast library (the
existing `notify()` bus works and sonner would be a new dependency).

**Typography:** Geist via `next/font/google` — fetched at build time by Next
itself, so it adds no dependency and no runtime request.

Two defects fixed during this work, both frontend-only, recorded because the
reasoning generalises:

1. Radix's `AlertDialogAction` closed the dialog on click, destroying server
   errors (a 409 `TEAM_IN_USE` the user never got to read). `ConfirmDialog` uses
   plain buttons and keeps open state owned by the caller, so the dialog closes
   only when the operation actually succeeded.
2. `refresh()` cleared the conflict message in the same React batch that set it,
   so a stale-write 409 refreshed the row but never explained itself.

## 14. Known limitations & trade-offs

- Activity feed capped at 100/item, unpaginated.
- Sessions are DB-backed, so they survive restarts, but there is no rotation or
  revocation UI.
- Login rate limiting is an in-memory token bucket (5 failures / 10 min per
  client+email, reset on success), plus the scrypt cost of every attempt. It is
  single-process by design; a multi-instance deployment needs a shared store, and
  public exposure wants a CAPTCHA.
- `updateMany` returns a count, not the row — one extra `findUnique` per mutation
  inside the same transaction; negligible against the safety it buys.
- Cursor pagination exposes no total counts (by design — counts are unstable under
  concurrent writes). The dashboard gets exact totals from `GROUP BY` instead.
- History is append-only by convention, not by DB enforcement (§6).
- No committed e2e or component suite. UI flows have only been exercised manually
  and by throwaway harnesses; treat the UI as unit- and integration-tested, not
  browser-tested.
- No team-rename and no work-item delete endpoint exists, so no UI control offers
  them (§8).
- Accessibility: status and priority are always paired with a text label and form
  errors carry `role="alert"`, but no formal WCAG conformance audit was performed,
  and only Chrome was checked.
- The work-item table is ~820px wide and scrolls horizontally on narrow screens
  rather than collapsing into cards.