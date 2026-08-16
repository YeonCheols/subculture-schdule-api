#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electronPath from 'electron';
import { USER_AGENT, deduplicate, diagnoseNetmarbleCandidate, extractGenshinMainRedemptionCodes, extractNaverOfficialPages, extractNetmarbleForumLinks, extractPage, extractRedemptionCodes, mergeEventHistory, mergeRedemptionCodeHistory, normalize, selectNetmarbleForumCandidates } from './lib.mjs';
import { collectRedemptionOcrCandidates, enrichBannerPagesWithOcr, terminateOcrWorker } from './ocr.mjs';
import { discoverUnofficialRedemptionCandidates } from './search-discovery.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const dryRun = process.argv.includes('--dry-run');
const sources = JSON.parse(await readFile(path.join(root, 'config/sources.json'), 'utf8'));
const searchConfig = JSON.parse(await readFile(path.join(root, 'config/search.json'), 'utf8'));
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

async function renderUrls(urls, renderWaitMs = null) {
  const directory = await mkdtemp(path.join(tmpdir(), 'schedule-api-forum-'));
  const input = path.join(directory, 'input.json'); const output = path.join(directory, 'output.json');
  await writeFile(input, JSON.stringify(urls));
  const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const chromiumArgs = isCi ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  await execFileAsync(electronPath, [path.join(import.meta.dirname, 'render-browser.cjs'), input, output, ...chromiumArgs], {
    timeout: timeoutMs * Math.max(2, urls.length),
    env: { ...process.env, ...(renderWaitMs ? { RENDER_WAIT_MS: String(renderWaitMs) } : {}), ...(isCi ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}) },
  });
  return JSON.parse(await readFile(output, 'utf8'));
}

async function collectSource(source) {
  if (source.kind === 'netmarble-forum') {
    const indexes = await renderUrls(source.urls || [source.url]);
    const candidates = selectNetmarbleForumCandidates(
      indexes.filter((item) => item.body).map((item) => extractNetmarbleForumLinks(item.body, source)),
      Number(source.dailyMaxPosts || maxDetails),
    );
    if (!candidates.length) throw new Error('No forum posts found after browser rendering');
    const details = await renderUrls(candidates.map((candidate) => candidate.url));
    const events = []; const redemptionCodes = []; const rawCandidates = [];
    const pages = [];
    for (const [index, detail] of details.entries()) {
      if (!detail.body) { rawCandidates.push({ ...candidates[index], error: detail.error }); continue; }
      const page = extractPage(detail.body, { ...candidates[index], url: detail.finalUrl });
      rawCandidates.push({ ...candidates[index], finalUrl: detail.finalUrl, body: detail.body });
      pages.push(page);
    }
    const enrichedPages = await enrichBannerPagesWithOcr(source, pages);
    for (const page of enrichedPages) {
      events.push(normalize(source, page, retrievedAt));
      redemptionCodes.push(...extractRedemptionCodes(source, page, retrievedAt));
    }
    const eventByUrl = new Map(events.map((event) => [event.sourceUrl, event]));
    const pageByUrl = new Map(enrichedPages.map((page) => [page.canonical, page]));
    const candidateDiagnostics = rawCandidates.map((candidate) => diagnoseNetmarbleCandidate(
      candidate, eventByUrl.get(candidate.finalUrl || candidate.url), pageByUrl.get(candidate.finalUrl || candidate.url),
    ));
    const redemptionCodeCandidates = await collectRedemptionOcrCandidates(source, pages, retrievedAt);
    return { source, events, redemptionCodes, redemptionCodeCandidates, candidateDiagnostics, raw: { sourceId: source.id, retrievedAt, indexes, candidates: rawCandidates }, candidateCount: candidates.length };
  }

  if (source.kind === 'hoyoverse-main-redemption') {
    const [page] = await renderUrls([source.url], source.renderWaitMs || 5000);
    if (!page?.body) throw new Error(`Official main page rendering failed: ${page?.error || 'empty HTML'}`);
    const canonicalUrl = page.finalUrl && new URL(page.finalUrl).hostname === 'genshin.hoyoverse.com' ? page.finalUrl : source.url;
    const redemptionCodes = extractGenshinMainRedemptionCodes({ ...source, canonicalUrl }, page.body, retrievedAt);
    return { source, events: [], redemptionCodes, redemptionCodeCandidates: [], raw: { sourceId: source.id, retrievedAt, page }, candidateCount: redemptionCodes.length };
  }

  const index = await request(source.url);
  if (source.kind === 'naver-lounge-pins') {
    const payload = JSON.parse(index.body);
    if (payload.code !== 200 || !Array.isArray(payload.content)) throw new Error('Invalid Naver Lounge official feed response');
    const pageSize = Math.min(Number(source.dailyPageSize || 30), 50);
    const boardPayloads = await Promise.all((source.dailyBoardIds || []).map(async (boardId) => {
      const url = new URL('https://comm-api.game.naver.com/nng_main/v1/community/lounge/WutheringWaves/feed');
      url.search = new URLSearchParams({ offset: '0', limit: String(pageSize), order: 'NEW', boardId: String(boardId), buffFilteringYN: 'N' });
      const boardPayload = JSON.parse((await request(url)).body);
      if (boardPayload.code !== 200 || !Array.isArray(boardPayload.content?.feeds)) throw new Error(`Invalid Naver Lounge response for board ${boardId}`);
      return boardPayload.content.feeds;
    }));
    const pages = await enrichBannerPagesWithOcr(source, extractNaverOfficialPages([payload.content, ...boardPayloads], source, Number(source.dailyMaxPosts || maxDetails)));
    const events = pages.map((page) => normalize(source, page, retrievedAt)).filter((event) => event.startsAt || event.endsAt);
    const redemptionCodes = pages.flatMap((page) => extractRedemptionCodes(source, page, retrievedAt));
    const redemptionCodeCandidates = await collectRedemptionOcrCandidates(source, pages, retrievedAt);
    return { source, events, redemptionCodes, redemptionCodeCandidates, raw: { sourceId: source.id, sourceUrl: index.finalUrl, retrievedAt, payload }, candidateCount: pages.length };
  }

  if (source.kind === 'hoyoverse-content') {
    const payload = JSON.parse(index.body);
    if (payload.retcode !== 0 || !Array.isArray(payload.data?.list)) throw new Error(`Invalid official API response: ${payload.message || 'missing list'}`);
    const items = payload.data.list.slice(0, maxDetails);
    const pages = items.map((item) => ({
      title: item.sTitle, canonical: `${source.canonicalBase}${item.iInfoId}`, description: item.sIntro || '',
      published: item.dtCreateTime ? `${item.dtCreateTime.replace(' ', 'T')}+09:00` : null,
      text: `${item.sTitle}\n${item.sIntro || ''}\n${item.sContent || ''}`,
    }));
    const events = pages.map((page) => normalize(source, page, retrievedAt));
    const redemptionCodes = pages.flatMap((page) => extractRedemptionCodes(source, page, retrievedAt));
    return { source, events, redemptionCodes, redemptionCodeCandidates: [], raw: { sourceId: source.id, sourceUrl: index.finalUrl, retrievedAt, payload }, candidateCount: items.length };
  }
  throw new Error(`Unsupported source kind: ${source.kind}`);
}

async function readExistingEvents() {
  try { return JSON.parse(await readFile(path.join(dataDirectory, 'events.json'), 'utf8')); } catch { return []; }
}

async function readExistingRedemptionCodes() {
  try { return JSON.parse(await readFile(path.join(dataDirectory, 'redemption-codes.json'), 'utf8')); } catch { return []; }
}

async function readExistingRedemptionCodeCandidates() {
  try { return JSON.parse(await readFile(path.join(dataDirectory, 'redemption-code-candidates.json'), 'utf8')); } catch { return []; }
}

const results = await Promise.allSettled(sources.map(collectSource));
const searchDiscovery = await discoverUnofficialRedemptionCandidates(searchConfig, retrievedAt);
await terminateOcrWorker();
const collectedEvents = deduplicate(results.flatMap((result) => result.status === 'fulfilled' ? result.value.events : []).filter((event) => event.startsAt || event.endsAt));
const events = mergeEventHistory(await readExistingEvents(), collectedEvents);
const collectedRedemptionCodes = mergeRedemptionCodeHistory([], results.flatMap((result) => result.status === 'fulfilled' ? result.value.redemptionCodes : []));
const redemptionCodes = mergeRedemptionCodeHistory(await readExistingRedemptionCodes(), collectedRedemptionCodes);
const collectedRedemptionCodeCandidates = [
  ...results.flatMap((result) => result.status === 'fulfilled' ? result.value.redemptionCodeCandidates : []),
  ...searchDiscovery.candidates,
];
const candidateMap = new Map((await readExistingRedemptionCodeCandidates()).map((candidate) => [candidate.id, candidate]));
for (const candidate of collectedRedemptionCodeCandidates) candidateMap.set(candidate.id, candidate);
const redemptionCodeCandidates = [...candidateMap.values()].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
const status = {
  retrievedAt, eventCount: events.length, collectedEventCount: collectedEvents.length,
  redemptionCodeCount: redemptionCodes.length, collectedRedemptionCodeCount: collectedRedemptionCodes.length,
  redemptionCodeCandidateCount: redemptionCodeCandidates.length, collectedRedemptionCodeCandidateCount: collectedRedemptionCodeCandidates.length,
  searchDiscovery: { skipped: searchDiscovery.skipped, candidateCount: searchDiscovery.candidates.length, errors: searchDiscovery.errors },
  sources: results.map((result, index) => result.status === 'fulfilled'
    ? { id: result.value.source.id, ok: true, candidateCount: result.value.candidateCount, collectedEventCount: result.value.events.filter((event) => event.startsAt || event.endsAt).length, storedEventCount: events.filter((event) => event.gameId === result.value.source.gameId).length, collectedRedemptionCodeCount: result.value.redemptionCodes.length, storedRedemptionCodeCount: redemptionCodes.filter((code) => code.gameId === result.value.source.gameId).length, collectedRedemptionCodeCandidateCount: result.value.redemptionCodeCandidates.length, ocrErrors: result.value.redemptionCodeCandidates.errors || [], ...(result.value.candidateDiagnostics ? { candidateDiagnostics: result.value.candidateDiagnostics } : {}) }
    : { id: sources[index].id, ok: false, error: result.reason?.message || String(result.reason) }),
};

if (dryRun) {
  console.log(JSON.stringify({ status, events, redemptionCodes, redemptionCodeCandidates }, null, 2));
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
await Promise.all([atomicJson('events.json', events), atomicJson('redemption-codes.json', redemptionCodes), atomicJson('redemption-code-candidates.json', redemptionCodeCandidates), atomicJson('collection-status.json', status)]);

console.log(`Collected ${collectedEvents.length} events and ${collectedRedemptionCodes.length} redemption codes, retained ${events.length} events and ${redemptionCodes.length} redemption codes, successful sources=${status.sources.filter((source) => source.ok).length}/${sources.length}.`);
const failedSources = status.sources.filter((source) => !source.ok);
for (const source of failedSources) console.error(`Source ${source.id} failed: ${source.error}`);
if (failedSources.length) process.exitCode = 1;
