#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, splitJsonArray } from './api-sync-lib.mjs';

const mode = process.argv[2];
const apiUrl = process.env.SCHEDULE_API_URL?.replace(/\/$/, '');
const dataDirectory = path.resolve(import.meta.dirname, '../data/schedule-api');
const eventBatchTargetBytes = Number(process.env.EVENT_IMPORT_BATCH_BYTES ?? 1_000_000);

if (!['pull', 'push'].includes(mode)) throw new Error('Usage: node scripts/api-sync.mjs <pull|push>');
if (!apiUrl) throw new Error('SCHEDULE_API_URL is required');
if (!Number.isInteger(eventBatchTargetBytes) || eventBatchTargetBytes < 10_000 || eventBatchTargetBytes > 1_250_000) {
  throw new Error('EVENT_IMPORT_BATCH_BYTES must be an integer between 10000 and 1250000');
}

if (mode === 'pull') {
  await mkdir(dataDirectory, { recursive: true });
  for (const dataset of [
    { route: 'events', file: 'events.json', label: 'event', required: true },
    { route: 'redemption-codes', file: 'redemption-codes.json', label: 'redemption code', required: false },
    { route: 'redemption-code-candidates', file: 'redemption-code-candidates.json', label: 'redemption code candidate', required: false },
    { route: 'characters', file: 'characters.json', label: 'character', required: false },
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
  const [events, characters, redemptionCodes, redemptionCodeCandidates, collectionStatus] = await Promise.all([
    readFile(path.join(dataDirectory, 'events.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dataDirectory, 'characters.json'), 'utf8').then(JSON.parse).catch(() => []),
    readFile(path.join(dataDirectory, 'redemption-codes.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dataDirectory, 'redemption-code-candidates.json'), 'utf8').then(JSON.parse).catch(() => []),
    readFile(path.join(dataDirectory, 'collection-status.json'), 'utf8').then(JSON.parse),
  ]);
  const runId = process.env.IMPORT_RUN_ID || randomUUID();
  const eventBatches = splitJsonArray(events, eventBatchTargetBytes);
  for (const [index, batch] of eventBatches.entries()) {
    const serialized = JSON.stringify(batch);
    const response = await postJsonWithRetry(`${apiUrl}/api/internal/event-imports/${encodeURIComponent(runId)}/batches`, token, {
      part: index + 1,
      totalParts: eventBatches.length,
      checksum: sha256(serialized),
      events: batch,
    });
    console.log(`Uploaded event batch ${index + 1}/${eventBatches.length}: ${Buffer.byteLength(serialized)} bytes, ${batch.length} event(s), response=${await response.text()}`);
  }
  const eventResponse = await postJsonWithRetry(`${apiUrl}/api/internal/event-imports/${encodeURIComponent(runId)}/finalize`, token, {
    totalParts: eventBatches.length,
    expectedEventCount: events.length,
    checksum: sha256(JSON.stringify(events)),
    redemptionCodes,
    collectionStatus,
  });
  const candidateResponse = await fetch(`${apiUrl}/api/internal/redemption-code-candidates/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(redemptionCodeCandidates),
    signal: AbortSignal.timeout(60_000),
  });
  if (!candidateResponse.ok) throw new Error(`Cannot publish redemption code candidates: HTTP ${candidateResponse.status} ${await candidateResponse.text()}`);
  const characterResponse = await fetch(`${apiUrl}/api/internal/characters/import`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(characters), signal: AbortSignal.timeout(60_000),
  });
  if (!characterResponse.ok) throw new Error(`Cannot publish characters: HTTP ${characterResponse.status} ${await characterResponse.text()}`);
  console.log(`Published schedules: ${await eventResponse.text()}`);
  console.log(`Published redemption code candidates: ${await candidateResponse.text()}`);
}

async function postJsonWithRetry(url, token, body) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) return response;
      const message = `HTTP ${response.status} ${await response.text()}`;
      if (response.status < 500) throw new NonRetryableHttpError(message);
      if (attempt === 3) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof NonRetryableHttpError) throw new Error(`Cannot publish JSON: ${error.message}`);
      lastError = error;
      if (attempt === 3) break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error(`Cannot publish JSON after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

class NonRetryableHttpError extends Error {}
