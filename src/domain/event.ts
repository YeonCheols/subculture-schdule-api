export const GAME_IDS = ['monster', 'wuthering', 'genshin'] as const;
export const EVENT_TYPES = ['event', 'update', 'maintenance', 'banner', 'broadcast', 'notice'] as const;
export const EVENT_STATUSES = ['upcoming', 'active', 'ended', 'unknown'] as const;
export const CONFIDENCES = ['confirmed', 'probable', 'unverified'] as const;

export type GameId = (typeof GAME_IDS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type Confidence = (typeof CONFIDENCES)[number];

export interface ScheduleEvent {
  id: string;
  gameId: GameId;
  type: EventType;
  title: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceLocale: string;
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sourceTimeText: string;
  status: EventStatus;
  confidence: Confidence;
  retrievedAt: string;
  version: string | null;
  summary: string;
}

export interface SourceCollectionStatus {
  id: string;
  ok: boolean;
  candidateCount: number;
  collectedEventCount: number;
  storedEventCount: number;
  error?: string;
}

export interface CollectionStatus {
  retrievedAt: string;
  eventCount: number;
  collectedEventCount: number;
  sources: SourceCollectionStatus[];
}
