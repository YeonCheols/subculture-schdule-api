import { IsIn, IsOptional } from 'class-validator';
import { GAME_IDS } from '../../domain/event';

export class RedemptionCodeCandidatesQueryDto {
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: string;

  @IsOptional()
  @IsIn(['pending', 'accepted', 'rejected'])
  status?: string;
}
