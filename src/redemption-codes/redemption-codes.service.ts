import { Injectable } from '@nestjs/common';
import type { RedemptionCode } from '../domain/redemption-code';
import { StorageService } from '../storage/storage.service';

const REDEMPTION_CODES_PATH = 'schedule-api/redemption-codes.json';
const KOREA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function koreaDate(value: Date): string {
  const parts = Object.fromEntries(KOREA_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

@Injectable()
export class RedemptionCodesService {
  constructor(private readonly storage: StorageService) {}

  async findAll(query: { gameId?: string; status?: string }): Promise<RedemptionCode[]> {
    const codes = await this.storage.readJson<RedemptionCode[]>(REDEMPTION_CODES_PATH);
    return codes.filter((code) => (!query.gameId || code.gameId === query.gameId) && (!query.status || code.status === query.status));
  }

  async findExpiringToday(query: { gameId?: string }, now = new Date()): Promise<RedemptionCode[]> {
    const today = koreaDate(now);
    const codes = await this.findAll(query);
    return codes.filter((code) => code.expiresAt !== null && koreaDate(new Date(code.expiresAt)) === today);
  }

  async findExpiring(query: { gameId?: string; withinHours: number }, now = new Date()): Promise<RedemptionCode[]> {
    const startsAfter = now.getTime();
    const endsAt = startsAfter + query.withinHours * 60 * 60 * 1000;
    const codes = await this.findAll(query);
    return codes
      .filter((code) => {
        if (code.expiresAt === null) return false;
        const expiresAt = Date.parse(code.expiresAt);
        return expiresAt > startsAfter && expiresAt <= endsAt;
      })
      .sort((left, right) => Date.parse(left.expiresAt!) - Date.parse(right.expiresAt!));
  }

  async import(codes: RedemptionCode[]): Promise<{ redemptionCodeCount: number; retrievedAt: string }> {
    await this.storage.writeJson(REDEMPTION_CODES_PATH, codes);
    const retrievedAt = codes.map((code) => code.retrievedAt).sort().at(-1) ?? new Date().toISOString();
    return { redemptionCodeCount: codes.length, retrievedAt };
  }
}
