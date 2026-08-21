import { BadGatewayException, BadRequestException, GatewayTimeoutException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CollectionStatus, ScheduleEvent } from '../domain/event';
import { StorageService } from '../storage/storage.service';
import { validateEvents } from './event-validator';
import { EventsService, type EventPagesManifest } from './events.service';

const MAX_BATCH_BYTES = 1_250_000;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface EventBatchBody {
  part?: unknown;
  totalParts?: unknown;
  checksum?: unknown;
  events?: unknown;
}

interface FinalizeBody {
  totalParts?: unknown;
  expectedEventCount?: unknown;
  checksum?: unknown;
  collectionStatus?: CollectionStatus;
}

export interface StoredEventBatch {
  part: number;
  totalParts: number;
  checksum: string;
  events: ScheduleEvent[];
}

interface EventBatchMetadata {
  part: number;
  totalParts: number;
  eventCount: number;
  byteLength: number;
  checksum: string;
  uploadedAt: string;
}

export interface EventImportManifest {
  version: 1;
  runId: string;
  status: 'uploading' | 'completed';
  createdAt: string;
  updatedAt: string;
  totalParts: number;
  uploadedParts: EventBatchMetadata[];
  result?: CompletedEventImport['result'];
  temporaryBatchesDeleted?: boolean;
}

interface CompletedEventImport {
  totalParts: number;
  expectedEventCount: number;
  checksum: string;
  result: {
    runId: string;
    totalParts: number;
    eventCount: number;
    retrievedAt: string;
  };
}

@Injectable()
export class EventImportsService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(EventsService) private readonly eventsService: EventsService,
  ) {}

  async storeBatch(runId: string, body: EventBatchBody) {
    validateRunId(runId);
    if (await this.storage.tryReadJson<CompletedEventImport>(completionPath(runId))) throw new BadRequestException('runId was already finalized');
    const part = positiveInteger(body.part, 'part');
    const totalParts = positiveInteger(body.totalParts, 'totalParts');
    if (part > totalParts) throw new BadRequestException('part must not exceed totalParts');
    if (typeof body.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(body.checksum)) throw new BadRequestException('checksum must be a SHA-256 hex digest');
    const events = validateEvents(body.events);
    const serialized = JSON.stringify(events);
    const byteLength = Buffer.byteLength(serialized);
    if (byteLength > MAX_BATCH_BYTES) throw new BadRequestException(`event batch exceeds ${MAX_BATCH_BYTES} bytes`);
    if (sha256(serialized) !== body.checksum) throw new BadRequestException('event batch checksum does not match');

    const now = new Date().toISOString();
    const previous = await this.storage.tryReadJson<EventImportManifest>(manifestPath(runId));
    if (previous && previous.totalParts !== totalParts) throw new BadRequestException('totalParts does not match the existing import');
    const stored: StoredEventBatch = { part, totalParts, checksum: body.checksum, events };
    await this.storage.writeJson(batchPath(runId, part), stored);
    const metadata = { part, totalParts, eventCount: events.length, byteLength, checksum: body.checksum, uploadedAt: now };
    const uploadedParts = [...(previous?.uploadedParts ?? []).filter((item) => item.part !== part), metadata].sort((left, right) => left.part - right.part);
    await this.storage.writeJson(manifestPath(runId), {
      version: 1, runId, status: 'uploading', createdAt: previous?.createdAt ?? now, updatedAt: now, totalParts, uploadedParts,
    } satisfies EventImportManifest);
    return { runId, part, totalParts, eventCount: events.length, byteLength, checksum: body.checksum };
  }

  async finalize(runId: string, body: FinalizeBody) {
    validateRunId(runId);
    const totalParts = positiveInteger(body.totalParts, 'totalParts');
    const expectedEventCount = nonNegativeInteger(body.expectedEventCount, 'expectedEventCount');
    if (typeof body.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(body.checksum)) throw new BadRequestException('checksum must be a SHA-256 hex digest');
    const completed = await this.storage.tryReadJson<CompletedEventImport>(completionPath(runId));
    if (completed) {
      if (completed.totalParts !== totalParts || completed.expectedEventCount !== expectedEventCount || completed.checksum !== body.checksum) {
        throw new BadRequestException('runId was already finalized with different metadata');
      }
      return { ...completed.result, temporaryBatchesDeleted: true };
    }

    const batches = await Promise.all(Array.from({ length: totalParts }, (_, index) => this.storage.readJson<StoredEventBatch>(batchPath(runId, index + 1))));
    batches.forEach((batch, index) => {
      const expectedPart = index + 1;
      if (batch.part !== expectedPart || batch.totalParts !== totalParts) throw new BadRequestException(`event batch ${expectedPart} metadata does not match finalize request`);
      if (sha256(JSON.stringify(batch.events)) !== batch.checksum) throw new BadRequestException(`event batch ${expectedPart} checksum does not match stored events`);
    });

    const events = validateEvents(batches.flatMap((batch) => batch.events));
    validateUniqueSourceUrls(events);
    if (events.length !== expectedEventCount) throw new BadRequestException(`expected ${expectedEventCount} events but received ${events.length}`);
    if (sha256(JSON.stringify(events)) !== body.checksum) throw new BadRequestException('final event checksum does not match');
    const eventResult = await this.eventsService.import(events, body.collectionStatus, runId);
    const result = { runId, totalParts, ...eventResult };
    await this.storage.writeJson(completionPath(runId), { totalParts, expectedEventCount, checksum: body.checksum, result } satisfies CompletedEventImport);
    const temporaryPaths = Array.from({ length: totalParts }, (_, index) => batchPath(runId, index + 1));
    const cleanup = await Promise.allSettled([this.storage.deleteFiles(temporaryPaths)]);
    const temporaryBatchesDeleted = cleanup[0].status === 'fulfilled';
    const previous = await this.storage.tryReadJson<EventImportManifest>(manifestPath(runId));
    const now = new Date().toISOString();
    await this.storage.writeJson(manifestPath(runId), {
      version: 1, runId, status: 'completed', createdAt: previous?.createdAt ?? now, updatedAt: now, totalParts,
      uploadedParts: previous?.uploadedParts ?? [], result, temporaryBatchesDeleted,
    } satisfies EventImportManifest);
    return { ...result, temporaryBatchesDeleted };
  }

  async listRuns() {
    if (adminReadProxyUrl()) return this.readAdminProxyJson<EventImportManifest[]>('/api/internal/admin/event-imports');
    const files = await this.storage.listFiles('schedule-api/imports/');
    const runIds = [...new Set(files.map((file) => file.pathname.split('/')[2]).filter(Boolean))];
    const runs = await Promise.all(runIds.map((runId) => this.getRun(runId)));
    return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getRun(runId: string): Promise<EventImportManifest> {
    validateRunId(runId);
    if (adminReadProxyUrl()) return this.readAdminProxyJson<EventImportManifest>(`/api/internal/admin/event-imports/${encodeURIComponent(runId)}`);
    const manifest = await this.storage.tryReadJson<EventImportManifest>(manifestPath(runId));
    if (manifest) return manifest;

    const completed = await this.storage.tryReadJson<CompletedEventImport>(completionPath(runId));
    if (completed) {
      const files = await this.storage.listFiles(`schedule-api/imports/${runId}/`);
      const updatedAt = files[0]?.uploadedAt ?? completed.result.retrievedAt;
      return {
        version: 1, runId, status: 'completed', createdAt: updatedAt, updatedAt, totalParts: completed.totalParts,
        uploadedParts: [], result: completed.result, temporaryBatchesDeleted: true,
      };
    }

    const files = await this.storage.listFiles(`schedule-api/imports/${runId}/events/`);
    if (!files.length) await this.storage.readJson(manifestPath(runId));
    const batches = await Promise.all(files.map((file) => this.storage.readJson<StoredEventBatch>(file.pathname).then((batch) => ({
      part: batch.part, totalParts: batch.totalParts, eventCount: batch.events.length, byteLength: file.size,
      checksum: batch.checksum, uploadedAt: file.uploadedAt,
    }))));
    const updatedAt = files[0].uploadedAt;
    return {
      version: 1, runId, status: 'uploading', createdAt: files.at(-1)?.uploadedAt ?? updatedAt, updatedAt,
      totalParts: batches[0].totalParts, uploadedParts: batches.sort((left, right) => left.part - right.part),
    };
  }

  async getBatch(runId: string, partValue: string) {
    validateRunId(runId);
    const part = positiveInteger(Number(partValue), 'part');
    if (adminReadProxyUrl()) return this.readAdminProxyJson<StoredEventBatch>(`/api/internal/admin/event-imports/${encodeURIComponent(runId)}/batches/${part}`);
    return this.storage.readJson<StoredEventBatch>(batchPath(runId, part));
  }

  async getRunResults(runId: string): Promise<EventPagesManifest> {
    validateRunId(runId);
    if (adminReadProxyUrl()) return this.readAdminProxyJson<EventPagesManifest>(`/api/internal/admin/event-imports/${encodeURIComponent(runId)}/results`);
    return this.eventsService.getRunPagesManifest(runId);
  }

  async getRunResultPage(runId: string, gameId: string, pageValue: string): Promise<ScheduleEvent[]> {
    validateRunId(runId);
    const page = positiveInteger(Number(pageValue), 'page');
    if (adminReadProxyUrl()) return this.readAdminProxyJson<ScheduleEvent[]>(`/api/internal/admin/event-imports/${encodeURIComponent(runId)}/results/${encodeURIComponent(gameId)}/pages/${page}`);
    return this.eventsService.getRunPage(runId, gameId, page);
  }

  private async readAdminProxyJson<T>(pathname: string): Promise<T> {
    const baseUrl = adminReadProxyUrl();
    const token = process.env.ADMIN_TOKEN;
    if (!baseUrl || !token) throw new BadGatewayException('admin read proxy is not configured');
    try {
      const response = await fetch(new URL(pathname, baseUrl), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
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

function batchPath(runId: string, part: number): string {
  return `schedule-api/imports/${runId}/events/part-${String(part).padStart(4, '0')}.json`;
}

function completionPath(runId: string): string {
  return `schedule-api/imports/${runId}/completed.json`;
}

function manifestPath(runId: string): string {
  return `schedule-api/imports/${runId}/manifest.json`;
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateUniqueSourceUrls(events: ScheduleEvent[]): void {
  const sourceUrls = new Set<string>();
  for (const event of events) {
    if (sourceUrls.has(event.sourceUrl)) throw new BadRequestException(`sourceUrl duplicates ${event.sourceUrl}`);
    sourceUrls.add(event.sourceUrl);
  }
}
