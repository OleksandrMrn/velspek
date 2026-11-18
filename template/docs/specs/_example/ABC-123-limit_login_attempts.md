---
ticket: ABC-123
title: Limit failed login attempts
status: implemented      # draft | approved | implemented | rejected
approved_by: R. Reviewer
date: 2026-10-05
---

# ABC-123: Limit failed login attempts

> Example only: the project, its files, ADRs, tickets and people are fictional. A finished ticket: implemented in two sessions, with one fix after review.

## Why

Security review SEC-17: `POST /api/login` accepts any number of password attempts per account, and the auth logs show bursts of more than 2,000 failed attempts per hour against single accounts (dashboard "Auth / failed logins", 2026-09). After the change, attempts beyond a limit are rejected until the window passes, and the client is told when to retry.

## Scope

- In: the login endpoint in `src/auth/`, its config and error responses, the events in `src/analytics/`; staging and production.
- Out: password reset, two-factor login, limits per IP address (ABC-130).

## Requirements

- R1. Failed logins are counted per account in a sliding window; at `maxAttempts` every further attempt gets HTTP 429 before the password is checked. Check: with the defaults, ten wrong passwords return 401 and the eleventh attempt returns 429, also with the right password.
- R2. A 429 has `Retry-After`: the whole seconds, rounded up, until the oldest counted attempt leaves the window. Check: every 429 has `Retry-After` between 1 and 900.
- R3. A successful login clears the counter. Check: after a login, ten more wrong passwords return 401 again.
- R4. `maxAttempts` and `windowSeconds` come from the config key `auth.loginLimit` per environment, defaults 10 and 900. Check: with `maxAttempts: 3` on staging the fourth wrong password returns 429.
- R5. If the counter store is unavailable, the login proceeds without the limit and `auth.limit_unavailable` is logged (decided by R. Reviewer, 2026-10-04). Check: with the store stopped, the right password logs in and the event is logged.

## Constraints

- Contracts: config key `auth.loginLimit` in `config/staging.yaml` and `config/production.yaml`; `POST /api/login` gains 429 with `Retry-After` and the body `{"error": "too_many_attempts"}`; new events `auth.login_blocked` (`accountId`, `attempts`) and `auth.limit_unavailable` (`accountId`).
- ADRs: ADR-0004 "Redis holds all short-lived shared state": the counters are Redis keys `login_attempts:<accountId>`, not database rows.
- Preserve: existing sessions; below the limit the 401 response and the event `auth.login_failed` stay as they are, and the existing tests of `loginHandler` pass unchanged.
- Risk and recovery: a wrong limit locks users out. For an hour after the deploy watch the dashboard and the rate of 429; stop if an account below the limit gets 429 or the login error rate rises. Restore by redeploying release 4.12.0, which has no limit; `maxAttempts: 100000` in `config/production.yaml` is a stopgap while that deploy runs. Confirm: `GET /api/version` answers `4.12.0`, then eleven wrong passwords on a test account are all answered 401.

## Approach

- `src/auth/loginHandler.ts:41-78` checks the password and returns 401; nothing counts attempts. `src/server/routes.ts:22` is its only caller.
- `src/sessions/store.ts:30-44` keeps short-lived keys with a TTL on the shared client `src/cache/redisClient.ts:12`; the counter does the same.
- `src/config/schema.ts:55` rejects unknown keys, so `auth.loginLimit` needs a schema entry.
- Decision: a new module `src/auth/attemptCounter.ts` keeps a Redis sorted set of failed-attempt timestamps per account and returns the count and the seconds until the oldest expires; `loginHandler` asks it before checking the password. A fixed window with `INCR` and `EXPIRE` is simpler, but lets twice the limit through at a window boundary and cannot give an exact `Retry-After` (R1, R2).
- Compatibility layers: one, required by R5. When Redis does not answer, `attemptCounter` returns `unavailable` and `loginHandler` skips the limit. It lives only in `attemptCounter.ts` and has its own test.

## Tasks

### S1: the config key is read and the counter works on its own; the login endpoint is unchanged

- [x] T1 (R4): `auth.loginLimit` in the schema and both environments. Files: `src/config/schema.ts`, `config/staging.yaml`, `config/production.yaml`.
- [x] T2 (R1, R2, R5): `attemptCounter` with tests, including Redis not answering. Files: `src/auth/attemptCounter.ts`, `src/auth/__tests__/attemptCounter.test.ts`.
- Check: `npm test -- src/auth` passes; the key is in both config files; a test with a failing Redis client covers R5.
- Checked: R. Reviewer, 2026-10-08

### S2: the login endpoint applies the limit and sends the events

- [x] T3 (R1, R3): the counter in `loginHandler`, the 429 response, tests. Files: `src/auth/loginHandler.ts`, `src/auth/__tests__/loginHandler.test.ts`.
- [x] T4 (R1, R5): events `auth.login_blocked` and `auth.limit_unavailable`. Files: `src/analytics/events.ts`.
- Check: the checks of R1, R3 and R5 locally with the defaults; the check of R4 on staging.
- Checked: R. Reviewer, 2026-10-07

## Verification

- `npm run typecheck` and `npm run lint -- src/auth src/config src/analytics`: no errors; `npm test -- src/auth`: all pass.
- Manual: the checks of R1, R3 and R5 locally with the defaults; the check of R4 on staging with a test account.

## Log

- [2026-10-06] S1 (T1–T2): type check and lint passed; `npm test -- src/auth`: 14 passed. Not verified: a real Redis failover; only the test with a failing client covers R5.
- [2026-10-07] S2 (T3–T4): type check and lint passed; `npm test -- src/auth`: 24 passed. R4 on staging: the fourth wrong password returned 429 with `Retry-After: 897`; R1, R3 and R5 locally as expected. Out of scope: `src/auth/loginHandler.ts:90` logs the submitted e-mail address on 401; reported as ABC-131.
- [2026-10-08] fix after review (S1, T2): finding 1, `Retry-After` was rounded down and could be 0, against R2. `attemptCounter.ts` now rounds up, with a test for the last second of the window; `npm test -- src/auth`: 25 passed. S1 checked again by R. Reviewer on 2026-10-08.
