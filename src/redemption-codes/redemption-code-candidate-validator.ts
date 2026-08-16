import { BadRequestException } from '@nestjs/common';
import { GAME_IDS } from '../domain/event';
import type { RedemptionCodeCandidate } from '../domain/redemption-code';

const statuses = ['pending', 'accepted', 'rejected'] as const;
const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateRedemptionCodeCandidates(input: unknown): RedemptionCodeCandidate[] {
  if (!Array.isArray(input)) throw new BadRequestException('body must be a redemption code candidate array');
  const errors: string[] = [];
  const ids = new Set<string>();
  input.forEach((raw, index) => {
    const at = `redemptionCodeCandidates[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${at} must be an object`); return; }
    const value = raw as Record<string, unknown>;
    for (const field of ['id', 'candidateCode', 'sourceTitle', 'sourceUrl', 'sourceLocale', 'ocrText', 'discoveredAt']) {
      if (typeof value[field] !== 'string' || !(value[field] as string).trim()) errors.push(`${at}.${field} must be a non-empty string`);
    }
    if (!GAME_IDS.includes(value.gameId as never)) errors.push(`${at}.gameId is unsupported`);
    if (!statuses.includes(value.status as never)) errors.push(`${at}.status is unsupported`);
    if (value.mediaType !== 'official-image' && value.mediaType !== 'web-search-result') errors.push(`${at}.mediaType is unsupported`);
    if (typeof value.candidateCode === 'string' && !/^[A-Za-z0-9]{6,32}$/.test(value.candidateCode)) errors.push(`${at}.candidateCode has an invalid format`);
    if (value.imageUrl !== null && (typeof value.imageUrl !== 'string' || !value.imageUrl.startsWith('https://'))) errors.push(`${at}.imageUrl must be null or use https`);
    if (typeof value.sourceUrl === 'string' && !value.sourceUrl.startsWith('https://')) errors.push(`${at}.sourceUrl must use https`);
    if (typeof value.discoveredAt === 'string' && (!isoWithZone.test(value.discoveredAt) || Number.isNaN(Date.parse(value.discoveredAt)))) errors.push(`${at}.discoveredAt must be an ISO 8601 instant with timezone`);
    if (typeof value.id === 'string') { if (ids.has(value.id)) errors.push(`${at}.id duplicates ${value.id}`); ids.add(value.id); }
  });
  if (errors.length) throw new BadRequestException({ message: 'Invalid redemption code candidate data', errors });
  return input as RedemptionCodeCandidate[];
}
