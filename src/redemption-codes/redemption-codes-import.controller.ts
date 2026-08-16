import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import { validateRedemptionCodes } from './redemption-code-validator';
import { RedemptionCodesService } from './redemption-codes.service';

@Controller('api/internal/redemption-codes')
@UseGuards(IngestAuthGuard)
export class RedemptionCodesImportController {
  constructor(private readonly redemptionCodes: RedemptionCodesService) {}

  @Post('import')
  import(@Body() body: unknown) {
    return this.redemptionCodes.import(validateRedemptionCodes(body));
  }
}
