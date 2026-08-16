import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RedemptionCodeCandidate } from '../domain/redemption-code';
import { StorageService } from '../storage/storage.service';
import { RedemptionCodesService } from './redemption-codes.service';

const PATH = 'schedule-api/redemption-code-candidates.json';

@Injectable()
export class RedemptionCodeCandidatesService {
  constructor(private readonly storage: StorageService, private readonly redemptionCodes: RedemptionCodesService) {}

  async findAll(query: { gameId?: string; status?: string }): Promise<RedemptionCodeCandidate[]> {
    const values = await this.storage.readJson<RedemptionCodeCandidate[]>(PATH);
    return values.filter((value) => (!query.gameId || value.gameId === query.gameId) && (!query.status || value.status === query.status));
  }

  async import(values: RedemptionCodeCandidate[]): Promise<{ redemptionCodeCandidateCount: number }> {
    await this.storage.writeJson(PATH, values);
    return { redemptionCodeCandidateCount: values.length };
  }

  async review(id: string, status: 'accepted' | 'rejected'): Promise<RedemptionCodeCandidate> {
    const values = await this.storage.readJson<RedemptionCodeCandidate[]>(PATH);
    const index = values.findIndex((value) => value.id === id);
    if (index < 0) throw new BadRequestException('candidate does not exist');
    values[index] = { ...values[index], status };
    await this.storage.writeJson(PATH, values);
    if (status === 'accepted') {
      const candidate = values[index];
      const existing = await this.redemptionCodes.findAll({});
      const key = `${candidate.gameId}:${candidate.candidateCode.toUpperCase()}`;
      if (!existing.some((code) => `${code.gameId}:${code.code.toUpperCase()}` === key)) {
        const digest = createHash('sha256').update(key).digest('hex').slice(0, 14);
        await this.redemptionCodes.import([...existing, {
          id: `${candidate.gameId}-code-${digest}`, gameId: candidate.gameId, code: candidate.candidateCode,
          region: null, distributionType: 'public', sourceTitle: candidate.sourceTitle, sourceUrl: candidate.sourceUrl,
          sourceLocale: candidate.sourceLocale, publishedAt: null, startsAt: null, expiresAt: null,
          sourceTimeText: 'OCR candidate accepted by reviewer', redemptionUrl: null, rewards: [], status: 'unknown',
          retrievedAt: candidate.discoveredAt, lastVerifiedAt: candidate.discoveredAt,
        }]);
      }
    }
    return values[index];
  }
}
