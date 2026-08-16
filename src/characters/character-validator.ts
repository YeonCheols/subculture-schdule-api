import { BadRequestException } from '@nestjs/common';
import { GAME_IDS } from '../domain/event';
import type { GameCharacter } from '../domain/character';

const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateCharacters(input: unknown): GameCharacter[] {
  if (!Array.isArray(input)) throw new BadRequestException('body must be a character array');
  const errors: string[] = [];
  const ids = new Set<string>();
  input.forEach((value, index) => {
    const at = `characters[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${at} must be an object`); return; }
    const character = value as Record<string, unknown>;
    for (const field of ['id', 'gameId', 'name', 'sourceTitle', 'sourceUrl', 'sourceLocale', 'summary', 'retrievedAt']) {
      if (typeof character[field] !== 'string' || (field !== 'summary' && !(character[field] as string).trim())) errors.push(`${at}.${field} must be a non-empty string`);
    }
    if (!GAME_IDS.includes(character.gameId as never)) errors.push(`${at}.gameId is unsupported`);
    if (typeof character.sourceUrl === 'string' && !character.sourceUrl.startsWith('https://')) errors.push(`${at}.sourceUrl must use https`);
    for (const field of ['publishedAt', 'retrievedAt']) {
      const instant = character[field];
      if (instant != null && (typeof instant !== 'string' || !isoWithZone.test(instant) || Number.isNaN(Date.parse(instant)))) errors.push(`${at}.${field} must be null or a zoned ISO instant`);
    }
    if (!Array.isArray(character.imageUrls) || character.imageUrls.some((url) => typeof url !== 'string' || !url.startsWith('https://'))) errors.push(`${at}.imageUrls must contain only HTTPS URLs`);
    if (typeof character.id === 'string') { if (ids.has(character.id)) errors.push(`${at}.id duplicates ${character.id}`); ids.add(character.id); }
  });
  if (errors.length) throw new BadRequestException({ message: 'Invalid character data', errors });
  return input as GameCharacter[];
}
