---
name: evolve-game-content-model
description: Design and implement new official game-information types such as redemption codes, collaborations, banners, notices, or richer event metadata. Use when changing enums or schemas, adding a content category, deciding whether data belongs in ScheduleEvent, or extending storage and public APIs.
---

# Evolve Game Content Model

## Choose the model boundary

Start from consumer needs and source semantics. Use `ScheduleEvent` only for information whose main identity is a scheduled interval. Model redemption codes separately when fields such as code, region, redemption URL, validity, usage limits, or availability state are first-class. Model collaborations as events only when the official source provides a dated interval; otherwise use a separate content record.

Do not mix user-specific redemption state, accounts, or credentials into shared event JSON. Such data requires a separate model, authorization boundary, and storage design.

## Evolve the contract

1. Write the proposed fields, nullability, enums, stable identity, lifecycle, and backward-compatibility behavior before implementation.
2. Update domain types and the import validator together.
3. Update classification and normalization only from explicit official-source evidence.
4. Update local JSON and Vercel Blob storage paths without weakening atomic writes or private-blob behavior.
5. Update public controllers, DTO filters, cache behavior, and e2e tests.
6. Update collector tests for every new enum value or source classification.
7. Preserve old records and API consumers; prefer additive response changes unless the user explicitly accepts a breaking change.

## Source and time integrity

Require canonical HTTPS official URLs. Keep collection time distinct from publication and validity times. Do not invent expiration dates for redemption codes or collaboration windows. Represent unknown values explicitly instead of assigning misleading defaults.

## Verification

Run `npm run test`. For schema migrations, validate representative old and new payloads, duplicates, invalid enums, missing optional fields, zoned timestamps, cache behavior, and storage round trips.
