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
const sources = JSON.parse(await readFile(path.join(root, 'config/sources.json'), 'utf8'));
const dataDirectory = path.join(root, 'data', 'schedule-api');
const retrievedAt = new Date().toISOString();
const timeoutMs = Number(process.env.COLLECT_TIMEOUT_MS || 30_000);
const pageSize = Number(process.env.BACKFILL_PAGE_SIZE || 30);
const maxPages = Number(process.env.BACKFILL_MAX_PAGES || 50);
const write = process.argv.includes('--write');
const from = argument('from');
const to = argument('to');

if (!isDate(from) || !isDate(to) || from > to) {
  throw new Error('Usage: npm run collect:backfill -- --from=YYYY-MM-DD --to=YYYY-MM-DD [--write]');
}

const fromMs = Date.parse(`${from}T00:00:00+09:00`);
const toMs = Date.parse(`${to}T23:59:59.999+09:00`);

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function requestJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function renderUrls(urls) {
  if (!urls.length) return [];
  const directory = await mkdtemp(path.join(tmpdir(), 'schedule-backfill-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'output.json');
  await writeFile(input, JSON.stringify(urls));
  const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  await execFileAsync(electronPath, [path.join(import.meta.dirname, 'render-browser.cjs'), input, output], {
    timeout: timeoutMs * Math.max(2, urls.length),
    env: { ...process.env, RENDER_WAIT_MS: process.env.BACKFILL_RENDER_WAIT_MS || '1000', ...(isCi ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}) },
  });
  return JSON.parse(await readFile(output, 'utf8'));
}

async function renderUrlsInBatches(urls, batchSize = 12, concurrency = 3) {
  const batches = [];
  for (let index = 0; index < urls.length; index += batchSize) batches.push(urls.slice(index, index + batchSize));
  const results = [];
  for (let index = 0; index < batches.length; index += concurrency) {
    results.push(...(await Promise.all(batches.slice(index, index + concurrency).map(renderUrls))).flat());
  }
  return results;
}

function naverDate(value) {
  if (!/^\d{14}$/.test(value || '')) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`;
}

function inPublicationRange(value) {
  const time = Date.parse(value || '');
  return !Number.isNaN(time) && time >= fromMs && time <= toMs;
}

function overlapsRange(event) {
  const start = Date.parse(event.startsAt || event.publishedAt || '');
  const end = Date.parse(event.endsAt || event.startsAt || event.publishedAt || '');
  return !Number.isNaN(start) && !Number.isNaN(end) && start <= toMs && end >= fromMs;
}

async function collectGenshin(source) {
  const events = [];
  let candidates = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(source.url);
    url.searchParams.set('iPage', String(page));
    url.searchParams.set('iPageSize', String(pageSize));
    const payload = await requestJson(url);
    if (payload.retcode !== 0 || !Array.isArray(payload.data?.list)) throw new Error('Invalid HoYoverse response');
    const items = payload.data.list;
    if (!items.length) break;
    for (const item of items) {
      const published = item.dtCreateTime ? `${item.dtCreateTime.replace(' ', 'T')}+09:00` : null;
      if (!inPublicationRange(published)) continue;
      candidates += 1;
      events.push(normalize(source, {
        title: item.sTitle,
        canonical: `${source.canonicalBase}${item.iInfoId}`,
        description: item.sIntro || '',
        published,
        text: `${item.sTitle}\n${item.sIntro || ''}\n${item.sContent || ''}`,
      }, retrievedAt));
    }
    const oldest = items.map((item) => Date.parse(`${item.dtCreateTime.replace(' ', 'T')}+09:00`)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (oldest < fromMs || page * pageSize >= payload.data.iTotal) break;
  }
  return { events, candidates };
}

async function collectWuthering(source) {
  const events = [];
  let candidates = 0;
  for (const boardId of source.backfillBoardIds || [1, 28, 3]) {
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL('https://comm-api.game.naver.com/nng_main/v1/community/lounge/WutheringWaves/feed');
      url.search = new URLSearchParams({ offset: String(page * pageSize), limit: String(pageSize), order: 'NEW', boardId: String(boardId), buffFilteringYN: 'N' });
      const payload = await requestJson(url);
      const content = payload.content;
      if (payload.code !== 200 || !Array.isArray(content?.feeds)) throw new Error(`Invalid Naver Lounge response for board ${boardId}`);
      if (!content.feeds.length) break;
      for (const item of content.feeds) {
        if (item.user?.nickname !== source.officialNickname) continue;
        const published = naverDate(item.feed?.createdDate);
        if (!inPublicationRange(published)) continue;
        let document = {};
        try { document = JSON.parse(item.feed.contents || '{}'); } catch {}
        candidates += 1;
        events.push(normalize(source, {
          title: decodeHtml(item.feed.title),
          canonical: `${source.canonicalBase}${item.feed.feedId}`,
          description: '', published, text: collectText(document),
        }, retrievedAt));
      }
      const dates = content.feeds.map((item) => Date.parse(naverDate(item.feed?.createdDate) || '')).filter(Number.isFinite);
      if (Math.min(...dates) < fromMs || (page + 1) * pageSize >= content.totalCount) break;
    }
  }
  return { events, candidates };
}

async function collectMonster(source) {
  const baseUrls = source.urls || [source.url];
  const indexUrls = [];
  for (const base of baseUrls) {
    for (let page = 1; page <= maxPages; page += 1) indexUrls.push(base.replace(/\/\d+$/, `/${page}`));
  }
  const renderedIndexes = await renderUrlsInBatches(indexUrls);
  const links = deduplicateLinks(renderedIndexes.flatMap((item) => item.body ? extractNetmarbleForumLinks(item.body, source) : []));
  const details = await renderUrlsInBatches(links.map((item) => item.url));
  const events = [];
  let candidates = 0;
  for (const [index, detail] of details.entries()) {
    if (!detail.body) continue;
    const page = extractPage(detail.body, { ...links[index], url: detail.finalUrl || links[index].url });
    if (!inPublicationRange(page.published)) continue;
    candidates += 1;
    events.push(normalize(source, page, retrievedAt));
  }
  return { events, candidates };
}

function deduplicateLinks(links) {
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

const collectors = {
  'netmarble-forum': collectMonster,
  'naver-lounge-pins': collectWuthering,
  'hoyoverse-content': collectGenshin,
  'hoyoverse-main-redemption': async () => ({ events: [], candidates: 0 }),
};
const results = [];
for (const source of sources) {
  process.stderr.write(`Backfilling ${source.gameId}...\n`);
  try {
    const result = await collectors[source.kind](source);
    results.push({ source, ok: true, ...result });
  } catch (error) {
    results.push({ source, ok: false, events: [], candidates: 0, error: error.message });
  }
}

const collected = deduplicate(results.flatMap((result) => result.events).filter((event) => event.startsAt && overlapsRange(event)));
let existing = [];
try { existing = JSON.parse(await readFile(path.join(dataDirectory, 'events.json'), 'utf8')); } catch {}
const events = mergeEventHistory(existing, collected);
const summary = {
  from, to, write, collectedEventCount: collected.length, retainedEventCount: events.length,
  sources: results.map((result) => ({ id: result.source.id, ok: result.ok, candidateCount: result.candidates, collectedEventCount: result.events.filter((event) => event.startsAt && overlapsRange(event)).length, ...(result.error ? { error: result.error } : {}) })),
};

if (write) {
  await mkdir(dataDirectory, { recursive: true });
  const collectionStatus = {
    retrievedAt,
    eventCount: events.length,
    collectedEventCount: collected.length,
    sources: results.map((result) => ({
      id: result.source.id,
      ok: result.ok,
      candidateCount: result.candidates,
      collectedEventCount: result.events.filter((event) => event.startsAt && overlapsRange(event)).length,
      storedEventCount: events.filter((event) => event.gameId === result.source.gameId).length,
      ...(result.error ? { error: result.error } : {}),
    })),
  };
  await Promise.all([
    atomicJson('events.json', events),
    atomicJson('collection-status.json', collectionStatus),
  ]);
}

console.log(JSON.stringify(summary, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;

async function atomicJson(name, value) {
  const target = path.join(dataDirectory, name);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, target);
}
