---
name: assess-youtube-redemption-sources
description: Assess whether each supported game's official YouTube channel can safely supply public redemption codes. Use before adding YouTube sources or collectors; do not use for ordinary redemption-code imports.
---

# Assess YouTube Redemption Sources

Decide separately for `monster`, `wuthering`, `genshin`, and `nte` whether an official YouTube channel is a viable redemption-code source. Produce evidence and an implementation recommendation; do not silently add a source or publish a code.

## Establish official-channel ownership

Start from a configured official site, publisher site, or in-game official notice that links to the channel. Record the canonical channel URL, immutable YouTube channel ID, locale, game/publisher relationship, and the exact first-party page that establishes ownership. A matching channel name, handle, search-result label, or YouTube verification badge alone is insufficient.

Treat regional and publisher-wide channels as distinct sources. Verify that each channel actually covers the selected game and locale before treating a video as a game source. If no first-party ownership link can be established, report the channel as unapproved and do not add it to `config/sources.json`.

## Classify code evidence

Use the strongest available evidence for each sampled recent video, livestream, or short:

- **Publishable:** a code is explicit in an official video's description, together with its game context. Store the canonical video URL as `sourceUrl`; retain quoted surrounding evidence and any stated validity period.
- **Candidate only:** a code appears in an official video's frame or embedded image, an official or generated subtitle/transcript, any video comment, or livestream chat. Preserve the video ID and URL, media timestamp or comment/message ID when available, extraction method, and original evidence. Do not publish it as a `RedemptionCode`.
- **Not collectable:** the code is spoken only, displayed too briefly, is personalized/single-use, needs a purchase or invitation, or has no reliable extraction path.

Never use generated captions, comments, livestream chat, or OCR from video frames as publishable code evidence. A description change must be detected with a content hash and rechecked before changing a stored result. For comments and chat, retain only the opaque platform message identifier and evidence needed for review; do not store an author's display name or other user profile data.

## Evaluate collection mechanics

Prefer a channel's public YouTube RSS feed for new-video discovery when it exposes the channel ID. Fetch individual public video pages only as needed to inspect the official description and canonical URL. Treat feeds as discovery metadata, not code evidence.

Include video frames, captions, comments, and livestream chat in the candidate-collection assessment. Evaluate each independently: their availability and APIs can require credentials, rendering, pagination, retention windows, or moderation-state handling. Candidate records must identify `official-video-frame`, `official-video-caption`, `official-video-comment`, or `official-live-chat` so the client can visibly distinguish them from verified codes. Do not scrape authenticated, rate-limited, or access-controlled content to bypass those constraints. State the required API, credential, request budget, and failure isolation before recommending one.

Check that an hourly collector can use bounded recent-video windows, stable video IDs, and source-level failures without losing existing codes. Do not backfill an unbounded channel history in the regular collector.

## Recommend a bounded change

For each game, report one of: `approved-description-source`, `candidate-only`, `not-supported`, or `needs-official-link`. Include the channel ID, first-party ownership proof, sampled URLs, code-evidence type, expected rate and pagination behavior, and a duplicate/expiry strategy.

The current repository policy permits official websites, forums, and lounges only. Before implementing an approved YouTube source, update `AGENTS.md` and `README.md` to explicitly allow the verified channel type, then update source configuration, collector parsing, candidate schema if needed, validators, and regression tests. Do not run `api:publish`, deploy, push, or alter production data without explicit authorization.
