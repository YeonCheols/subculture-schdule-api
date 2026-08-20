import { IsIn, IsOptional, IsString } from 'class-validator';
import { GAME_IDS } from '../../domain/event';

export class EventsPageQueryDto {
  @IsIn(GAME_IDS)
  gameId!: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}
