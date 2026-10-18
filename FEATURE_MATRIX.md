# OpsFlow — Feature Matrix (backend ↔ frontend audit)

**Date:** 2026-10-18 · **Scope:** every Prisma model, API route, service module,
page, component, and test in the repository. Baseline verified before changes:
`npm run lint` clean · `npx tsc --noEmit` clean · 21/21 unit · 37/37 integration
(real PostgreSQL) · `npm run build` OK · live HTTP probes against `next dev`.

Legend — **BE** backend/API · **FE** frontend UI · **API** wiring · **E2E** end-to-end
automated coverage · P0 blocks a required workflow, P1 breaks one, P2 incomplete,
P3 polish/documentation.

---

## 1. Inventory — every backend capability that exists

| # | Capability | Endpoint / module | Tests |
|---|---|---|---|
| 1 | Login (scrypt, rate-limited, timing-parity) | `POST /api/auth/login` → `lib/auth.ts` | integration |
| 2 | Session read / destroy | `GET·DELETE /api/auth/session` | integration |
| 3 | User directory (assignee picker) | `GET /api/users` | none (trivial) |
| 4 | List teams (member-scoped; ADMIN sees all) | `GET /api/teams` | integration |
| 5 | Create team (creator becomes LEAD) | `POST /api/teams` | integration |
| 6 | Team detail + roster + item count | `GET /api/teams/:id` | integration |
| 7 | Add member / change role (upsert) | `POST /api/teams/:id/members` | integration |
| 8 | Remove member (last-LEAD guard) | `DELETE /api/teams/:id/members/:userId` | integration |
| 9 | Delete team (409 `TEAM_IN_USE` when items exist) | `DELETE /api/teams/:id` | integration |
| 10 | List work items (status/priority/q/assignee/creator/team/limit/cursor) | `GET /api/work-items` | integration |
| 11 | Status statistics (`GROUP BY`) | `GET /api/work-items/stats` | integration |
| 12 | Create item (idempotent, assignee/team eligibility) | `POST /api/work-items` | integration |
| 13 | Read item (404 for invisible, never 403) | `GET /api/work-items/:id` | integration |
| 14 | Update fields (optimistic concurrency, version) | `PATCH /api/work-items/:id` | integration |
| 15 | Workflow transition (legal edges + assignee precondition) | `POST /api/work-items/:id/transitions` | unit + integration |
| 16 | Activity history (newest-first, 100 cap) | `GET /api/work-items/:id/activity` | integration |
| 17 | Pure policy (canRead/canMutate) | `modules/work-items/authz.ts` | unit |
| 18 | Pure workflow (transition table) | `modules/work-items/workflow.ts` | unit |

No delete endpoint exists for work items, no rename endpoint for teams, and no
user-management endpoints. Those are **absent by design or out of scope** (history
and `ON DELETE RESTRICT` assume immutable items), so they are **N/A, not gaps** —
and no frontend control is invented for them.

---

## 2. Feature matrix

| Feature | BE | FE | API wiring | E2E test | Missing work | Pri |
|---|---|---|---|---|---|---|
| Login / logout / session | ✅ | ✅ login page, shell menu | ✅ | live probe only | none | — |
| Login rate-limit (429) surfaced | ✅ | ✅ generic error banner | ✅ | integration (backend) | none | — |
| User directory | ✅ | ✅ 3 pages | ✅ | — | none | — |
| **Team list** | ✅ | ❌ no page, no nav entry | ❌ | integration (backend only) | `/teams` page | **P0** |
| **Create team** | ✅ | ❌ | ❌ | integration (backend only) | create form + `POST` wiring | **P0** |
| **Team detail + roster** | ✅ | ❌ (`GET /:id` unused by any page) | ❌ | integration (backend only) | `/teams/[id]` page | **P0** |
| **Add member** | ✅ | ❌ | ❌ | integration (backend only) | member picker | **P0** |
| **Change member role** | ✅ | ❌ | ❌ | integration (backend only) | role select | **P0** |
| **Remove member** | ✅ | ❌ | ❌ | integration (backend only) | remove control + last-lead error | **P0** |
| Delete team | ✅ | ❌ | ❌ | integration (backend only) | confirm dialog + 409 `TEAM_IN_USE` | P1 |
| Rename team | ❌ | ❌ | — | — | N/A — API does not exist | P3 (doc) |
| Create work item | ✅ | ✅ `/work-items/new` | ✅ idempotency key wired | live probe | none | — |
| Item detail | ✅ | ✅ | ✅ | live probe | none | — |
| Edit title/description/assignee/team/priority | ✅ | ⚠️ controls **hidden from team LEADs** | ✅ | integration (backend) | fix `canMutate` to use `authz.canMutate` | **P1** |
| Assign / reassign | ✅ | ⚠️ picker lists **all** users; server 400s on non-members | ✅ | integration (backend) | restrict options to team roster | P2 |
| Workflow transitions | ✅ | ⚠️ UI **duplicates** the transition table | ✅ | unit + integration | import `allowedTransitions` instead | P2 |
| Activity history | ✅ | ✅ timeline | ✅ | integration | none | — |
| Search `q` | ✅ | ✅ | ✅ | integration | none | — |
| Filters: status / priority / assignee / team | ✅ | ✅ | ✅ | integration | none | — |
| Filter: **creatorId** | ✅ | ❌ no control, and `my-work` "View all" drops the filter | ❌ | integration | creator filter + deep link | P2 |
| Pagination (cursor prev/next) | ✅ | ✅ | ✅ | integration | none | — |
| Deep links (`?status`, `?assignee`) | ✅ | ⚠️ URL-sync effect **clobbers** every other param | partial | — | sync the whole filter set | P2 |
| Dashboard stats + attention sections | ✅ | ✅ | ✅ | integration | none | — |
| My Work (assigned / created) | ✅ | ✅ | ✅ | integration | creator deep link (above) | P2 |
| Team-scoped work view | ✅ | ❌ unreachable from UI | ❌ | integration | link to `/work-items?teamId=` | P1 |
| Global ADMIN bypass | ✅ | ✅ "· Admin" label | ✅ | integration | manage controls must honour ADMIN (fixed with teams page) | P1 |
| 404-vs-403 handling | ✅ | ✅ fatal-vs-retry split | ✅ | integration | none | — |
| 409 version-conflict UX | ✅ | ✅ banner + reload | ✅ | integration | none | — |
| Loading / empty / error states | ✅ | ✅ on existing pages | ✅ | — | same on new team pages | P2 |
| Responsive layout | n/a | ✅ mobile drawer + fluid grids | — | manual | none | — |
| Accessibility | n/a | ✅ labels/`sr-only`/`role=alert`/focus-visible | — | manual | labelled controls on new pages | P2 |
| Work-item delete | ❌ | ❌ (correctly absent) | — | — | N/A | — |
| E2E browser suite | n/a | ❌ none (documented) | — | ❌ | Playwright | P3 |
| Component tests | n/a | ❌ none | — | ❌ | no DOM test runner installed | P3 |

### Confirmed root causes (not symptoms)

1. **Teams are a whole missing vertical slice of UI.** All five team endpoints
   existed and were integration-tested, yet `GET /api/teams` was consumed only as a
   dropdown filler in three pages. `ApiTeamDetail` was declared in `lib/client.ts`
   and never imported — the type was written for a page that was never built.
2. **`canMutate` was re-implemented (wrongly) in the client.** The detail page
   computed `ADMIN || creator || assignee` from scratch and dropped the
   `team LEAD` case, so a lead who is neither creator nor assignee saw no edit or
   workflow controls on items the API happily accepts (proved live: `PATCH` by a
   LEAD returns 200 for an item created by someone else). The correct predicate
   already existed and is unit-tested in `modules/work-items/authz.ts`.
3. **The transition table was duplicated** as a literal in the detail page, a
   second source of truth that could drift from `workflow.ts`.
4. **`my-work`'s "Created by me → View all"** linked to an unfiltered list even
   though the creator filter exists in the API.
5. **The URL-sync effect rewrote the query string to status-only**, dropping
   `assignee`/`teamId`/`priority` on mount — deep links silently degraded.

---

## 3. Workflow walkthrough (as required, against the real rules)

| Workflow | Before | After this change |
|---|---|---|
| Create a team | ❌ impossible in UI (API only) | ✅ `/teams` → creator becomes LEAD |
| Add members, assign roles | ❌ impossible in UI | ✅ roster add / role select / remove (LEAD or ADMIN), last-LEAD error surfaced |
| Create work in a team | ⚠️ only via dropdown; nothing to create the team | ✅ create form, team picker limited to own teams |
| Assign to eligible members | ⚠️ only via trial and error | ✅ picker restricted to the team's roster |
| Reassign | ✅ (creator/assignee only — LEAD was locked out) | ✅ LEAD included via shared policy |
| Change priority | ✅ | ✅ unchanged |
| Move through workflow states | ✅ | ✅ table sourced from `workflow.ts` |
| Review activity history | ✅ | ✅ unchanged |
| Filter / find work | ⚠️ no creator filter, deep links clobbered | ✅ creator filter, all filters deep-linkable |
| See only what your role allows | ✅ server-side; ⚠️ UI hid LEAD powers | ✅ UI now mirrors `authz.canMutate` exactly |

## 4. Fix plan (implemented)

- `src/app/teams/page.tsx` — list + create (`GET/POST /api/teams`).
- `src/app/teams/[id]/page.tsx` — roster, add/remove member, role change, delete
  team, link to team-scoped work (`GET /api/teams/:id`,
  `POST/DELETE …/members`, `DELETE /api/teams/:id`).
- `src/components/shell.tsx` — Teams nav entry + page titles.
- `src/app/work-items/[id]/page.tsx` — `canMutate` from `authz.ts`, transitions
  from `workflow.ts`, roster-restricted assignee picker.
- `src/app/work-items/new/page.tsx` — roster-restricted assignee picker.
- `src/app/work-items/page.tsx` — creator filter, full filter deep-linking,
  non-clobbering URL sync via `src/lib/filters.ts` (pure, unit-tested).
- `src/app/my-work/page.tsx` — creator deep link.
---

## 5. Verification actually performed

| Check | Result |
|---|---|
| `npm run lint` | clean (0 errors, 0 warnings) |
| `npx tsc --noEmit` | clean (strict) |
| `npm run test:unit` | **25/25** (was 21 — added `filters.test.ts`, 4 cases) |
| `npm run test:integration` (real PostgreSQL, isolated test DB) | **37/37** |
| `npm run build` | OK — `/teams` and `/teams/[id]` prerender (◐) |
| Browser: 41 workflow checks in headless Chrome over CDP | **41/41 passed** |
| Browser: 15 create/list/dashboard/login checks | **15/15 passed** |
| Browser: 22 state + accessibility checks (validation, 409 conflict, dialog focus/Escape, menu, sheet, logout) | **22/22 passed** |
| Screenshot review of all 10 routes, desktop + mobile | 2 visual regressions found and fixed (see below) |

Browser checks covered, as a real signed-in user: create team → creator is lead
→ add member → member sees a read-only roster (no add/role/remove/delete
controls) → promote to lead → member creates a team item → **lead sees workflow
actions and the editor on an item they neither created nor own (previously
hidden)** → lead edits title + priority → version bumps to 2 → `FIELD_UPDATED`
event records the diff → assignee picker lists only roster members → transition
OPEN → IN_PROGRESS → REVIEW → team-scoped list deep link keeps `teamId` in the
URL → creator and assignee deep links → delete blocked with 409 while the team
holds items → member removal → removed member gets the 404 team view → re-add →
last-lead removal returns 400 → empty team deleted → unauthenticated visit
redirects to `/login`.

Harness: headless Chrome + DevTools Protocol driven by Node's built-in
`WebSocket` (throwaway script under `/tmp`, **no dependency added** — Playwright
stays rejected per `ENGINEERING_DECISIONS.md` §10). Each user ran in a separate
browser context so the two sessions could not share cookies.

### Re-verified after the composition redesign

All three suites were re-run against the rebuilt UI (78 browser checks total) and
still pass, which is how the three defects below were caught:

- `ConfirmDialog` on Radix `AlertDialogAction` closed before showing the 409
  `TEAM_IN_USE` message → replaced with caller-owned open state.
- `refresh()` wiped the stale-write conflict banner in the same render batch →
  the banner now shows and the newest row loads underneath it.
- A base `h1–h4 { text-foreground }` rule I introduced made the login panel's
  headline invisible on its dark surface → caught in a screenshot, rule removed.
- Initial focus never entered the dialog or the mobile sheet → both now focus a
  sensible first control (Cancel / drawer close).
- `Button` inherited the HTML default `type="submit"`, so the new "Cancel edit"
  control inside the edit form silently saved the item (and the next transition
  click was swallowed by the in-flight request). The primitive now defaults to
  `type="button"`; the six real submit controls declare it explicitly.

### Not verified

- No committed e2e/component suite exists; the 41 checks are repeatable but live
  in `/tmp`, not the repo. Installing Playwright/Testing-Library is a dependency
  decision, left to you.
- Time-based paths remain unexercised (24h idempotency replay TTL, 5-minute
  pending fuse) — pre-existing, unrelated to this change.
- Safari/Firefox rendering, and screen-reader output; only DOM semantics and
  keyboard focus order were reasoned about.

### Notes found but deliberately not changed

- `prisma/seed.ts` only creates sample items when the table is empty, so a
  database seeded before the teams migration keeps its items teamless. Harmless;
  drop the rows and re-seed to get team-scoped samples.
- Team rename and work-item deletion have no endpoints, so no control exists for
  them (by design — see §1).
