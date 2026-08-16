import { IsIn, IsOptional } from 'class-validator';
import { GAME_IDS } from '../../domain/event';
import { REDEMPTION_CODE_STATUSES } from '../../domain/redemption-code';

export class RedemptionCodesQueryDto {
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: string;

  @IsOptional()
  @IsIn(REDEMPTION_CODE_STATUSES)
  status?: string;
}
