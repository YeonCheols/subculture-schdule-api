import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RedemptionCode } from '../domain/redemption-code';
import { StorageService } from '../storage/storage.service';
import { validateRedemptionCodes } from './redemption-code-validator';
import { RedemptionCodesService } from './redemption-codes.service';

const MAX_BATCH_BYTES = 1_250_000;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface BatchBody {
  part?: unknown;
  totalParts?: unknown;
  checksum?: unknown;
  redemptionCodes?: unknown;
}

interface FinalizeBody {
  totalParts?: unknown;
  expectedRedemptionCodeCount?: unknown;
  checksum?: unknown;
}

interface StoredBatch {
  part: number;
  totalParts: number;
  checksum: string;
  redemptionCodes: RedemptionCode[];
}

interface CompletedImport {
  totalParts: number;
  expectedRedemptionCodeCount: number;
  checksum: string;
  result: { runId: string; totalParts: number; redemptionCodeCount: number; retrievedAt: string };
}

@Injectable()
export class RedemptionCodeImportsService {
  constructor(
    private readonly storage: StorageService,
    private readonly redemptionCodes: RedemptionCodesService,
  ) {}

  async storeBatch(runId: string, body: BatchBody) {
    validateRunId(runId);
    if (await this.storage.tryReadJson<CompletedImport>(completionPath(runId))) throw new BadRequestException('runId was already finalized');
    const part = positiveInteger(body.part, 'part');
    const totalParts = positiveInteger(body.totalParts, 'totalParts');
    if (part > totalParts) throw new BadRequestException('part must not exceed totalParts');
    const checksum = checksumValue(body.checksum);
    const codes = validateRedemptionCodes(body.redemptionCodes);
    const serialized = JSON.stringify(codes);
    const byteLength = Buffer.byteLength(serialized);
    if (byteLength > MAX_BATCH_BYTES) throw new BadRequestException(`redemption code batch exceeds ${MAX_BATCH_BYTES} bytes`);
    if (sha256(serialized) !== checksum) throw new BadRequestException('redemption code batch checksum does not match');

    await this.storage.writeJson(batchPath(runId, part), { part, totalParts, checksum, redemptionCodes: codes } satisfies StoredBatch);
    return { runId, part, totalParts, redemptionCodeCount: codes.length, byteLength, checksum };
  }

  async finalize(runId: string, body: FinalizeBody) {
    validateRunId(runId);
    const totalParts = positiveInteger(body.totalParts, 'totalParts');
    const expectedRedemptionCodeCount = nonNegativeInteger(body.expectedRedemptionCodeCount, 'expectedRedemptionCodeCount');
    const checksum = checksumValue(body.checksum);
    const completed = await this.storage.tryReadJson<CompletedImport>(completionPath(runId));
    if (completed) {
      if (completed.totalParts !== totalParts || completed.expectedRedemptionCodeCount !== expectedRedemptionCodeCount || completed.checksum !== checksum) {
        throw new BadRequestException('runId was already finalized with different metadata');
      }
      return { ...completed.result, temporaryBatchesDeleted: true };
    }

    const batches = await Promise.all(Array.from({ length: totalParts }, (_, index) => this.storage.readJson<StoredBatch>(batchPath(runId, index + 1))));
    batches.forEach((batch, index) => {
      const expectedPart = index + 1;
      if (batch.part !== expectedPart || batch.totalParts !== totalParts) throw new BadRequestException(`redemption code batch ${expectedPart} metadata does not match finalize request`);
      if (sha256(JSON.stringify(batch.redemptionCodes)) !== batch.checksum) throw new BadRequestException(`redemption code batch ${expectedPart} checksum does not match stored codes`);
    });
    const codes = validateRedemptionCodes(batches.flatMap((batch) => batch.redemptionCodes));
    if (codes.length !== expectedRedemptionCodeCount) throw new BadRequestException(`expected ${expectedRedemptionCodeCount} redemption codes but received ${codes.length}`);
    if (sha256(JSON.stringify(codes)) !== checksum) throw new BadRequestException('final redemption code checksum does not match');

    const imported = await this.redemptionCodes.import(codes);
    const result = { runId, totalParts, ...imported };
    await this.storage.writeJson(completionPath(runId), { totalParts, expectedRedemptionCodeCount, checksum, result } satisfies CompletedImport);
    const cleanup = await Promise.allSettled([this.storage.deleteFiles(Array.from({ length: totalParts }, (_, index) => batchPath(runId, index + 1)))]);
    return { ...result, temporaryBatchesDeleted: cleanup[0].status === 'fulfilled' };
  }
}

function batchPath(runId: string, part: number): string {
  return `schedule-api/redemption-code-imports/${runId}/parts/part-${String(part).padStart(4, '0')}.json`;
}

function completionPath(runId: string): string {
  return `schedule-api/redemption-code-imports/${runId}/completed.json`;
}

function validateRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new BadRequestException('runId contains unsupported characters');
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new BadRequestException(`${field} must be a non-negative integer`);
  return Number(value);
}

function checksumValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('checksum must be a SHA-256 hex digest');
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
