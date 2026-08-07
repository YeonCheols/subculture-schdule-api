#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electronPath from 'electron';
import { USER_AGENT, collectText, decodeHtml, deduplicate, extractNetmarbleForumLinks, extractPage, mergeEventHistory, normalize } from './lib.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const dryRun = process.argv.includes('--dry-run');
const sources = JSON.parse(await readFile(path.join(root, 'config/sources.json'), 'utf8'));
const retrievedAt = new Date().toISOString();
const timeoutMs = Number(process.env.COLLECT_TIMEOUT_MS || 15000);
const maxDetails = Number(process.env.COLLECT_MAX_DETAILS || 30);
const dataDirectory = path.join(root, 'data', 'schedule-api');

async function request(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json,text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs), redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { body: await response.text(), finalUrl: response.url };
}

async function renderUrls(urls) {
  const directory = await mkdtemp(path.join(tmpdir(), 'schedule-api-forum-'));
  const input = path.join(directory, 'input.json'); const output = path.join(directory, 'output.json');
  await writeFile(input, JSON.stringify(urls));
  const chromiumArgs = process.env.CI || process.env.GITHUB_ACTIONS ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  await execFileAsync(electronPath, [...chromiumArgs, path.join(import.meta.dirname, 'render-browser.cjs'), input, output], { timeout: timeoutMs * Math.max(2, urls.length) });
  return JSON.parse(await readFile(output, 'utf8'));
}

async function collectSource(source) {
  if (source.kind === 'netmarble-forum') {
    const indexes = await renderUrls(source.urls || [source.url]);
    const candidates = indexes.filter((item) => item.body).flatMap((item) => extractNetmarbleForumLinks(item.body, source))
      .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index).slice(0, maxDetails);
    if (!candidates.length) throw new Error('No forum posts found after browser rendering');
    const details = await renderUrls(candidates.map((candidate) => candidate.url));
    const events = []; const rawCandidates = [];
    for (const [index, detail] of details.entries()) {
      if (!detail.body) { rawCandidates.push({ ...candidates[index], error: detail.error }); continue; }
      const page = extractPage(detail.body, { ...candidates[index], url: detail.finalUrl });
      rawCandidates.push({ ...candidates[index], finalUrl: detail.finalUrl, body: detail.body });
      events.push(normalize(source, page, retrievedAt));
    }
    return { source, events, raw: { sourceId: source.id, retrievedAt, indexes, candidates: rawCandidates }, candidateCount: candidates.length };
  }

  const index = await request(source.url);
  if (source.kind === 'naver-lounge-pins') {
    const payload = JSON.parse(index.body);
    if (payload.code !== 200 || !Array.isArray(payload.content)) throw new Error('Invalid Naver Lounge official feed response');
    const officialFeeds = payload.content.filter((item) => item.user?.nickname === source.officialNickname).slice(0, maxDetails);
    const events = officialFeeds.map((item) => {
      let document = {};
      try { document = JSON.parse(item.feed.contents || '{}'); } catch {}
      const created = item.feed.createdDate;
      const publishedAt = /^\d{14}$/.test(created) ? `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}T${created.slice(8, 10)}:${created.slice(10, 12)}:${created.slice(12, 14)}+09:00` : null;
      return normalize(source, { title: decodeHtml(item.feed.title), canonical: `${source.canonicalBase}${item.feed.feedId}`, description: '', published: publishedAt, text: collectText(document) }, retrievedAt);
    }).filter((event) => event.startsAt);
    return { source, events, raw: { sourceId: source.id, sourceUrl: index.finalUrl, retrievedAt, payload }, candidateCount: officialFeeds.length };
  }

  if (source.kind === 'hoyoverse-content') {
    const payload = JSON.parse(index.body);
    if (payload.retcode !== 0 || !Array.isArray(payload.data?.list)) throw new Error(`Invalid official API response: ${payload.message || 'missing list'}`);
    const items = payload.data.list.slice(0, maxDetails);
    const events = items.map((item) => normalize(source, {
      title: item.sTitle, canonical: `${source.canonicalBase}${item.iInfoId}`, description: item.sIntro || '',
      published: item.dtCreateTime ? `${item.dtCreateTime.replace(' ', 'T')}+09:00` : null,
      text: `${item.sTitle}\n${item.sIntro || ''}\n${item.sContent || ''}`,
    }, retrievedAt));
    return { source, events, raw: { sourceId: source.id, sourceUrl: index.finalUrl, retrievedAt, payload }, candidateCount: items.length };
  }
  throw new Error(`Unsupported source kind: ${source.kind}`);
}

async function readExistingEvents() {
  try { return JSON.parse(await readFile(path.join(dataDirectory, 'events.json'), 'utf8')); } catch { return []; }
}

const results = await Promise.allSettled(sources.map(collectSource));
const collectedEvents = deduplicate(results.flatMap((result) => result.status === 'fulfilled' ? result.value.events : []).filter((event) => event.startsAt));
const events = mergeEventHistory(await readExistingEvents(), collectedEvents);
const status = {
  retrievedAt, eventCount: events.length, collectedEventCount: collectedEvents.length,
  sources: results.map((result, index) => result.status === 'fulfilled'
    ? { id: result.value.source.id, ok: true, candidateCount: result.value.candidateCount, collectedEventCount: result.value.events.filter((event) => event.startsAt).length, storedEventCount: events.filter((event) => event.gameId === result.value.source.gameId).length }
    : { id: sources[index].id, ok: false, error: result.reason?.message || String(result.reason) }),
};

if (dryRun) {
  console.log(JSON.stringify({ status, events }, null, 2));
  process.exit(status.sources.some((source) => !source.ok) ? 1 : 0);
}

await mkdir(dataDirectory, { recursive: true });
const rawDirectory = path.join(root, 'data', 'raw', retrievedAt.replace(/[:.]/g, '-'));
await mkdir(rawDirectory, { recursive: true });
for (const result of results) if (result.status === 'fulfilled') await writeFile(path.join(rawDirectory, `${result.value.source.id}.json`), JSON.stringify(result.value.raw, null, 2));

async function atomicJson(name, value) {
  const target = path.join(dataDirectory, name); const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, target);
}
await Promise.all([atomicJson('events.json', events), atomicJson('collection-status.json', status)]);

console.log(`Collected ${collectedEvents.length} events, retained ${events.length}, successful sources=${status.sources.filter((source) => source.ok).length}/${sources.length}.`);
const failedSources = status.sources.filter((source) => !source.ok);
for (const source of failedSources) console.error(`Source ${source.id} failed: ${source.error}`);
if (failedSources.length) process.exitCode = 1;
