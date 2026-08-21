import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import { RedemptionCodeImportsService } from './redemption-code-imports.service';

@Controller('api/internal/redemption-code-imports')
@UseGuards(IngestAuthGuard)
export class RedemptionCodeImportsController {
  constructor(private readonly imports: RedemptionCodeImportsService) {}

  @Post(':runId/batches')
  storeBatch(@Param('runId') runId: string, @Body() body: unknown) {
    return this.imports.storeBatch(runId, body as Record<string, unknown>);
  }

  @Post(':runId/finalize')
  finalize(@Param('runId') runId: string, @Body() body: unknown) {
    return this.imports.finalize(runId, body as Record<string, unknown>);
  }
}
