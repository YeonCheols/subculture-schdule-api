export const GAME_IDS = ['monster', 'wuthering', 'genshin'] as const;
export const EVENT_TYPES = ['event', 'update', 'maintenance', 'banner', 'broadcast', 'notice'] as const;
export const EVENT_STATUSES = ['upcoming', 'active', 'ended', 'unknown'] as const;
export const CONFIDENCES = ['confirmed', 'probable', 'unverified'] as const;
export const BANNER_KINDS = ['character', 'weapon', 'mixed'] as const;
export const BANNER_PHASES = ['first', 'second', 'unknown'] as const;
export const BANNER_EXTRACTION_METHODS = ['official-text', 'official-image-ocr'] as const;

export type GameId = (typeof GAME_IDS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type Confidence = (typeof CONFIDENCES)[number];
export type BannerKind = (typeof BANNER_KINDS)[number];
export type BannerPhase = (typeof BANNER_PHASES)[number];
export type BannerExtractionMethod = (typeof BANNER_EXTRACTION_METHODS)[number];

export interface FeaturedBannerTarget {
  name: string;
  rarity: 4 | 5 | null;
  extractionMethod?: BannerExtractionMethod;
  confidence?: Confidence;
}

export interface EventBanner {
  name: string;
  kind: BannerKind;
  phase: BannerPhase;
  featuredCharacters: FeaturedBannerTarget[];
  featuredWeapons: FeaturedBannerTarget[];
  sourceImageUrls?: string[];
  ocrText?: string | null;
}

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
  banners?: EventBanner[];
}

export interface SourceCollectionStatus {
  id: string;
  ok: boolean;
  candidateCount: number;
  collectedEventCount: number;
  storedEventCount: number;
  collectedRedemptionCodeCount?: number;
  storedRedemptionCodeCount?: number;
  collectedRedemptionCodeCandidateCount?: number;
  searchDiscovery?: { skipped: boolean; candidateCount: number; errors: string[] };
  ocrErrors?: string[];
  candidateDiagnostics?: Array<{
    title: string;
    sourceUrl: string;
    outcome: 'collected' | 'excluded';
    reason?: 'detail-render-failed' | 'missing-explicit-schedule-time';
    warnings?: string[];
  }>;
  error?: string;
}

export interface CollectionStatus {
  retrievedAt: string;
  eventCount: number;
  collectedEventCount: number;
  redemptionCodeCount?: number;
  collectedRedemptionCodeCount?: number;
  redemptionCodeCandidateCount?: number;
  collectedRedemptionCodeCandidateCount?: number;
  sources: SourceCollectionStatus[];
}
