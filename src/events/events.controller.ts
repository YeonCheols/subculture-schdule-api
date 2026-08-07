import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CollectionStatus, ScheduleEvent } from '../domain/event';
import { EventsQueryDto } from './dto/events-query.dto';
import { EventsService } from './events.service';

@Controller('api/v1')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('events')
  async findAll(@Query() query: EventsQueryDto, @Res({ passthrough: true }) response: Response): Promise<ScheduleEvent[]> {
    const events = await this.events.findAll(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return events;
  }

  @Get('collection-status')
  async getCollectionStatus(@Res({ passthrough: true }) response: Response): Promise<CollectionStatus> {
    const status = await this.events.getCollectionStatus();
    response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return status;
  }
}
