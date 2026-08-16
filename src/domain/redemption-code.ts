import type { GameId } from './event';

export const REDEMPTION_CODE_STATUSES = ['active', 'expired', 'unknown'] as const;
export const REDEMPTION_DISTRIBUTION_TYPES = ['public'] as const;

export type RedemptionCodeStatus = (typeof REDEMPTION_CODE_STATUSES)[number];
export type RedemptionDistributionType = (typeof REDEMPTION_DISTRIBUTION_TYPES)[number];

export interface RedemptionCode {
  id: string;
  gameId: GameId;
  code: string;
  region: string | null;
  distributionType: RedemptionDistributionType;
  sourceTitle: string;
  sourceUrl: string;
  sourceLocale: string;
  publishedAt: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  sourceTimeText: string;
  redemptionUrl: string | null;
  rewards: string[];
  status: RedemptionCodeStatus;
  retrievedAt: string;
  contentHash?: string;
  lastVerifiedAt?: string;
  changeHistory?: Array<{
    detectedAt: string;
    previousHash: string;
    currentHash: string;
  }>;
}

export interface RedemptionCodeCandidate {
  id: string;
  gameId: GameId;
  candidateCode: string;
  status: 'pending' | 'accepted' | 'rejected';
  sourceTitle: string;
  sourceUrl: string;
  sourceLocale: string;
  imageUrl: string | null;
  mediaType: 'official-image' | 'web-search-result';
  ocrText: string;
  discoveredAt: string;
}
