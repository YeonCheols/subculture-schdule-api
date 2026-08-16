import { Injectable } from '@nestjs/common';
import type { RedemptionCode } from '../domain/redemption-code';
import { StorageService } from '../storage/storage.service';

const REDEMPTION_CODES_PATH = 'schedule-api/redemption-codes.json';

@Injectable()
export class RedemptionCodesService {
  constructor(private readonly storage: StorageService) {}

  async findAll(query: { gameId?: string; status?: string }): Promise<RedemptionCode[]> {
    const codes = await this.storage.readJson<RedemptionCode[]>(REDEMPTION_CODES_PATH);
    return codes.filter((code) => (!query.gameId || code.gameId === query.gameId) && (!query.status || code.status === query.status));
  }

  async import(codes: RedemptionCode[]): Promise<{ redemptionCodeCount: number; retrievedAt: string }> {
    await this.storage.writeJson(REDEMPTION_CODES_PATH, codes);
    const retrievedAt = codes.map((code) => code.retrievedAt).sort().at(-1) ?? new Date().toISOString();
    return { redemptionCodeCount: codes.length, retrievedAt };
  }
}
