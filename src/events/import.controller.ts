import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { CollectionStatus } from '../domain/event';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import { validateEvents } from './event-validator';
import { EventsService } from './events.service';

interface ImportBody {
  events?: unknown;
  collectionStatus?: CollectionStatus;
}

@Controller('api/internal/events')
@UseGuards(IngestAuthGuard)
export class ImportController {
  constructor(private readonly eventsService: EventsService) {}

  @Post('import')
  import(@Body() body: ImportBody | unknown[]) {
    const isEnvelope = !Array.isArray(body) && body !== null && typeof body === 'object';
    const events = validateEvents(isEnvelope ? (body as ImportBody).events : body);
    const status = isEnvelope ? (body as ImportBody).collectionStatus : undefined;
    return this.eventsService.import(events, status);
  }
}
