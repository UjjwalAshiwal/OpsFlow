# Engineering decisions

Baseline: a work-item tracker with a controlled workflow. The original brief was
absent, so §1 lists every provisional assumption; everything else follows from it.

## 1. Provisional assumptions (confirm against the real brief)

| # | Assumption | Where to change |
|---|---|---|
| 1 | Resource = `WorkItem(title, description, status, creator, assignee?, version)` | `prisma/schema.prisma`, `schemas.ts` |
| 2 | States OPEN/IN_PROGRESS/REVIEW/DONE/CANCELLED; edges §5 | `modules/work-items/workflow.ts` |
| 3 | `IN_PROGRESS` requires an assignee | `workflow.ts` `checkTransition` |
| 4 | Email+password sessions, `USER`/`ADMIN` roles | `lib/auth.ts`, `lib/password.ts`, schema |
| 5 | Reads open to authenticated users; mutations need creator/assignee/ADMIN; plain 404s | `modules/work-items/authz.ts` |
| 6 | Cursor pagination `(createdAt DESC, id DESC)`, filters status/q/assignee/creator, limit ≤100 | `service.ts` `listWorkItems` |
| 7 | `Idempotency-Key` optional header; 24h replay TTL; 5-min pending fuse | `service.ts` `createWorkItem` |

## 2. Architecture fit

Route handlers (`src/app/api/...`) do authentication, Zod validation, and response
shaping only. All rules live in `src/modules/work-items/`: `workflow.ts` (pure
transitions), `authz.ts` (pure policy), `schemas.ts` (contracts), `service.ts`
(PostgreSQL orchestration). Workflow rules are separate from DB code so the
transition table is unit-testable without a database and reusable by any caller.

## 3. Optimistic concurrency

`WorkItem.version` starts at 1 and increments on every mutation. Mutations use a
conditional `updateMany` with `{ id, version: expected }` (transitions additionally
`{ status: expectedFrom }`) in the WHERE clause. `count === 0` is never reported as
success — the item's existence was proven before the write and items are never
deleted, so zero rows always means a lost race → `409 VERSION_CONFLICT`. The UI
carries `version` opaquely; the server pre-checks it for a fast 409 and the
database condition closes the race. No silent retries of business mutations.

## 4. Idempotency under concurrency

`IdempotencyRecord @@unique([scope, key])`, scope = `POST:/api/work-items:{userId}`.
Fingerprint = sha256 of canonical `{title, description, assigneeId}`.
Claim-then-complete: (1) `create` a PENDING claim — the unique constraint elects
exactly one winner; (2) losers read the committed row in their own transaction:
same fingerprint + COMPLETED → replay stored `{statusCode, body}`; different
fingerprint → `409 IDEMPOTENCY_KEY_REUSE`; fresh PENDING → `409
IDEMPOTENCY_IN_PROGRESS`; (3) the winner runs item + CREATED-event + claim-completion
in one transaction. A rolled-back business write deletes its PENDING claim, so
retries start clean and no completed result survives a rollback (tested). Claims
start with a 5-minute fuse (crashed requests free the key quickly); completion
extends expiry to the 24h replay window. In-memory maps/locks are not used, so
this survives restarts and multiple instances. A failed statement never poisons a
later read because the losing path uses a separate transaction, not a savepoint.

## 5. Transactional writes

Each business write and its history share one Prisma `$transaction`: create =
item + CREATED event (+ claim completion); update = conditional `updateMany` +
FIELD_UPDATED event; transition = conditional `updateMany` + STATE_CHANGED event.
Throwing inside the callback rolls everything back (proven by the FK-violation
rollback test). History insertion is never best-effort, and failed conditional
updates throw before any event insert.

## 6. Activity history

Domain events (`CREATED`/`FIELD_UPDATED`/`STATE_CHANGED` with from/to states and a
structured `changes` diff), not a generic ORM audit log — generic logs record
*what changed* without *why it means*, and cost a dependency for no domain value.
Append-only via ordinary operations (no update/delete API for events). Not claimed
tamper-proof: anyone with DB write access can alter history; that would need
append-only DB roles or hash-chaining, which the requirements don't ask for.

## 7. Authorization

`getSessionUser()`/`getSessionUserByToken()` derive identity from the session
cookie server-side on every protected route and page; actor ids are never taken
from client input. `canMutate()` (creator/assignee/ADMIN) gates each mutation
after loading the item; list/read/activity need authentication only. One 20-line
pure function covers the whole policy, so no permission framework.

## 8. Search & pagination

Filters validated by Zod and applied in PostgreSQL (`contains mode: insensitive`
for `q`, equality for the rest). Ordering `(createdAt DESC, id DESC)` with the
unique `id` tie-breaker is deterministic; the cursor is base64url `{createdAt, id}`
and malformed cursors are 400 (never "first page"). `take(limit+1)` detects the
next page. Indexes: `(status, createdAt DESC, id DESC)`, `assigneeId`, `creatorId`,
`(workItemId, createdAt DESC, id DESC)` for history.

## 9. Patterns studied

The brief named five reference projects for *patterns to evaluate*, not code to
copy; no code was copied from any of them (all implementation here is original).
What each contributed: atomic check-then-set must become a conditional write
(race-condition finding → §3); business change + history in one transaction
(→ §5); uniqueness constraints as the concurrency primitive for idempotency plus
fingerprint mismatch as conflict (→ §4); hand-rolled ability checks over CASL
for a two-role policy (→ §7); domain events over generic audit logs (→ §6).
Licensing: no third-party code vendored, so no attribution obligations; runtime
deps are Next/React/Prisma/Zod (MIT/Apache-2.0).

## 10. Dependencies adopted / rejected

Adopted: Next.js + React (required), Prisma 6 stable (pinned — v8 was RC at
scaffold time), Zod 4 (contracts), Vitest 5 + tsx (tests/seed). Rejected:
Auth.js (OAuth machinery unneeded for email+password; scrypt + sessions ≈ 60
lines), CASL (one-rule policy), XState (five-state linear flow), generic audit-log
libs (see §6), Playwright (deferred — integration tests cover critical paths;
revisit for UI regressions). New deps need a justification stronger than "might
need it later."

## 11. Frontend stance

Server validates everything; the client only mirrors states (loading/empty/error,
field errors, 409 conflict with reload, replay-safe retries via a per-form
idempotency key). Workflow buttons show currently-legal actions as a convenience —
the API re-validates every transition.

## 12. Testing strategy

Unit (no DB): full transition matrix, preconditions, authz policy, cursor
round-trip/malformed. Integration (real PostgreSQL, `TEST_DATABASE_URL`):
happy-path walk, illegal transitions, stale-version rejection, racing updates
(one winner + one event), no event on failed writes, FK-failure rollback,
idempotency replay/reuse-race/rollback-cleanup, outsider 403s, full pagination
traversal, filter correctness, deterministic ordering, invalid cursor. Route-level
401s verified live with curl (every route calls `getSessionUser()` first).

## 13. Known limitations & trade-offs

- Activity feed capped at 100/item, unpaginated; sessions single-DB; scrypt
  ~50ms/login with in-memory rate limiting (shared store + CAPTCHA before
  internet exposure at scale — see §14).
- `updateMany` returns a count, not the row — one extra `findUnique` per mutation
  inside the same transaction; negligible vs. the safety.
- Cursor pagination has no total counts (by design — counts are unstable under writes).
- History is append-only by convention, not by DB enforcement (see §6).
- No Playwright e2e yet (see §10).

## 14. Post-audit fixes (D-01, D-03, D-04, D-10)
- **Status counts (D-01).** `GET /api/work-items/stats` runs a single
  `GROUP BY status` count query — exact totals without fetching rows. Same read
  policy as list (authenticated users). The dashboard consumes it; the "100 most
  recent" scope note now applies only to the spotlight lists, which is labeled.
- **Login timing parity (D-03).** `authenticateUser()` (lib/auth.ts) always runs
  one scrypt verification — against the stored hash, or a hard-coded dummy hash
  for unknown emails — and returns identical 401 code/message either way.
- **Rate limiting (D-10).** In-memory token bucket (5 failures / 10 min per
  client+email, `src/lib/rate-limit.ts`), 429 with `retryAfterSeconds`, reset on
  success. Single-process by design; multi-instance needs a shared store.
  `SESSION_SECRET` (D-04) was removed from `.env.example` — sessions are opaque
  tokens, never signed, so the variable was dead config.
- **Test serialization.** Integration files share one test database and each
  resets it in `beforeEach`; `fileParallelism: false` in vitest.config.mts keeps
  files sequential. (Parallel workers caused cross-file truncation failures —
  an environment artifact, not an app defect.)

## 15. Teams, priority, and assignment (task-specified)

The original brief is still unavailable, so the semantics below implement the
completion task's Phases 2–4 explicitly — they are confirmed against the task,
not the brief. Reconcile before evaluation if the brief surfaces.

- **Model.** `Team(id, name)` + `TeamMembership(user, team, role)` with
  `@@unique([userId, teamId])`; users belong to many teams. `WorkItem.teamId`
  is nullable (legacy teamless items keep prior behavior) with
  `ON DELETE RESTRICT` so teams holding items cannot vanish (409 `TEAM_IN_USE`).
  `WorkItem.priority` is `LOW | MEDIUM | HIGH | URGENT`, default `MEDIUM`;
  migration `20261016162119_teams_and_priority` backfills without touching rows.
- **Team roles.** `MEMBER` reads team items and mutates only items they created
  or own; `LEAD` additionally manages the roster and may mutate any team item;
  global `ADMIN` bypasses everything. Roster writes are upserts; the last LEAD
  cannot be removed; team creators start as LEAD.
- **Authorization.** Reads: teamless items visible to all authenticated users;
  team items to members/ADMINs only — invisible ids are 404s (cross-team reads,
  activity, and mutations all 404, never 403, so existence doesn't leak).
  Mutations: creator/assignee/ADMIN/LEAD-of-team, else 403 on visible items.
  List/search/stats share one visibility clause, so counts can't leak either.
  Mutation auth is re-checked inside the write transaction on a fresh row.
- **Assignees.** Must exist; on team items must be team members (checked in-txn
  against the *target* team, so team moves can't strand ineligible owners —
  such moves fail 400 instead). Clearing (`null`) is always permitted to
  someone who may mutate. Every assignment change lands in the same
  transaction's `FIELD_UPDATED`/`STATE_CHANGED` event.
- **Priority.** Set at creation, editable via PATCH, filterable (`?priority=`),
  displayed as badge/table/list/detail/dashboard, and diffed into history like
  any field. Part of the idempotency fingerprint. No due dates or overdue
  derivation — not required, so not invented.
- **No framework.** Three team rules + two roles stay in one pure module
  (`authz.ts`) and one ~200-line service (`modules/teams.ts`); CASL et al.
  remain unjustified.

## 16. Closing the frontend/backend gap (feature-completeness audit)

An end-to-end audit found that the whole team feature existed server-side with
integration coverage but had no UI at all: `/api/teams*` was only ever called to
fill dropdowns, and `ApiTeamDetail` was declared in `lib/client.ts` and never
imported — a type written for a page that was never built. Three smaller gaps
were found alongside it, each traced to duplicated policy rather than missing
code.

**Rule: one policy, one table, one home.** The fixes delete logic instead of
adding it:

- The work-item detail page re-implemented mutation permission as
  `ADMIN || creator || assignee`, which silently omitted the *team LEAD* case —
  a lead who is neither creator nor assignee saw no edit or transition controls
  on items the API accepts. It now calls `authz.canMutate` (already unit-tested)
  with the caller's role from `GET /api/teams`, so the UI cannot drift from the
  policy again. The server remains the authority; this only stops the UI from
  under-offering.
- The transition table was a literal copy in the client. It is now imported from
  `workflow.ts` via `allowedTransitions`/`isTerminal`.
- List filter ↔ URL ↔ API mapping moved into `src/lib/filters.ts` as pure
  functions with a unit test. It also fixed a real bug: the URL-sync effect
  rewrote the query string to `status` only, dropping `assignee`, `teamId`, and
  `priority`, so deep links silently degraded on load.

**Two new UI pages, no new endpoints.** `/teams` (list + create) and
`/teams/[id]` (roster, add/remove member, role change, delete, link to the
team's work) are thin clients over the existing five routes. Team deletion
surfaces the existing 409 `TEAM_IN_USE`; roster writes surface the existing
last-lead 400. No rename control and no work-item delete control exist because
no endpoint backs them.

**Eligibility surfaced, not enforced, in the UI.** `useTeamRoster` fetches the
team roster so assignee pickers list only eligible people (the API rejects the
rest with 400 either way). It is deliberately a convenience: authorization is
still decided solely by `assertAssigneeEligible` inside the write transaction.

**Manager rules mirrored exactly.** `canManage` on the team page is
`ADMIN || myRole === LEAD`, matching `addMember`/`removeMember`/`deleteTeam`,
which treat a global ADMIN as LEAD-equivalent.

Verified with headless Chrome driven over CDP (41 UI checks: create team → add
member → promote → member read-only view → lead edits another member's team
item → transitions → deep links → removal → last-lead guard → delete guard →
unauthenticated redirect), plus the existing unit and integration suites.

## 17. Frontend design system: shadcn/ui on Tailwind v4

The interface was rebuilt on shadcn/ui without changing a single API, schema,
authorization rule, or workflow. Two files carry the weight: `src/app/globals.css`
(CSS variables → `@theme inline` → utilities) and `src/components/ui/*` (the
copied primitives). `components.json` points shadcn's CLI at this layout, so
`npx shadcn add …` drops new components in beside the existing ones.

**Added (7 packages, all MIT):** `clsx`, `tailwind-merge`,
`class-variance-authority` (the `cn()`/variant contract shadcn is built on) and
Radix `react-dialog`, `react-alert-dialog`, `react-dropdown-menu`, `react-slot`,
`react-label`. `react-slot` powers `Button asChild`, which is why links are
styled buttons instead of `<a className="button">`.

**Deliberately not added:**

- **`lucide-react`.** shadcn's templates import it, but the repo already ships a
  zero-dependency 24×24 stroke icon set (`components/icons.tsx`) that covers
  every icon the app uses. Swapping in a ~600KB icon library for identical
  glyphs would be churn, not improvement. `components.json` records
  `iconLibrary: "custom"` and the primitives import from the local set.
- **Radix `Select`.** Every filter in this product uses `""` to mean "no
  filter"; Radix forbids empty `SelectItem` values, so it would force sentinel
  values across ten call sites. Native `<select>` also gives the OS picker on
  mobile and full keyboard support for free. It is wrapped in `ui/select.tsx`,
  so swapping later is a one-file change.
- **An animation library.** Overlays use two CSS keyframes in `globals.css`;
  everything else is a 150ms colour transition. Motion respects
  `prefers-reduced-motion` via the existing media query.
- **sonner.** The app already had a working toast bus (`notify()` +
  `Toaster`); replacing it would add a dependency for behaviour that exists.

**Typography:** Geist via `next/font/google` — fetched at build time by Next
itself, so it adds no dependency and no runtime request. The theme already
referenced `--font-geist-sans`; nothing was loading it, so the app had been
rendering in the system fallback.

**One vocabulary:** the old design had app-specific colour names (`text-ink`,
`border-line`, `bg-deep`, `bg-mist`…). They were mapped onto semantic tokens
(`text-foreground`, `border-border`, `bg-sidebar`, `bg-info/10`…) rather than
kept as aliases, so there is exactly one way to express a colour.

### Two defects found and fixed while doing this

Both were pre-existing, and both are frontend-only; no backend behaviour changed.

1. **Radix's `AlertDialogAction` closed the dialog on click**, which swallowed
   server errors: deleting a team that still holds items returned 409
   `TEAM_IN_USE` and the message was destroyed before the user could read it.
   `ConfirmDialog` now uses plain buttons and keeps open state owned by the
   caller, so the dialog closes only when the operation actually succeeded.
   (Caught by the browser suite, not by the eye.)
2. **`refresh()` cleared the conflict message in the same React batch that set
   it.** A stale-write 409 therefore refreshed the row but never explained
   itself — the optimistic-concurrency feedback the requirements ask for was
   silently absent. `refresh()` no longer clears `conflict`; successful
   saves and transitions clear it explicitly.

Both are covered by the CDP browser suite, which asserts the 409 text is
actually visible after a forced stale write.

## 18. Second pass: composition, not colour

§17 established the token layer. That alone is a recolour, which is not a
redesign — the pass that followed changed how pages are *composed*:

- **Workflow stepper.** The detail page now renders the real transition table
  (`OPEN → IN PROGRESS → REVIEW → DONE`, `CANCELLED` shown as an off-path
  terminal) as a progress rail, driven by `workflow.ts`, next to the legal
  actions. The server still re-validates every transition; the rail exists so a
  user can see where an item sits without reading the buttons.
- **Two badge shapes.** Status is a tinted pill with a dot; priority is a bare
  uppercase label in its tone. Same hue vocabulary, different silhouette, so two
  dimensions stay separable in a dense table.
- **Properties rail.** The detail page's metadata moved out of a generic list
  into a labelled rail (assignee, creator, team, priority, timestamps) with
  `KeyValueRow`, matching the roster and team summaries.
- **Human-readable history.** Activity events render as one sentence each
  ("Alice moved OPEN → REVIEW", "Alice priority “MEDIUM” → “HIGH”") derived from
  the existing `changes` JSON, instead of "Updated title, priority".
- **Filter chips.** The list page shows active filters as removable chips, so a
  deep-linked, multi-filter view can be dismantled one filter at a time.
- **Table density.** Rows are tighter, the header is tinted rather than ruled,
  and the table gained a result-count strip ("Page 1 · 10 items · Newest first").
- **Team pages.** Teams became cards (lead's monogram in primary tint, role
  badge, per-team work link); the roster became a real table with role selects
  and coral remove actions, plus a "what leads can do" explainer that states the
  server's actual rules.
- **States.** Loading is now skeletons that mirror the final layout (dashboard
  tiles, table rows) instead of a centred sentence; empty states use a dashed
  frame so they read as "nothing here", not "something broke".

### Bug found by the browser suite during this pass

`Button` inherited the HTML default `type="submit"`. The new "Cancel edit"
control sits inside the edit `<form>`, so cancelling silently **saved the item**
(and the immediately following transition click was swallowed by the in-flight
request). The primitive now defaults to `type="button"`; only the six controls
that must submit say so explicitly. Caught by the interaction suite, not by
reading the code.

## 19. Colour pass: warm neutrals + forest green

A palette-only change; no layout, component, or business logic moved. The token
architecture from §17 was kept (`:root` → `@theme inline` → utilities) and
re-pointed, so there is still exactly one colour system.

**Hue names were renamed, not just re-valued.** The old vocabulary
(`--slate/--blue/--violet/--teal/--amber/--coral`) described colours, which is
exactly the wrong axis once the art direction changes: keeping `--violet` and
pointing it at ochre would have made the token name a lie. They became
`--status-{open,progress,review,done,cancelled}` (+ `-surface` tints) and
`--priority-{low,medium,high,urgent}`, which encode meaning instead of hue. One
mapping table in `kit.tsx` and one in the dashboard drive every usage, so a
status can never drift between the badge, the table, the stepper, and the
timeline.

**Three values were darkened, deliberately.** The supplied palette failed WCAG
AA (4.5:1) for the small text it is used at, so:
`muted-foreground #777B74` (3.99:1) → `#6A6E67` (4.81:1);
`REVIEW #936A28` (4.19:1) → `#8B6324` (4.64:1);
`warning #B78132` (3.39:1) → `#9E6820` (4.71:1).
Hues are unchanged; only lightness moved.

**Two semantic corrections the palette exposed:**

- The workflow stepper was colouring "current step" with the IN PROGRESS hue, so
  a DONE item highlighted itself in "in progress" blue. It now uses forest
  (`--primary`), which the art direction reserves for selected states — the step
  marks where you are, not which status the item holds.
- Field-update events in the timeline were tinted with a hue of their own; they
  are now neutral, leaving colour for state and for the two events that mean
  something (created, transitioned).

**Hardcoded colours:** the only remaining raw hex values in the app are the four
avatar swatches in `ui/avatar.tsx` — a per-person identity palette, deliberately
outside the token system and drawn from the same warm/forest family (all ≥4.88:1
against white initials). Everything else routes through tokens.
