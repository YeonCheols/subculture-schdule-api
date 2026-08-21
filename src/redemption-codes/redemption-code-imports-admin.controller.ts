import { Controller, Get, Header, Inject, Param, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { RedemptionCodeImportsService } from './redemption-code-imports.service';

@Controller('api/internal/admin/redemption-code-imports')
@UseGuards(AdminAuthGuard)
export class RedemptionCodeImportsAdminController {
  constructor(@Inject(RedemptionCodeImportsService) private readonly imports: RedemptionCodeImportsService) {}

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
