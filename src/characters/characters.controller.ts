import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { GameCharacter } from '../domain/character';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import { validateCharacters } from './character-validator';
import { CharactersService } from './characters.service';
import { CharactersQueryDto } from './dto/characters-query.dto';

@Controller()
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}
  @Get('api/v1/characters')
  async findAll(@Query() query: CharactersQueryDto, @Res({ passthrough: true }) response: Response): Promise<GameCharacter[]> {
    const values = await this.characters.findAll(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return values;
  }
  @Post('api/internal/characters/import')
  @UseGuards(IngestAuthGuard)
  import(@Body() body: unknown) { return this.characters.import(validateCharacters(body)); }
}
