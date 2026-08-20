import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventsPageQueryDto } from './dto/events-page-query.dto';
import { EventsService, type EventsPageResponse } from './events.service';

@Controller('api/v2')
export class EventsV2Controller {
  constructor(private readonly events: EventsService) {}

  @Get('events')
  async findPage(@Query() query: EventsPageQueryDto, @Res({ passthrough: true }) response: Response): Promise<EventsPageResponse> {
    const page = await this.events.findPage(query.gameId, query.cursor);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return page;
  }
}
