---
name: collect-official-game-data
description: Maintain and extend the daily or backfill collectors for official subculture-game schedules. Use when changing source discovery, source-specific HTTP or browser rendering, pagination, author verification, parsing, retry or failure isolation in scripts/collector or config/sources.json.
---

# Collect Official Game Data

## Workflow

1. Read `AGENTS.md`, `config/sources.json`, and the affected collector entry point before editing.
2. Confirm the live response structure from the official website or API when parser behavior may have changed. Do not use search snippets, fan sites, leaks, or community guesses as stored data.
3. Preserve source-specific safeguards:
   - Render Netmarble pages through `scripts/collector/render-browser.cjs`; keep adequate wait time and CI sandbox/Xvfb support.
   - Accept Naver Lounge posts only from the configured official nickname (`GM 연구소` for Wuthering Waves) and convert `YYYYMMDDHHmmss` as Korea time.
   - Validate HoYoverse `retcode`, `data.list`, and `iTotal`; paginate with `iPage` and `iPageSize` during backfill.
4. Keep the daily collector bounded and incremental. Put historical page traversal only in `scripts/collector/backfill.mjs`.
5. Isolate failures per source, retain existing event history, and expose clear source errors in `collection-status.json`.
6. Add focused fixtures and assertions to `test/collector.test.mjs` for response-shape and edge-case changes.

## Data rules

- Store only HTTPS canonical official URLs.
- Reject posts without a verifiable date or time; do not fabricate timezone-free ISO values.
- Preserve the exact extracted time expression in `sourceTimeText`.
- Treat `retrievedAt` as collection time, never publication time.
- Do not apply OCR to image-only schedules unless the user explicitly changes project policy.
- Keep dry runs non-mutating. Backfill requires `--from`, `--to`, and writes only with `--write` after preview review.

## Verification

Run `npm run test:collector` for parser changes, then `npm run typecheck` and `npm run build` when application code is affected. For live-network failures, distinguish parser defects from transient network or upstream failures in the report.
