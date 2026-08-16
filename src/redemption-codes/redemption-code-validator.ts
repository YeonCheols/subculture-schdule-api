import { BadRequestException } from '@nestjs/common';
import { GAME_IDS } from '../domain/event';
import {
  REDEMPTION_CODE_STATUSES,
  REDEMPTION_DISTRIBUTION_TYPES,
  type RedemptionCode,
} from '../domain/redemption-code';

const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const requiredStrings = ['id', 'gameId', 'code', 'distributionType', 'sourceTitle', 'sourceUrl', 'sourceLocale', 'sourceTimeText', 'status', 'retrievedAt'] as const;
const instantFields = ['publishedAt', 'startsAt', 'expiresAt', 'retrievedAt'] as const;

export function validateRedemptionCodes(input: unknown): RedemptionCode[] {
  if (!Array.isArray(input)) throw new BadRequestException('body must be a redemption code array');
  const errors: string[] = [];
  const ids = new Set<string>();
  const logicalCodes = new Set<string>();

  input.forEach((value, index) => {
    const at = `redemptionCodes[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const code = value as Record<string, unknown>;
    for (const field of requiredStrings) {
      if (typeof code[field] !== 'string' || (field !== 'sourceTimeText' && !(code[field] as string).trim())) {
        errors.push(`${at}.${field} must be a non-empty string`);
      }
    }
    if (!GAME_IDS.includes(code.gameId as never)) errors.push(`${at}.gameId is unsupported`);
    if (!REDEMPTION_DISTRIBUTION_TYPES.includes(code.distributionType as never)) errors.push(`${at}.distributionType is unsupported`);
    if (!REDEMPTION_CODE_STATUSES.includes(code.status as never)) errors.push(`${at}.status is unsupported`);
    if (typeof code.code === 'string' && !/^[A-Za-z0-9]{6,32}$/.test(code.code)) errors.push(`${at}.code has an invalid format`);
    if (typeof code.sourceUrl === 'string' && !code.sourceUrl.startsWith('https://')) errors.push(`${at}.sourceUrl must use https`);
    if (code.redemptionUrl !== null && (typeof code.redemptionUrl !== 'string' || !code.redemptionUrl.startsWith('https://'))) {
      errors.push(`${at}.redemptionUrl must be null or use https`);
    }
    if (code.region !== null && (typeof code.region !== 'string' || !code.region.trim())) errors.push(`${at}.region must be null or a non-empty string`);
    if (!Array.isArray(code.rewards) || code.rewards.some((reward) => typeof reward !== 'string' || !reward.trim())) errors.push(`${at}.rewards must be a string array`);
    if (code.contentHash !== undefined && (typeof code.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(code.contentHash))) errors.push(`${at}.contentHash must be a SHA-256 hex string`);
    if (code.lastVerifiedAt !== undefined && (typeof code.lastVerifiedAt !== 'string' || !isoWithZone.test(code.lastVerifiedAt) || Number.isNaN(Date.parse(code.lastVerifiedAt)))) errors.push(`${at}.lastVerifiedAt must be an ISO 8601 instant with timezone`);
    if (code.changeHistory !== undefined && !Array.isArray(code.changeHistory)) errors.push(`${at}.changeHistory must be an array`);
    for (const field of instantFields) {
      const instant = code[field];
      if (instant != null && (typeof instant !== 'string' || !isoWithZone.test(instant) || Number.isNaN(Date.parse(instant)))) {
        errors.push(`${at}.${field} must be null or an ISO 8601 instant with timezone`);
      }
    }
    if (typeof code.startsAt === 'string' && typeof code.expiresAt === 'string' && Date.parse(code.startsAt) > Date.parse(code.expiresAt)) {
      errors.push(`${at}.expiresAt precedes startsAt`);
    }
    if (typeof code.id === 'string') {
      if (ids.has(code.id)) errors.push(`${at}.id duplicates ${code.id}`);
      ids.add(code.id);
    }
    if (typeof code.gameId === 'string' && typeof code.code === 'string') {
      const key = `${code.gameId}:${code.code.toUpperCase()}`;
      if (logicalCodes.has(key)) errors.push(`${at}.code duplicates ${code.code}`);
      logicalCodes.add(key);
    }
  });

  if (errors.length) throw new BadRequestException({ message: 'Invalid redemption code data', errors });
  return input as RedemptionCode[];
}
