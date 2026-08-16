---
name: test-game-collection-tdd
description: Verify, autonomously repair, and optionally refresh production data for official subculture-game schedule collection with test-driven development. Use when checking whether Monster, Wuthering Waves, or Genshin sources are collected correctly; reproducing parser, discovery, author-filter, pagination, normalization, merge, renderer, or source-isolation defects; adding collector regression tests; or explicitly requesting current production schedules to be recollected and published.
---

# Test Game Collection with TDD

Prove collector behavior from official-source evidence, autonomously repair reproducible defects with a failing test and the smallest correction, and refresh production data when the user explicitly includes that external mutation in the task.

## Establish the baseline

1. Read `AGENTS.md`, `config/sources.json`, the affected collector code, and `test/collector.test.mjs`.
2. Inspect `git status` and preserve unrelated work.
3. Run `npm run test:collector` before editing. Record existing failures separately.
4. Inspect current `events.json` and `collection-status.json` only when the task concerns stored results; note event counts, source errors, and recent success timestamps.

## Choose the existing test layer

- Use `node:test` with `node:assert/strict` for `scripts/collector/*.mjs`. Prefer table-driven subtests, `test` name filtering, `t.mock.fn()`, and `t.mock.timers` before adding a dependency.
- Inject `fetch`, clocks, renderers, or file adapters into a testable boundary when practical. Prefer a deterministic fake function and captured official fixture over process-wide network interception.
- Use Jest with `@nestjs/testing` for NestJS providers, guards, controllers, validation, and storage behavior.
- Use Supertest inside the Jest e2e suite for public/import HTTP status, headers, authentication, filters, and response bodies without binding a fixed port.
- Do not mix Jest APIs into collector `.mjs` tests or move pure parser tests into the e2e suite.
- Consider an HTTP interception library only when the request layer itself must be tested and dependency injection cannot express redirects, retries, streamed bodies, or protocol errors. Before adding one, demonstrate the missing case with a test, check Node 22 ESM and native `fetch` support, and obtain user approval for the new dependency.

## Obtain trustworthy evidence

- Use only the configured official website, forum, lounge, or publisher API.
- Capture the smallest sanitized response fragment needed to exercise the defect. Keep fixtures deterministic and remove tokens, cookies, personal data, and volatile fields that are irrelevant to the assertion.
- Assert behavior, not a transient live count or today's specific posts. Keep live-network checks separate from deterministic tests.
- Preserve source safeguards: render Netmarble pages, require the configured Naver official author, and validate HoYoverse `retcode`, `data.list`, `iTotal`, and pagination.
- Stop and report when the expected result requires guessing a date, time, author, event type, or image-only schedule.

## Follow red-green-refactor

Continue through repair and verification without waiting for separate instructions when a defect is reproducible from official evidence and the required change stays within the requested collector scope. Fix collector code, source configuration, fixtures, tests, validation, retry bounds, and renderer error reporting as needed. Do not stop after listing remediations that can be safely implemented and tested locally.

### Red

1. Add the narrowest test to `test/collector.test.mjs`, or a focused fixture under `test/fixtures/` when inline HTML or JSON would obscure the case.
2. Cover the observable contract: discovery, official-host restriction, author verification, time extraction with timezone, classification, normalization, deduplication, history merge, pagination, or per-source failure isolation.
3. Run `node --test --test-name-pattern='<case>' test/collector.test.mjs` when practical, then `npm run test:collector`.
4. Confirm the new assertion fails for the intended reason before changing production code. If it passes, strengthen the reproduction rather than modifying code without evidence.

### Green

1. Apply the smallest production change that makes the failing test pass.
2. Do not weaken validation, broaden accepted authors or hosts, fabricate missing timestamps, or delete old history to obtain green tests.
3. Re-run the focused test and `npm run test:collector`.

### Refactor

1. Remove duplication only within the proven scope and keep the regression test unchanged.
2. Run `npm run typecheck` and `npm run build` when TypeScript, shared contracts, configuration, or application behavior changed.
3. Run `npm run test:e2e` when public filters, validation, import, or storage behavior changed.

### Recheck all sources

1. Run the complete relevant test suite after the focused test turns green.
2. Run `npm run collect:dry` for all configured sources, even when the defect affected only one game.
3. If a source fails, preserve successful source results and distinguish deterministic parser defects from bounded transient network, browser, or upstream failures.
4. Retry a transient live failure once under the same bounded configuration. If the retry succeeds, report the instability and improve retry or error diagnostics only when a deterministic test can prove the change.
5. Repeat red-green-refactor for each remaining reproducible defect. Stop only when all in-scope sources pass, an external dependency is genuinely unavailable, or official evidence is insufficient under repository policy.

## Check each supported source

- `monster`: verify rendered list/detail discovery and guard against empty rendered HTML being treated as success.
- `wuthering`: verify allowed Naver boards, `GM 연구소` author filtering, `YYYYMMDDHHmmss` conversion to Korea time, and document text extraction.
- `genshin`: verify response-shape validation, allowed official URLs, `iPage`/`iPageSize` traversal for backfill, and termination using `iTotal`.

For cross-source changes, add or retain at least one representative assertion per affected source. A source failure must remain visible without discarding successful results from other sources.

## Validate collection results

After deterministic tests pass, run `npm run collect:dry` when network access and runtime dependencies are available. Do not turn a dry run into a write. Check that:

- every produced event passes `validateEvents`;
- `id` and `sourceUrl` are unique and stable;
- timestamps are zoned and `endsAt` is not earlier than `startsAt`;
- `sourceTimeText` preserves official wording;
- existing history remains after merge;
- statuses are recalculated from the current instant;
- source errors are explicit and `eventCount` matches stored records when files are written by an explicitly authorized workflow.

Treat DNS, timeout, rate-limit, browser, and upstream failures as inconclusive until distinguished from parser defects. Use bounded retries only.

## Refresh operational data when authorized

Treat a task that explicitly asks to recollect, refresh, publish, or update operational data as authorization for the following data workflow. A verification-only or dry-run request is not production authorization.

1. Confirm `SCHEDULE_API_URL` and `INGEST_TOKEN` are available without printing their values. Stop without changing production when required credentials are absent.
2. Run `npm run api:pull` first, record the downloaded production event count, and read `${SCHEDULE_API_URL}/api/v1/collection-status` separately because pull downloads events only. Never collect from an empty local baseline when production history should exist.
3. Run `npm run collect:dry` and require every configured source to succeed. Compare source candidate and collected counts with the pulled baseline; investigate unexplained large drops before writing.
4. Run `npm run collect` only after the preview passes. Validate the generated events, unique IDs and URLs, zoned timestamps, ranges, statuses, source errors, history retention, and `eventCount` before publication.
5. Run the repository checks required by the code or data changes. Do not publish while a relevant check fails.
6. Run `npm run api:publish` once. Do not deploy, release, change secrets, or rerun a failed publish blindly.
7. Verify the deployed public events and collection status match the validated local count, retrieval time, source results, and representative latest events for every game. Report any mismatch as a failed refresh.

Do not ask for another confirmation after the current task has explicitly authorized this workflow. Keep publication scoped to schedule data and preserve all prior event history. If repair work changed code, commit only the agent-owned validated files under repository policy; never push code merely because production data refresh was authorized.

## Report proof

Report the initial failing test, its failure reason, the minimal fix, the passing focused and regression commands, dry-run results by source, operational before/after counts when refreshed, publish verification, and any checks not run. Do not claim normal collection solely because unit tests or compilation passed.
