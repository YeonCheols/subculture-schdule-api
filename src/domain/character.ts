import type { GameId } from './event';

export interface GameCharacter {
  id: string;
  gameId: GameId;
  name: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceLocale: string;
  publishedAt: string | null;
  summary: string;
  imageUrls: string[];
  retrievedAt: string;
}
