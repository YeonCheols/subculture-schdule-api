import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { RedemptionCode } from '../domain/redemption-code';
import { RedemptionCodesQueryDto } from './dto/redemption-codes-query.dto';
import { RedemptionCodesService } from './redemption-codes.service';

@Controller('api/v1/redemption-codes')
export class RedemptionCodesController {
  constructor(private readonly redemptionCodes: RedemptionCodesService) {}

  @Get()
  async findAll(@Query() query: RedemptionCodesQueryDto, @Res({ passthrough: true }) response: Response): Promise<RedemptionCode[]> {
    const codes = await this.redemptionCodes.findAll(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return codes;
  }
}
