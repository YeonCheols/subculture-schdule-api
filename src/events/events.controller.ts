import { Controller, Get, Header, Query } from '@nestjs/common';
import type { CollectionStatus, ScheduleEvent } from '../domain/event';
import { EventsQueryDto } from './dto/events-query.dto';
import { EventsService } from './events.service';

@Controller('api/v1')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('events')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  findAll(@Query() query: EventsQueryDto): Promise<ScheduleEvent[]> {
    return this.events.findAll(query);
  }

  @Get('collection-status')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  getCollectionStatus(): Promise<CollectionStatus> {
    return this.events.getCollectionStatus();
  }
}
