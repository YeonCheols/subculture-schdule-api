import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { CollectionStatus } from '../domain/event';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import { validateEvents } from './event-validator';
import { EventsService } from './events.service';
import { validateRedemptionCodes } from '../redemption-codes/redemption-code-validator';
import { RedemptionCodesService } from '../redemption-codes/redemption-codes.service';

interface ImportBody {
  events?: unknown;
  collectionStatus?: CollectionStatus;
  redemptionCodes?: unknown;
}

@Controller('api/internal/events')
@UseGuards(IngestAuthGuard)
export class ImportController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly redemptionCodesService: RedemptionCodesService,
  ) {}

  @Post('import')
  import(@Body() body: ImportBody | unknown[]) {
    const isEnvelope = !Array.isArray(body) && body !== null && typeof body === 'object';
    const envelope = isEnvelope ? body as ImportBody : undefined;
    const events = validateEvents(envelope ? envelope.events : body);
    const status = envelope?.collectionStatus;
    if (envelope?.redemptionCodes === undefined) return this.eventsService.import(events, status);
    const redemptionCodes = validateRedemptionCodes(envelope.redemptionCodes);
    return Promise.all([
      this.eventsService.import(events, status),
      this.redemptionCodesService.import(redemptionCodes),
    ]).then(([eventResult, codeResult]) => ({ ...eventResult, ...codeResult }));
  }
}
