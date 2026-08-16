---
name: add-game-integration
description: Add a supported game and its official data sources across the domain, collector, validation, configuration, API filters, and tests. Use when onboarding a new game, official forum, publisher API, locale, source adapter, or gameId to this backend.
---

# Add Game Integration

## Discover before editing

Identify official source URLs, publisher ownership, response format, pagination, publication timestamp semantics, timezone, canonical URL rules, and anti-bot or browser-rendering requirements. Verify the live public response when access is available. Stop and report uncertainty if official authorship or dates cannot be established.

## Implement end to end

1. Add the new identifier to `GAME_IDS` in `src/domain/event.ts`.
2. Add official source definitions to `config/sources.json`, including allowed hosts, locale, and author constraints.
3. Implement source discovery and detail parsing in the appropriate collector path. Keep daily collection bounded; implement historical pagination in backfill only.
4. Normalize through the shared rules in `scripts/collector/lib.mjs` where possible. Keep source-specific behavior isolated and explicit.
5. Update import validation and public API query/filter behavior.
6. Add collector fixtures for valid, empty, malformed, unofficial-author, and pagination cases as applicable.
7. Add e2e coverage proving the new `gameId` is accepted, filterable, and does not alter existing games.

## Preserve operations

- Continue processing other sources when the new source fails.
- Never delete existing event history during merge.
- Keep local JSON and Vercel Blob storage behavior equivalent.
- Do not place secrets, tokens, or production credentials in source, fixtures, or docs.
- Do not run `npm run api:publish` unless the user explicitly requests publication.

## Verification

Run `npm run test`. Also inspect generated events for valid zoned timestamps, unique IDs and URLs, accurate source status counts, and retained historical records.
