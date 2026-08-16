---
name: verify-schedule-backend
description: Validate collector, NestJS API, storage, schema, configuration, workflow, and event-data changes with risk-based checks. Use after implementation, during code review, before commit or deployment, or when diagnosing failing collector, e2e, typecheck, build, or data-integrity checks.
---

# Verify Schedule Backend

## Scope the risk

Inspect the diff and map changed files to checks:

- Collector parsing, source config, or data merge: collector tests plus data invariants.
- Controllers, DTOs, guards, validators, or storage: e2e tests and typecheck.
- Domain types or shared contracts: collector tests, e2e tests, typecheck, and build.
- Workflow or runtime configuration: inspect the exact command path and run the safest local equivalent.
- Documentation-only changes: verify paths and commands; avoid unrelated test runs.

## Run checks

Use the narrowest relevant checks first, then broaden when shared contracts changed:

```bash
npm run typecheck
npm run test:collector
npm run test:e2e
npm run build
```

Use `npm run test` for the complete suite. Do not publish or mutate deployed data as verification.

## Inspect data invariants

Confirm that every event passes `validateEvents`, IDs and `sourceUrl` values are unique, timestamps include timezones, `endsAt >= startsAt`, old history remains, statuses match the current instant, and `collection-status.json.eventCount` equals stored records. Confirm source failures remain visible and do not erase successful results from other sources.

## Report evidence

Report each command and result, distinguish pre-existing failures from regressions when evidence allows, and identify network/upstream instability separately from parser failures. State any checks not run and why. Do not claim success from compilation alone when runtime or data behavior changed.
