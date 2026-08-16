import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { GAME_IDS } from '../../domain/event';

export class RedemptionCodesExpiringQueryDto {
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  withinHours = 24;
}
