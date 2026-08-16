import { BadRequestException } from '@nestjs/common';
import {
  BANNER_KINDS,
  BANNER_PHASES,
  BANNER_EXTRACTION_METHODS,
  CONFIDENCES,
  EVENT_STATUSES,
  EVENT_TYPES,
  GAME_IDS,
  type ScheduleEvent,
} from '../domain/event';

const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const requiredStrings = ['id', 'gameId', 'type', 'title', 'sourceTitle', 'sourceUrl', 'sourceLocale', 'sourceTimeText', 'status', 'confidence', 'retrievedAt'] as const;
const instantFields = ['publishedAt', 'startsAt', 'endsAt', 'retrievedAt'] as const;

export function validateEvents(input: unknown): ScheduleEvent[] {
  if (!Array.isArray(input)) throw new BadRequestException('body must be an event array');
  const errors: string[] = [];
  const ids = new Set<string>();

  input.forEach((value, index) => {
    const at = `events[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const event = value as Record<string, unknown>;
    for (const field of requiredStrings) {
      if (typeof event[field] !== 'string' || (field !== 'sourceTimeText' && !(event[field] as string).trim())) {
        errors.push(`${at}.${field} must be a non-empty string`);
      }
    }
    if (!GAME_IDS.includes(event.gameId as never)) errors.push(`${at}.gameId is unsupported`);
    if (!EVENT_TYPES.includes(event.type as never)) errors.push(`${at}.type is unsupported`);
    if (!EVENT_STATUSES.includes(event.status as never)) errors.push(`${at}.status is unsupported`);
    if (!CONFIDENCES.includes(event.confidence as never)) errors.push(`${at}.confidence is unsupported`);
    if (typeof event.sourceUrl === 'string' && !event.sourceUrl.startsWith('https://')) errors.push(`${at}.sourceUrl must use https`);
    for (const field of instantFields) {
      const instant = event[field];
      if (instant != null && (typeof instant !== 'string' || !isoWithZone.test(instant) || Number.isNaN(Date.parse(instant)))) {
        errors.push(`${at}.${field} must be null or an ISO 8601 instant with timezone`);
      }
    }
    if (typeof event.startsAt === 'string' && typeof event.endsAt === 'string' && Date.parse(event.startsAt) > Date.parse(event.endsAt)) {
      errors.push(`${at}.endsAt precedes startsAt`);
    }
    if (typeof event.id === 'string') {
      if (ids.has(event.id)) errors.push(`${at}.id duplicates ${event.id}`);
      ids.add(event.id);
    }
    validateBanners(event.banners, at, errors);
  });

  if (errors.length) throw new BadRequestException({ message: 'Invalid event data', errors });
  return input as ScheduleEvent[];
}

function validateBanners(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${at}.banners must be an array`);
    return;
  }
  value.forEach((rawBanner, bannerIndex) => {
    const bannerAt = `${at}.banners[${bannerIndex}]`;
    if (!rawBanner || typeof rawBanner !== 'object' || Array.isArray(rawBanner)) {
      errors.push(`${bannerAt} must be an object`);
      return;
    }
    const banner = rawBanner as Record<string, unknown>;
    if (typeof banner.name !== 'string' || !banner.name.trim()) errors.push(`${bannerAt}.name must be a non-empty string`);
    if (!BANNER_KINDS.includes(banner.kind as never)) errors.push(`${bannerAt}.kind is unsupported`);
    if (!BANNER_PHASES.includes(banner.phase as never)) errors.push(`${bannerAt}.phase is unsupported`);
    validateFeaturedTargets(banner.featuredCharacters, `${bannerAt}.featuredCharacters`, errors);
    validateFeaturedTargets(banner.featuredWeapons, `${bannerAt}.featuredWeapons`, errors);
    if (banner.sourceImageUrls !== undefined && (!Array.isArray(banner.sourceImageUrls) || banner.sourceImageUrls.some((url) => typeof url !== 'string' || !url.startsWith('https://')))) {
      errors.push(`${bannerAt}.sourceImageUrls must contain only HTTPS URLs`);
    }
    if (banner.ocrText !== undefined && banner.ocrText !== null && typeof banner.ocrText !== 'string') errors.push(`${bannerAt}.ocrText must be a string or null`);
  });
}

function validateFeaturedTargets(value: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${at} must be an array`);
    return;
  }
  value.forEach((rawTarget, index) => {
    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
      errors.push(`${at}[${index}] must be an object`);
      return;
    }
    const target = rawTarget as Record<string, unknown>;
    if (typeof target.name !== 'string' || !target.name.trim()) errors.push(`${at}[${index}].name must be a non-empty string`);
    if (target.rarity !== null && target.rarity !== 4 && target.rarity !== 5) errors.push(`${at}[${index}].rarity must be 4, 5, or null`);
    if (target.extractionMethod !== undefined && !BANNER_EXTRACTION_METHODS.includes(target.extractionMethod as never)) errors.push(`${at}[${index}].extractionMethod is unsupported`);
    if (target.confidence !== undefined && !CONFIDENCES.includes(target.confidence as never)) errors.push(`${at}[${index}].confidence is unsupported`);
    if (target.extractionMethod === 'official-image-ocr' && target.confidence !== 'unverified') errors.push(`${at}[${index}].confidence must be unverified for OCR`);
  });
}
