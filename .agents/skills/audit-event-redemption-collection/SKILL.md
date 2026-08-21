---
name: audit-event-redemption-collection
description: Audit whether official event and redemption-code collection is policy-compliant and current across supported games. Use when checking collection freshness, omissions, source failures, candidate outcomes, or published-data integrity; do not use for unrelated API changes.
---

# Audit Event and Redemption Collection

Verify the collection outcome against the repository policy before proposing a parser or source change. Keep events and redemption codes as separate domains throughout the audit.

## Establish the baseline

Read `AGENTS.md`, `config/sources.json`, `src/domain/event.ts`, `src/events/event-validator.ts`, `src/domain/redemption-code.ts`, and `src/redemption-codes/redemption-code-validator.ts`.

Record the current event and redemption-code counts, last `collection-status.json.retrievedAt`, and each source's `ok`, candidate, collected, stored, and error fields. When checking production freshness, read the public production collection-status and relevant public event/redemption endpoints; do not infer production state from an older local snapshot.

## Check policy and source evidence

Use only configured official sources. For each source, verify author and host safeguards still match the live response before treating a gap as a parser defect.

- For events, distinguish explicit source schedules from collection-window estimates. An official candidate without an extractable schedule time must use the policy-defined KST collection window, `confidence: probable`, and an explanatory `sourceTimeText`; never present that interval as an official time.
- For redemption codes, accept only official, public codes with explicit code evidence. Do not turn invitation, purchase, single-use, image-only, or ambiguous OCR strings into published codes.
- `candidateDiagnostics` is latest-run telemetry, not a permanent candidate dataset. State when a historical per-item exclusion cannot be reconstructed because it has been overwritten.

## Verify without changing production

Run `npm run test:collector`, then `npm run collect:dry`. A dry run must not write repository data or publish. If stdout is large, capture it and inspect the parsed status and only the relevant representative records.

For dry-run output, confirm separately:

- Every configured source has an explicit success or failure result; one source failure must not hide the others.
- Event IDs and source URLs are unique; timestamps are zoned; `endsAt` is not before `startsAt`; and statuses are recomputed from the audit time.
- Redemption-code IDs/codes and source URLs are unique, and validity/status follow official expiry evidence.
- Stored totals, collected totals, and candidate counts are interpreted per domain rather than conflated.

Use `npm run typecheck`, `npm run test:e2e`, and `npm run build` when code or public contracts changed. Distinguish deterministic parser failures from DNS, browser-rendering, rate-limit, and upstream failures.

## Report and escalate

Report the comparison period, source-by-source results, representative included/excluded official URLs, event and redemption-code counts, and any uncertainty. If official evidence proves a defect, add a focused regression test before repairing it.

Do not run `api:publish`, deploy, push, or alter production data unless the user explicitly requests that external change. A freshness audit or dry run alone is not publication authorization.
