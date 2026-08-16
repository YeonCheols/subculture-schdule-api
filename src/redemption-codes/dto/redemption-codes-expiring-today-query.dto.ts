import { IsIn, IsOptional } from 'class-validator';
import { GAME_IDS } from '../../domain/event';

export class RedemptionCodesExpiringTodayQueryDto {
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: string;
}
