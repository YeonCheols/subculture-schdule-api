---
name: normalize-schedule-events
description: Parse official game posts into valid ScheduleEvent records and review time extraction, classification, IDs, deduplication, history merging, confidence, and status calculation. Use when editing src/domain/event.ts, src/events/event-validator.ts, scripts/collector/lib.mjs, or event JSON data.
---

# Normalize Schedule Events

## Establish the contract

Read `src/domain/event.ts` and `src/events/event-validator.ts` before changing normalization. Treat them as the schema and import-validation authority. Inspect the affected official source text and existing tests rather than inferring unsupported facts.

## Normalize

1. Generate a stable `id` from the canonical official `sourceUrl`; the same URL represents the same logical event.
2. Use only declared values for `gameId`, `type`, `status`, and `confidence`.
3. Store `publishedAt`, `startsAt`, `endsAt`, and `retrievedAt` as `null` or valid ISO 8601 instants with a timezone. Encode explicit Korean source times with `+09:00`.
4. Keep the source phrase in `sourceTimeText`. Never substitute a guessed date for a conflicting or absent source date.
5. Ensure `endsAt` is not earlier than `startsAt`.
6. Recompute status from the current instant. Preserve existing records missing from the current collection and update records with matching URLs.
7. Deduplicate both `id` and `sourceUrl`; make output ordering deterministic.

## Confidence and ambiguity

Use `confirmed` only when the official source explicitly supports the relevant schedule. If required interpretation is uncertain, report the ambiguity before changing code or data. Do not promote image-only or OCR-derived timing to a confirmed event.

## Verification

Add boundary tests for timezone, cross-year ranges, open-ended events, duplicate URLs, and status transitions as relevant. Run `npm run test:collector`, `npm run test:e2e`, and `npm run typecheck`. If data files change, also compare `collection-status.json.eventCount` with the actual event count.
