import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { EventImportsService } from './event-imports.service';

@Controller('api/internal/admin/event-imports')
@UseGuards(AdminAuthGuard)
export class EventImportsAdminController {
  constructor(private readonly imports: EventImportsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  listRuns() {
    return this.imports.listRuns();
  }

  @Get(':runId')
  @Header('Cache-Control', 'private, no-store')
  getRun(@Param('runId') runId: string) {
    return this.imports.getRun(runId);
  }

  @Get(':runId/batches/:part')
  @Header('Cache-Control', 'private, no-store')
  getBatch(@Param('runId') runId: string, @Param('part') part: string) {
    return this.imports.getBatch(runId, part);
  }
}
