#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv[2];
const apiUrl = process.env.SCHEDULE_API_URL?.replace(/\/$/, '');
const dataDirectory = path.resolve(import.meta.dirname, '../data/schedule-api');

if (!['pull', 'push'].includes(mode)) throw new Error('Usage: node scripts/api-sync.mjs <pull|push>');
if (!apiUrl) throw new Error('SCHEDULE_API_URL is required');

if (mode === 'pull') {
  const response = await fetch(`${apiUrl}/api/v1/events`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    console.log('Remote event history is empty; using the repository seed data.');
    process.exit(0);
  }
  if (!response.ok) throw new Error(`Cannot download current events: HTTP ${response.status} ${await response.text()}`);
  const events = await response.json();
  if (!Array.isArray(events)) throw new Error('Remote events response must be an array');
  await mkdir(dataDirectory, { recursive: true });
  const target = path.join(dataDirectory, 'events.json');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`);
  await rename(temporary, target);
  console.log(`Downloaded ${events.length} existing event(s).`);
}

if (mode === 'push') {
  const token = process.env.INGEST_TOKEN;
  if (!token) throw new Error('INGEST_TOKEN is required');
  const [events, collectionStatus] = await Promise.all([
    readFile(path.join(dataDirectory, 'events.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dataDirectory, 'collection-status.json'), 'utf8').then(JSON.parse),
  ]);
  const response = await fetch(`${apiUrl}/api/internal/events/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events, collectionStatus }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Cannot publish schedules: HTTP ${response.status} ${await response.text()}`);
  console.log(`Published schedules: ${await response.text()}`);
}
