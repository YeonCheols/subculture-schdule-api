import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { EVENT_STATUSES, GAME_IDS } from '../../domain/event';

export class EventsQueryDto {
  @IsOptional()
  @IsIn(GAME_IDS)
  gameId?: string;

  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}
