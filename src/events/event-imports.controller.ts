import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import { EventImportsService } from './event-imports.service';

@Controller('api/internal/event-imports')
@UseGuards(IngestAuthGuard)
export class EventImportsController {
  constructor(private readonly imports: EventImportsService) {}

  @Post(':runId/batches')
  storeBatch(@Param('runId') runId: string, @Body() body: unknown) {
    return this.imports.storeBatch(runId, body as Record<string, unknown>);
  }

  @Post(':runId/finalize')
  finalize(@Param('runId') runId: string, @Body() body: unknown) {
    return this.imports.finalize(runId, body as Record<string, unknown>);
  }

  @Post(':runId/failure')
  recordFailure(@Param('runId') runId: string, @Body() body: unknown) {
    return this.imports.recordFailure(runId, body as Record<string, unknown>);
  }
}
