import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { RedemptionCode } from '../domain/redemption-code';
import { RedemptionCodesExpiringQueryDto } from './dto/redemption-codes-expiring-query.dto';
import { RedemptionCodesExpiringTodayQueryDto } from './dto/redemption-codes-expiring-today-query.dto';
import { RedemptionCodesQueryDto } from './dto/redemption-codes-query.dto';
import { RedemptionCodesService } from './redemption-codes.service';

@Controller('api/v1/redemption-codes')
export class RedemptionCodesController {
  constructor(private readonly redemptionCodes: RedemptionCodesService) {}

  @Get('expiring-today')
  async findExpiringToday(@Query() query: RedemptionCodesExpiringTodayQueryDto, @Res({ passthrough: true }) response: Response): Promise<RedemptionCode[]> {
    const codes = await this.redemptionCodes.findExpiringToday(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return codes;
  }

  @Get('expiring')
  async findExpiring(@Query() query: RedemptionCodesExpiringQueryDto, @Res({ passthrough: true }) response: Response): Promise<RedemptionCode[]> {
    const codes = await this.redemptionCodes.findExpiring(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return codes;
  }

  @Get()
  async findAll(@Query() query: RedemptionCodesQueryDto, @Res({ passthrough: true }) response: Response): Promise<RedemptionCode[]> {
    const codes = await this.redemptionCodes.findAll(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return codes;
  }
}
