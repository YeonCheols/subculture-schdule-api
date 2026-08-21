import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { GamesResponse } from './game-catalog';
import { GamesService } from './games.service';

@Controller('api/v1')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('games')
  findAll(@Res({ passthrough: true }) response: Response): GamesResponse {
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return this.games.findAll();
  }
}
