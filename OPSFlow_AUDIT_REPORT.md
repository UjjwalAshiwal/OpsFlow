# OpsFlow — Audit Report (superseded)

> **Superseded (2026-10-18).** This report predates the teams/priority phase, so
> its "no teams model" / "no priority field" rows (§7) are stale. The current
> feature-by-feature status lives in [`FEATURE_MATRIX.md`](FEATURE_MATRIX.md).
> Kept for history; do not cite it as current state.

**Date:** 2026-10-16 · **Scope:** full codebase, runtime, and defect audit of the
Newtonite Software Engineering Challenge submission · **Mode:** audit only — no
application code was modified, no database was reset, no secrets are included.

**Verdict: functional with minor defects.** The application starts, all core flows
work as documented, and the risky guarantees (concurrency, transactions,
idempotency, authorization) are enforced by the implementation and proven by tests
plus live verification. One P1 (dashboard counts silently cap at 100 items), no P0.
Remaining items are P2/P3 and explicitly untested areas (real browser interaction,
production serving, time-based expiry paths).

The original Newtonite challenge brief was **not found** anywhere in the workspace
(searched the workspace, max depth 2, for `*brief*`/`*challenge*`/`*newtonite*` —
only OpsFlow's own docs matched). All "requirements" below are therefore the
provisional baseline documented in `README.md` / `ENGINEERING_DECISIONS.md`, plus the
audit brief's §7 areas. Nothing in this report invents challenge requirements.

---

## 1. Executive Summary

- **Starts and runs:** yes. Dev server on `:3000` against PostgreSQL 16 (Docker,
  healthy). Production build succeeds; all API routes dynamic, all pages prerender.
- **Core flows verified live (HTTP + direct DB reads):** login/logout, session
  enforcement, create → update → transition, invalid-transition rejection with
  byte-identical DB state after failure, stale-write 409, idempotent replay
  (200 + `Idempotent-Replayed`), key-reuse 409, 3-way same-key race → exactly 1 row,
  outsider 403, unauthenticated 401, search/filter/pagination, malformed-cursor 400.
- **Automated:** ESLint clean, `tsc` clean, **11/11 unit**, **17/17 integration**
  (real PostgreSQL) pass.
- **Security:** passwords scrypt-hashed, tokens random with only hashes persisted,
  authn on every protected route, identity server-derived, no disclosure or
  injection issues found. Two hardening gaps (login timing oracle, no rate limiting)
  and two dead-config/comment inaccuracies — all Low/Medium, none Critical.
- **Data consistency:** every claimed guarantee maps to enforcing code and a test
  (see §6). No guarantee in the docs was found unenforced, except time-based expiry
  paths which are code-reviewed but not empirically exercised (marked UNVERIFIED).

## 2. Environment and Setup

| Item | Finding |
|---|---|
| Project root | repository root — app files directly at root; **no nested `newtonite-challenge/`** (confirmed absent) |
| Structure | `package.json`, `prisma/` (schema + 1 migration + seed + prune), `public/`, `src/` (app/api/pages, components, lib, modules, test), `docker-compose.yml`, `.env.example`, `README.md`, `ENGINEERING_DECISIONS.md`, configs. No top-level `tests/` dir (tests live in `src/test/`) — cosmetic deviation from the brief's sketch only |
| Node / npm / Docker | v26.8.2 / 11.19.1 / 29.8.0 — no `psql` CLI; DB accessed via `docker exec` |
| PostgreSQL | `postgres:16-alpine`, container `newtonite-postgres`, **healthy**; dev DB `newtonite`, isolated test DB `newtonite_test` |
| Env vars (names only) | `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET` — `.env` present, git-ignored, dev placeholders only |
| Git | single repo, history preserved; `.env`, `.next/`, `tsconfig.tsbuildinfo` ignored; no secrets tracked |
| Startup | `npm run dev` serves `:3000`; a server from prior work was already running and was reused (no second instance started) |
| Deps | next 16.4.2, react 19, prisma 6.19.3 (pinned stable — v8 was RC at scaffold), zod 4, vitest 5, tsx 4. No unused runtime deps. `prisma` package ships in `dependencies` (needed for `migrate deploy` in prod images — intentional, not a defect) |

## 3. Verification Results

| # | Command (from `OpsFlow/`) | Result | Notes |
|---|---|---|---|
| 1 | `npm run lint` | **PASS** (exit 0) | no warnings |
| 2 | `npx tsc --noEmit` | **PASS** (exit 0) | strict mode on |
| 3 | `npm run test:unit` | **PASS 11/11** | workflow matrix, authz, cursor |
| 4 | `DATABASE_URL=<test-db> npx prisma db push` | **PASS** | "already in sync" |
| 5 | `DATABASE_URL=<test-db> npm run test:integration` | **PASS 17/17** (1.6s) | real PostgreSQL: races, rollback, idempotency, authz, pagination |
| 6 | `npm test` (no env override) | **FAILS integration file by design** | guard refuses dev DB (`Refusing to run integration tests against a non-test database`); 11 unit pass, 17 skip, **zero rows touched** (throws in `beforeAll`). Fail-safe, but default command is red — see D-06 |
| 7 | `npm run build` | **PASS** (exit 0) | 8 API routes ƒ dynamic, 5 pages ◐ partial-prerender |
| 8 | Fresh-DB `prisma migrate deploy` | **PASS** (verified during build phase on disposable `newtonite_verify`, then dropped) | all 5 tables + enums + FKs + indexes created from migration alone |
| 9 | Live HTTP+DB flow suite (Phase 6) | **PASS all** | details in §4; audit rows created and **fully cleaned up** afterward (seed rows confirmed intact: 3 users, 2 items) |

## 4. Functional Audit

| Feature | Status | Evidence |
|---|---|---|
| Login / logout / session | Works | invalid 401, valid 200, `nt_session` httpOnly set, DELETE 200 → subsequent API 401; login `<form>` + password field present in prerendered HTML |
| Protected pages | Works (shell-level) | dashboard + login shells 200; unauthenticated client redirect via `useRequireAuth` (code-read; no browser to observe the redirect — UNVERIFIED visually) |
| Dashboard | Works with limits | status cards link to filtered list; counts + "recent" list render. **Defects D-01, D-02** |
| List: search / filter / pagination | Works | `q`, `status`, cursor traversal verified live; invalid cursor 400; deterministic order + no-dup traversal proven by integration test |
| Create (with idempotency key) | Works | 201 + row + CREATED event in DB; replay 200 same id; reuse 409; 3-way race → 1 row |
| Edit (PATCH + version) | Works | 200 bumps version; stale 409; no-change PATCH returns current without new event |
| Transitions | Works | happy path OPEN→IN_PROGRESS→REVIEW→DONE (integration); illegal 422; precondition 422; zero-row update → 409, never success |
| Activity history | Works | CREATED/STATE_CHANGED newest-first with actor + diff, verified via API and DB; capped at 100 (documented) |
| Failed mutations | Leave no trace | post-422 row identical (title/status/version/event count re-read from DB) |
| 404 vs 403 policy | Works as documented | missing id → 404; outsider mutation → 403; reads open to authenticated (no hidden items, so no masking needed) |
| Validation | Works | empty title → 400 `VALIDATION_ERROR` with field errors; bad enum/limit/key → 400 |
| Error shape | Consistent | every error `{error:{code,message(,details)}}`; 500 path logs server-side, returns generic message |

## 5. Security and Authorization Findings

Confirmed (by code + live probes, non-destructive):
- **Passwords:** scrypt + 16-byte salt, `timingSafeEqual` compare (`src/lib/password.ts`). Never plaintext. PASS.
- **Tokens:** 32 random bytes; only `sha256("session:"+token)` persisted (`src/lib/auth.ts`). PASS.
- **Cookies:** `httpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, 7-day absolute expiry. PASS (dev `Secure=false` is correct for http).
- **Authn enforcement:** all 8 route handlers call `getSessionUser()` first; live 401s on every unauthenticated probe. PASS.
- **Actor identity:** always from session; no endpoint accepts an actor/user id from the client (verified by reading all routes + service signatures). No privilege-escalation parameter exists (`role` never writable). PASS.
- **Authz:** outsider PATCH/TRANSITION → 403 live; policy unit-tested. PASS.
- **Disclosure:** error responses carry codes/messages only; Zod details are field messages, no input echo of secrets; no stack/SQL leakage. PASS. XSS: no `dangerouslySetInnerHTML`; React escaping throughout. PASS.
- **D-03 (Low): login timing oracle.** `login/route.ts:13` returns before `verifyPassword` when the email is unknown, contradicting its own "no account enumeration" comment — unknown vs known users differ by ~50ms (one scrypt). Impact: email-oracle via timing. Fix: always run `verifyPassword` against a dummy hash for unknown users; test: assert response-time parity or at least code-path equality.
- **D-10 (Medium, already documented): no login rate limiting.** `POST /api/auth/login` allows unlimited attempts; scrypt cost (~50ms) only mildly slows online brute force. Impact bounded for a local challenge app; README already flags it pre-exposure. Fix: attempt counter/backoff per IP/email (or put behind platform rate limiting); test: N rapid failures → 429.
- Hypothetical only (not defects): login CSRF (no security impact here — attacker can't extract the session), session theft via XSS (no injection vector found), DB-write tampering with history (explicitly disclaimed in docs).

## 6. Database and Consistency Findings

- **Schema/migration:** enums, PKs, `User.email` + `(scope,key)` uniques, FKs (`Restrict` creator, `SetNull` assignee/actor, `Cascade` sessions/history) and all claimed indexes verified byte-for-byte in `migration.sql`. Fresh-DB deploy proven. Minor: `User_email_idx` duplicates the unique index (harmless).
- **Concurrency:** version (+expected state for transitions) inside `updateMany` WHERE; `count===0` → 409, verified live and by racing integration test (exactly 1 winner + 1 event). No silent retry anywhere.
- **Transactions:** create/update/transition bundle business write + event (+claim completion) in one `$transaction`; rollback proven by FK-violation test asserting row unchanged; failed conditional throws *before* event insert (code order + no-event-on-failure test).
- **Idempotency:** claim-then-complete with committed-row reads (loser path uses a separate transaction — no poisoned-txn issue); replay/reuse/in-progress/rollback-cleanup all have dedicated passing tests; 3-way HTTP race confirmed 201+200+409 with 1 row. Claim `create` auto-commits outside the business txn, so P2002 always implies a committed row (no infinite-reap loop in practice).
- **Expiry paths UNVERIFIED empirically:** 5-min PENDING fuse, 24h COMPLETED TTL, `pruneExpiredIdempotencyKeys` — logic reviewed, read-path enforcement confirmed by code, but no test advances the clock. Low risk; recommend a clock-injection or short-TTL test (see §9).
- Seed is idempotent (upserts, `count===0` gate); safe to re-run.

## 7. Newtonite Requirements Matrix

(Brief absent — mapped to the audit brief's §7 areas against the provisional baseline.)

| Requirement | Status | Evidence |
|---|---|---|
| Operational work-item management (create/read/update/transition) | **PASS** | live + integration coverage; no delete endpoint (provisional, documented) |
| Meaningful state | **PASS** | 5-state workflow, full matrix unit-tested |
| Importance/priority | **PARTIAL** | no priority/importance field exists in the baseline; confirm whether the brief needs one |
| Responsibility & assignment | **PASS** | assignee, directory, IN_PROGRESS precondition, all enforced server-side |
| Collaboration & activity history | **PASS** | domain events with actor + diffs, transactional; no comments/notifications (provisional) |
| Multiple teams / responsibilities | **PARTIAL** | USER/ADMIN + creator/assignee policy only; no teams model |
| Backend-enforced authorization | **PASS** | §5 |
| Simultaneous operations | **PASS** | racing updates + racing creates tested live and in suite |
| Stale info & retries | **PASS** | 409 + refresh UX + replay-safe retries |
| Dashboard & attention | **PARTIAL** | works but D-01 (100-item cap) + D-02 (mislabel); no triage beyond status counts |
| DB-backed search & filtering | **PASS** | Prisma-side, tested |
| Pagination & growth | **PASS** | API proven; UI page-size 10 with cursor stack |
| Meaningful error handling | **PASS** | consistent codes; conflict UX with reload path |
| Automated tests for risky behavior | **PASS** | 28 tests, real PG, no mocks for guarantees |
| Engineering decisions | **PASS** | accurate except D-05 comment and unmentioned D-04 |
| Reproducible setup | **PASS** | quickstart + fresh-DB + test-DB paths all executed verbatim |
| Known limitations | **PASS** | documented; this report extends the list |

## 8. Defect Register

- **D-01 · Medium · `src/app/page.tsx`.** Dashboard fetches `limit=100` and counts client-side, so with >100 items the status cards undercount **silently**. Repro: seed 101+ items → card totals ≠ DB counts. Expected: true totals. Impact: primary view misleads at scale. Fix: `GET /api/work-items/stats` returning `GROUP BY status` counts; test: seed 120 items, assert card/API totals match DB.
- **D-02 · Low · `src/app/page.tsx`.** "Recently updated" is sorted by `createdAt`, not `updatedAt`. Repro: edit an old item → it doesn't surface. Fix with D-01 (order by `updatedAt`, or relabel "Recently created"). Test: assert first card equals max-`updatedAt` row.
- **D-03 · Low · `src/app/api/auth/login/route.ts:13`.** Timing oracle contradicts the anti-enumeration comment (see §5). Fix: dummy `verifyPassword` on unknown email. Test: both paths invoke scrypt (spy) / parity timing.
- **D-04 · Low · `.env.example`.** `SESSION_SECRET` documented but never read (sessions are opaque, unsigned). Fix: delete the entry or implement cookie signing. Test: grep/lint for unused env or signed-cookie round-trip.
- **D-05 · Low · `src/lib/auth.ts:8`.** "7 days, sliding" — expiry is absolute; nothing renews on use. Fix: correct the comment (or implement sliding renewal). Test: comment-only (or session-expiry test if behavior added).
- **D-06 · Low · `src/test/integration/work-items.test.ts:26` + README.** Bare `npm test` fails (guard refuses dev DB). Fail-safe and data-safe, but the default command is red. Fix: `describe.skipIf(!isTestDb)` + README note, keeping the refuse-to-wipe behavior. Test: `npm test` green without `DATABASE_URL` override.
- **D-07 · Low · `src/app/work-items/page.tsx:17`.** Status filter seeded from URL once; same-route navigation to another `?status=` leaves a stale filter under a changed URL. Repro: link-navigate between two `?status=` URLs without remount. Fix: sync state from `searchParams` via effect. Test: component test asserting filter follows URL.
- **D-08 · Low · various.** Dead weight: `<FieldError />` rendered messageless (login/new/detail forms), `allowedTransitions`/`isTerminal` unused by app code, redundant `User_email_idx`. Fix: remove. Test: none (lint-level).
- **D-09 · Low · `src/app/login/page.tsx`.** Authenticated visit shows the login form instead of redirecting. Fix: reuse `useRequireAuth`-style check → redirect `/`. Test: render-as-logged-in asserts redirect.
- **D-10 · Medium · `src/app/api/auth/login/route.ts`.** No rate limiting (see §5). Already flagged in README pre-exposure. Fix + test per §5.

## 9. Prioritized Fix Plan

- **P0 — none.** No start-up failure, no severe security hole, no integrity violation found. This is stated positively: every P0-class check passed.
- **P1 — D-01 (dashboard totals).** Reasoning: the only defect that makes a primary view *silently wrong*; small fix (one aggregation endpoint + test). D-02 rides along.
- **P2 — D-03 (timing oracle), D-10 (rate limiting), D-06 (`npm test` default).** Reasoning: real but bounded security hardening (D-03/D-10) and contributor-facing correctness of the default command (D-06); none blocks submission.
- **P3 — D-02 if split out, D-04, D-05, D-07, D-08, D-09.** Reasoning: polish, comments, latent UI edge cases; fix opportunistically.
- **Verification debt (not defects):** clock-based expiry test, `npm start` production smoke test, real-browser pass (login → create → transition → conflict), admin-path live exercise. These need no code changes to begin, except whatever harness is chosen for browser testing.

## 10. Known Limitations

- Real-browser interaction **not tested** (no Playwright/bidirectional browser tooling in this environment; verification is HTTP + HTML-shell + DB level).
- Time-based paths (session expiry, idempotency TTL/fuse, prune) code-reviewed only.
- Production serving (`npm start`) smoke-tested only via build, not via running server.
- Admin-role flows covered by unit policy tests, not exercised live end-to-end.
- Single-database deployment assumption; no rate limiting, no API pagination totals (by design), activity feed capped at 100 (documented).

## 11. Recommended Next Steps

1. Fix D-01 (+D-02) with a `stats` endpoint and tests — the single highest-value change.
2. Fix D-03 dummy-verify and D-05/D-04 doc/config cleanup (minutes each).
3. Add D-10 rate limiting only if the app will be network-exposed before submission; otherwise leave documented.
4. Add expiry tests (injectable clock or short TTL) and a `npm start` smoke check.
5. Do one manual browser pass of login → dashboard → list/search/paginate → new → detail/edit/transition/conflict → logout.
6. Re-run `lint`, `tsc`, `test:unit`, `test:integration`, `build` and attach outputs to the submission.
