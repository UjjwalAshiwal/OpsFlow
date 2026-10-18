# OpsFlow — capability and coverage matrix

Current state of the repository, not a change log (see `git log` for history).

**Verified on the refactor branch:** `npm run lint` clean · `npx tsc --noEmit`
clean · **42/42 unit** · **62/62 integration** against real PostgreSQL ·
`npm run build` OK.

No e2e or component suite is committed. Rows marked *manual* were exercised by
hand and are **not** reproducible from a clean checkout.

## 1. Backend capabilities

| # | Capability | Endpoint / module | Automated coverage |
|---|---|---|---|
| 1 | Login (scrypt, rate-limited, timing-parity) | `POST /api/auth/login` → `lib/auth.ts` | integration + unit |
| 2 | Registration (no role/membership minted) | `POST /api/auth/register` | integration |
| 3 | Demo workspace sign-in (one fixed identity, never ADMIN) | `POST /api/auth/demo-login` | integration (boundary), *manual* (live) |
| 4 | Session read / destroy | `GET·DELETE /api/auth/session` | integration |
| 5 | Client address for rate-limit keys | `lib/auth.ts` `clientKey` | unit (spoofing, edge headers) |
| 6 | User directory (assignee picker) | `GET /api/users` | none (trivial read) |
| 7 | List teams (member-scoped; ADMIN sees all) | `GET /api/teams` | integration |
| 8 | Create team (creator becomes LEAD) | `POST /api/teams` | integration |
| 9 | Team detail + roster + item count | `GET /api/teams/:id` | integration |
| 10 | Add member / change role (upsert) | `POST /api/teams/:id/members` | integration |
| 11 | Remove member (last-LEAD guard) | `DELETE /api/teams/:id/members/:userId` | integration |
| 12 | Delete team (409 `TEAM_IN_USE` when items exist) | `DELETE /api/teams/:id` | integration |
| 13 | List work items (status/priority/q/assignee/creator/team/limit/cursor) | `GET /api/work-items` | integration |
| 14 | Status statistics (`GROUP BY`) | `GET /api/work-items/stats` | integration |
| 15 | Create item (idempotent, assignee/team eligibility) | `POST /api/work-items` | integration |
| 16 | Read item (404 for invisible, never 403) | `GET /api/work-items/:id` | integration |
| 17 | Update fields (optimistic concurrency, version) | `PATCH /api/work-items/:id` | integration |
| 18 | Workflow transition (legal edges + assignee precondition) | `POST /api/work-items/:id/transitions` | unit + integration |
| 19 | Activity history (newest-first, 100 cap) | `GET /api/work-items/:id/activity` | integration |
| 20 | Pure policy (canRead/canMutate) | `modules/work-items/authz.ts` | unit |
| 21 | Pure workflow (transition table, constants) | `modules/work-items/workflow.ts` | unit |
| 22 | Demo dataset reconciliation | `prisma/demo-seed.ts` | integration (mirrors logic) |
| 23 | Expired idempotency record cleanup | `prisma/prune.ts` | none (single query) |

**Absent by design**, with no frontend control invented for them: work-item
delete, team rename, user management. History and `ON DELETE RESTRICT` assume
items are immutable.

## 2. Frontend coverage

Every endpoint in §1 except #6-only-as-dropdown has a UI path.

| Feature | UI | Automated coverage | Notes |
|---|---|---|---|
| Login / register / demo entry | login, register, shell menu | integration (backend) | UI *manual* |
| Logout | account menu | *manual* | |
| Dashboard stats + attention sections | `/` | integration (backend) | |
| Work-item list (search, filters, cursor pagination) | `/work-items` | integration + unit (filters) | |
| Deep links for every filter | `/work-items?status&assignee&teamId&…` | unit | mapping is pure and tested |
| Create item | `/work-items/new` | integration (backend) | per-form idempotency key |
| Detail, edit, transitions, conflict banner | `/work-items/[id]` | integration (backend) | UI mirrors `canMutate` |
| Activity timeline | `/work-items/[id]` | integration (backend) | |
| My Work (assigned / created) | `/my-work` | integration (backend) | |
| Team list + create | `/teams` | integration (backend) | |
| Roster, role change, remove, delete team | `/teams/[id]` | integration (backend) | last-LEAD and 409 surfaced |
| Loading / empty / error states | all pages | *manual* | |
| Responsive layout | shell + grids | *manual* | |
| Accessibility (labels, `sr-only`, `role=alert`, focus rings) | all forms | *manual* | no conformance audit |

## 3. Not covered

- **No committed e2e or component suite.** Every UI row marked *manual* rests on
  a throwaway harness that lived outside the repository. Re-verifying those flows
  needs a browser suite (Playwright was rejected as a dependency decision; see
  `ENGINEERING_DECISIONS.md` §10).
- **Time-based idempotency paths** (the 24h replay TTL and the 5-minute pending
  fuse) are not exercised end to end.
- **`prisma/prune.ts`** is a single unconditional `deleteMany`, so it has no test
  beyond running it.
- **Safari/Firefox and screen-reader output** are unverified; only DOM semantics
  and keyboard focus order were reasoned about.
- **`prisma/seed.ts`** only creates sample items when the table is empty, so a
  database seeded before the teams migration keeps its items teamless. Harmless:
  drop the rows and re-seed.