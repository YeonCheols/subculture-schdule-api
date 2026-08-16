#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { USER_AGENT, createNaverFeedUrl, extractNaverCharacters, mergeCharacterHistory } from './lib.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const sources = JSON.parse(await readFile(path.join(root, 'config/sources.json'), 'utf8'));
const source = sources.find((item) => item.gameId === 'nte' && item.characters?.boardId);
if (!source) throw new Error('NTE character source is not configured');
const write = process.argv.includes('--write');
const requestedPages = Number(process.argv.find((value) => value.startsWith('--max-pages='))?.split('=')[1] || source.characters.backfillMaxPages || 10);
const maxPages = Math.min(Math.max(requestedPages, 1), 10);
const pageSize = 30;
const timeoutMs = Number(process.env.COLLECT_TIMEOUT_MS || 30_000);
const retrievedAt = new Date().toISOString();
const collected = [];
let pagesFetched = 0;

for (let page = 0; page < maxPages; page += 1) {
  const url = createNaverFeedUrl(source, { offset: page, limit: pageSize, boardId: source.characters.boardId });
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const payload = await response.json();
  if (payload.code !== 200 || !Array.isArray(payload.content?.feeds)) throw new Error(`Invalid Naver character response on page ${page + 1}`);
  pagesFetched += 1;
  collected.push(...extractNaverCharacters(payload.content.feeds, source, retrievedAt));
  if (!payload.content.feeds.length || (page + 1) * pageSize >= payload.content.totalCount) break;
}

const dataDirectory = path.join(root, 'data/schedule-api');
let existing = [];
try { existing = JSON.parse(await readFile(path.join(dataDirectory, 'characters.json'), 'utf8')); } catch {}
const characters = mergeCharacterHistory(existing, collected);
const summary = { write, requestedMaxPages: maxPages, pagesFetched, collectedCharacterCount: collected.length, retainedCharacterCount: characters.length, characters: collected.map(({ name, sourceUrl, publishedAt }) => ({ name, sourceUrl, publishedAt })) };

if (write) {
  await mkdir(dataDirectory, { recursive: true });
  const target = path.join(dataDirectory, 'characters.json');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(characters, null, 2)}\n`);
  await rename(temporary, target);
}
console.log(JSON.stringify(summary, null, 2));
