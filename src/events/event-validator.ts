import { BadRequestException } from '@nestjs/common';
import {
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
  });

  if (errors.length) throw new BadRequestException({ message: 'Invalid event data', errors });
  return input as ScheduleEvent[];
}
