import { BadGatewayException, BadRequestException, GatewayTimeoutException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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

export interface StoredRedemptionCodeBatch {
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

interface BatchMetadata {
  part: number;
  totalParts: number;
  redemptionCodeCount: number;
  byteLength: number;
  checksum: string;
  uploadedAt: string;
}

export interface RedemptionCodeImportManifest {
  version: 1;
  runId: string;
  status: 'uploading' | 'completed';
  createdAt: string;
  updatedAt: string;
  totalParts: number;
  uploadedParts: BatchMetadata[];
  result?: CompletedImport['result'];
  temporaryBatchesDeleted?: boolean;
}

@Injectable()
export class RedemptionCodeImportsService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(RedemptionCodesService) private readonly redemptionCodes: RedemptionCodesService,
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

    const now = new Date().toISOString();
    const previous = await this.storage.tryReadJson<RedemptionCodeImportManifest>(manifestPath(runId));
    if (previous && previous.totalParts !== totalParts) throw new BadRequestException('totalParts does not match the existing import');
    await this.storage.writeJson(batchPath(runId, part), { part, totalParts, checksum, redemptionCodes: codes } satisfies StoredRedemptionCodeBatch);
    const metadata = { part, totalParts, redemptionCodeCount: codes.length, byteLength, checksum, uploadedAt: now };
    const uploadedParts = [...(previous?.uploadedParts ?? []).filter((item) => item.part !== part), metadata].sort((left, right) => left.part - right.part);
    await this.storage.writeJson(manifestPath(runId), {
      version: 1, runId, status: 'uploading', createdAt: previous?.createdAt ?? now, updatedAt: now, totalParts, uploadedParts,
    } satisfies RedemptionCodeImportManifest);
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

    const batches = await Promise.all(Array.from({ length: totalParts }, (_, index) => this.storage.readJson<StoredRedemptionCodeBatch>(batchPath(runId, index + 1))));
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
    const temporaryBatchesDeleted = cleanup[0].status === 'fulfilled';
    const previous = await this.storage.tryReadJson<RedemptionCodeImportManifest>(manifestPath(runId));
    const now = new Date().toISOString();
    await this.storage.writeJson(manifestPath(runId), {
      version: 1, runId, status: 'completed', createdAt: previous?.createdAt ?? now, updatedAt: now, totalParts,
      uploadedParts: previous?.uploadedParts ?? [], result, temporaryBatchesDeleted,
    } satisfies RedemptionCodeImportManifest);
    return { ...result, temporaryBatchesDeleted };
  }

  async listRuns(): Promise<RedemptionCodeImportManifest[]> {
    if (adminReadProxyUrl()) return this.readAdminProxyJson<RedemptionCodeImportManifest[]>('/api/internal/admin/redemption-code-imports');
    const files = await this.storage.listFiles('schedule-api/redemption-code-imports/');
    const runIds = [...new Set(files.map((file) => file.pathname.split('/')[2]).filter(Boolean))];
    const runs = await Promise.all(runIds.map((runId) => this.getRun(runId)));
    return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getRun(runId: string): Promise<RedemptionCodeImportManifest> {
    validateRunId(runId);
    if (adminReadProxyUrl()) return this.readAdminProxyJson<RedemptionCodeImportManifest>(`/api/internal/admin/redemption-code-imports/${encodeURIComponent(runId)}`);
    const manifest = await this.storage.tryReadJson<RedemptionCodeImportManifest>(manifestPath(runId));
    if (manifest) return manifest;
    const completed = await this.storage.tryReadJson<CompletedImport>(completionPath(runId));
    if (completed) {
      const files = await this.storage.listFiles(`schedule-api/redemption-code-imports/${runId}/`);
      const updatedAt = files[0]?.uploadedAt ?? completed.result.retrievedAt;
      return {
        version: 1, runId, status: 'completed', createdAt: updatedAt, updatedAt, totalParts: completed.totalParts,
        uploadedParts: [], result: completed.result, temporaryBatchesDeleted: true,
      };
    }
    const files = await this.storage.listFiles(`schedule-api/redemption-code-imports/${runId}/parts/`);
    if (!files.length) await this.storage.readJson(manifestPath(runId));
    const batches = await Promise.all(files.map((file) => this.storage.readJson<StoredRedemptionCodeBatch>(file.pathname).then((batch) => ({
      part: batch.part, totalParts: batch.totalParts, redemptionCodeCount: batch.redemptionCodes.length,
      byteLength: file.size, checksum: batch.checksum, uploadedAt: file.uploadedAt,
    }))));
    const updatedAt = files[0].uploadedAt;
    return {
      version: 1, runId, status: 'uploading', createdAt: files.at(-1)?.uploadedAt ?? updatedAt, updatedAt,
      totalParts: batches[0].totalParts, uploadedParts: batches.sort((left, right) => left.part - right.part),
    };
  }

  async getBatch(runId: string, partValue: string): Promise<StoredRedemptionCodeBatch> {
    validateRunId(runId);
    const part = positiveInteger(Number(partValue), 'part');
    if (adminReadProxyUrl()) return this.readAdminProxyJson<StoredRedemptionCodeBatch>(`/api/internal/admin/redemption-code-imports/${encodeURIComponent(runId)}/batches/${part}`);
    return this.storage.readJson<StoredRedemptionCodeBatch>(batchPath(runId, part));
  }

  private async readAdminProxyJson<T>(pathname: string): Promise<T> {
    const baseUrl = adminReadProxyUrl();
    const token = process.env.ADMIN_TOKEN;
    if (!baseUrl || !token) throw new BadGatewayException('admin read proxy is not configured');
    try {
      const response = await fetch(new URL(pathname, baseUrl), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) throw new NotFoundException('upstream import record was not found');
      if (!response.ok) throw new BadGatewayException(`admin read proxy returned ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadGatewayException) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new GatewayTimeoutException('admin read proxy timed out');
      throw new BadGatewayException('admin read proxy request failed');
    }
  }
}

function batchPath(runId: string, part: number): string {
  return `schedule-api/redemption-code-imports/${runId}/parts/part-${String(part).padStart(4, '0')}.json`;
}

function completionPath(runId: string): string {
  return `schedule-api/redemption-code-imports/${runId}/completed.json`;
}

function manifestPath(runId: string): string {
  return `schedule-api/redemption-code-imports/${runId}/manifest.json`;
}

function adminReadProxyUrl(): string | undefined {
  if (process.env.VERCEL) return undefined;
  const value = process.env.ADMIN_READ_PROXY_URL;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
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
