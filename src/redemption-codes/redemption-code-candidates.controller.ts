import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IngestAuthGuard } from '../auth/ingest-auth.guard';
import type { RedemptionCodeCandidate } from '../domain/redemption-code';
import { validateRedemptionCodeCandidates } from './redemption-code-candidate-validator';
import { RedemptionCodeCandidatesService } from './redemption-code-candidates.service';
import { RedemptionCodeCandidatesQueryDto } from './dto/redemption-code-candidates-query.dto';

@Controller()
export class RedemptionCodeCandidatesController {
  constructor(private readonly candidates: RedemptionCodeCandidatesService) {}

  @Get('api/v1/redemption-code-candidates')
  async findAll(@Query() query: RedemptionCodeCandidatesQueryDto, @Res({ passthrough: true }) response: Response): Promise<RedemptionCodeCandidate[]> {
    const values = await this.candidates.findAll(query);
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return values;
  }

  @Post('api/internal/redemption-code-candidates/import')
  @UseGuards(IngestAuthGuard)
  import(@Body() body: unknown) { return this.candidates.import(validateRedemptionCodeCandidates(body)); }

  @Patch('api/internal/redemption-code-candidates/:id')
  @UseGuards(IngestAuthGuard)
  review(@Param('id') id: string, @Body() body: { status?: string }) {
    if (body.status !== 'accepted' && body.status !== 'rejected') throw new BadRequestException('status must be accepted or rejected');
    return this.candidates.review(id, body.status);
  }
}
