import { createHash } from 'node:crypto';

export function splitJsonArray(values, maxBytes) {
  if (!Array.isArray(values)) throw new Error('event data must be an array');
  if (values.length === 0) return [[]];
  const batches = [];
  let batch = [];
  let bytes = 2;
  for (const value of values) {
    const serialized = JSON.stringify(value);
    const valueBytes = Buffer.byteLength(serialized);
    if (valueBytes + 2 > maxBytes) throw new Error(`A single event exceeds the ${maxBytes}-byte batch target`);
    const additionalBytes = valueBytes + (batch.length ? 1 : 0);
    if (batch.length && bytes + additionalBytes > maxBytes) {
      batches.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(value);
    bytes += valueBytes + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
