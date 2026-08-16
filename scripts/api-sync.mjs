#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv[2];
const apiUrl = process.env.SCHEDULE_API_URL?.replace(/\/$/, '');
const dataDirectory = path.resolve(import.meta.dirname, '../data/schedule-api');

if (!['pull', 'push'].includes(mode)) throw new Error('Usage: node scripts/api-sync.mjs <pull|push>');
if (!apiUrl) throw new Error('SCHEDULE_API_URL is required');

if (mode === 'pull') {
  await mkdir(dataDirectory, { recursive: true });
  for (const dataset of [
    { route: 'events', file: 'events.json', label: 'event', required: true },
    { route: 'redemption-codes', file: 'redemption-codes.json', label: 'redemption code', required: false },
    { route: 'redemption-code-candidates', file: 'redemption-code-candidates.json', label: 'redemption code candidate', required: false },
  ]) {
    const response = await fetch(`${apiUrl}/api/v1/${dataset.route}`, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404 && !dataset.required) {
      console.log(`Remote ${dataset.label} history is empty; using the repository seed data.`);
      continue;
    }
    if (response.status === 404) {
      console.log('Remote event history is empty; using the repository seed data.');
      continue;
    }
    if (!response.ok) throw new Error(`Cannot download current ${dataset.label}s: HTTP ${response.status} ${await response.text()}`);
    const values = await response.json();
    if (!Array.isArray(values)) throw new Error(`Remote ${dataset.label}s response must be an array`);
    const target = path.join(dataDirectory, dataset.file); const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`); await rename(temporary, target);
    console.log(`Downloaded ${values.length} existing ${dataset.label}(s).`);
  }
}

if (mode === 'push') {
  const token = process.env.INGEST_TOKEN;
  if (!token) throw new Error('INGEST_TOKEN is required');
  const [events, redemptionCodes, redemptionCodeCandidates, collectionStatus] = await Promise.all([
    readFile(path.join(dataDirectory, 'events.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dataDirectory, 'redemption-codes.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dataDirectory, 'redemption-code-candidates.json'), 'utf8').then(JSON.parse).catch(() => []),
    readFile(path.join(dataDirectory, 'collection-status.json'), 'utf8').then(JSON.parse),
  ]);
  const eventResponse = await fetch(`${apiUrl}/api/internal/events/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events, redemptionCodes, collectionStatus }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!eventResponse.ok) throw new Error(`Cannot publish schedules: HTTP ${eventResponse.status} ${await eventResponse.text()}`);
  const candidateResponse = await fetch(`${apiUrl}/api/internal/redemption-code-candidates/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(redemptionCodeCandidates),
    signal: AbortSignal.timeout(60_000),
  });
  if (!candidateResponse.ok) throw new Error(`Cannot publish redemption code candidates: HTTP ${candidateResponse.status} ${await candidateResponse.text()}`);
  console.log(`Published schedules: ${await eventResponse.text()}`);
  console.log(`Published redemption code candidates: ${await candidateResponse.text()}`);
}
