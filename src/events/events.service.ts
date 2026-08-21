import { BadRequestException, Injectable } from '@nestjs/common';
import { GAME_IDS, type CollectionStatus, type GameId, type ScheduleEvent } from '../domain/event';
import { StorageService } from '../storage/storage.service';

const EVENTS_PATH = 'schedule-api/events.json';
const STATUS_PATH = 'schedule-api/collection-status.json';
const EVENT_PAGES_MANIFEST_PATH = 'schedule-api/event-pages/manifest.json';
const EVENT_PAGE_SIZE = 100;

export interface EventPagesManifest {
  version: string;
  generatedAt: string;
  pageSize: number;
  eventCount: number;
  games: Record<GameId, { eventCount: number; pageCount: number }>;
}

export interface EventsPageResponse {
  items: ScheduleEvent[];
  nextCursor: string | null;
  total: number;
}

@Injectable()
export class EventsService {
  constructor(private readonly storage: StorageService) {}

  async findAll(query: { gameId?: string; status?: string; date?: string }): Promise<ScheduleEvent[]> {
    const events = await this.storage.readJson<ScheduleEvent[]>(EVENTS_PATH);
    return events.filter((event) => {
      if (query.gameId && event.gameId !== query.gameId) return false;
      if (query.status && event.status !== query.status) return false;
      if (query.date && !occursOnDate(event, query.date.slice(0, 10))) return false;
      return true;
    });
  }

  getCollectionStatus(): Promise<CollectionStatus> {
    return this.storage.readJson<CollectionStatus>(STATUS_PATH);
  }

  async findPage(gameId: string, cursor?: string): Promise<EventsPageResponse> {
    if (!GAME_IDS.includes(gameId as GameId)) throw new BadRequestException('gameId is unsupported');
    const cursorState = decodeCursor(cursor, gameId);
    const manifest = cursorState
      ? await this.storage.readJson<EventPagesManifest>(eventPagesGenerationManifestPath(cursorState.version))
      : await this.storage.readJson<EventPagesManifest>(EVENT_PAGES_MANIFEST_PATH);
    const game = manifest.games[gameId as GameId];
    const page = cursorState?.page ?? 0;
    if (page >= game.pageCount && !(page === 0 && game.pageCount === 0)) throw new BadRequestException('cursor points beyond the available event pages');
    const items = game.pageCount === 0
      ? []
      : await this.storage.readJson<ScheduleEvent[]>(eventPagePath(manifest.version, gameId, page));
    const nextCursor = page + 1 < game.pageCount
      ? encodeCursor({ gameId, version: manifest.version, page: page + 1 })
      : null;
    return { items, nextCursor, total: game.eventCount };
  }

  getRunPagesManifest(runId: string): Promise<EventPagesManifest> {
    return this.storage.readJson<EventPagesManifest>(eventPagesGenerationManifestPath(runId));
  }

  async getRunPage(runId: string, gameId: string, pageNumber: number): Promise<ScheduleEvent[]> {
    if (!GAME_IDS.includes(gameId as GameId)) throw new BadRequestException('gameId is unsupported');
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new BadRequestException('page must be a positive integer');
    const manifest = await this.getRunPagesManifest(runId);
    if (pageNumber > manifest.games[gameId as GameId].pageCount) throw new BadRequestException('page points beyond the available event pages');
    return this.storage.readJson<ScheduleEvent[]>(eventPagePath(runId, gameId, pageNumber - 1));
  }

  async import(events: ScheduleEvent[], status?: CollectionStatus, version?: string): Promise<{ eventCount: number; retrievedAt: string }> {
    const retrievedAt = latestRetrievedAt(events) ?? new Date().toISOString();
    const normalizedStatus: CollectionStatus = status ?? {
      retrievedAt,
      eventCount: events.length,
      collectedEventCount: events.length,
      sources: [],
    };
    normalizedStatus.eventCount = events.length;

    const pagesManifest = await this.prepareEventPages(events, version ?? `legacy-${Date.now()}`);
    await this.storage.writeJson(EVENTS_PATH, events);
    await this.storage.writeJson(EVENT_PAGES_MANIFEST_PATH, pagesManifest);
    await this.storage.writeJson(STATUS_PATH, normalizedStatus);
    return { eventCount: events.length, retrievedAt };
  }

  private async prepareEventPages(events: ScheduleEvent[], version: string): Promise<EventPagesManifest> {
    const byGame = Object.fromEntries(GAME_IDS.map((gameId) => [gameId, events.filter((event) => event.gameId === gameId)])) as Record<GameId, ScheduleEvent[]>;
    const games = Object.fromEntries(GAME_IDS.map((gameId) => [gameId, {
      eventCount: byGame[gameId].length,
      pageCount: Math.ceil(byGame[gameId].length / EVENT_PAGE_SIZE),
    }])) as EventPagesManifest['games'];
    const writes: Promise<void>[] = [];
    for (const gameId of GAME_IDS) {
      for (let page = 0; page < games[gameId].pageCount; page += 1) {
        writes.push(this.storage.writeJson(eventPagePath(version, gameId, page), byGame[gameId].slice(page * EVENT_PAGE_SIZE, (page + 1) * EVENT_PAGE_SIZE)));
      }
    }
    await Promise.all(writes);
    const manifest = {
      version,
      generatedAt: new Date().toISOString(),
      pageSize: EVENT_PAGE_SIZE,
      eventCount: events.length,
      games,
    } satisfies EventPagesManifest;
    await this.storage.writeJson(eventPagesGenerationManifestPath(version), manifest);
    return manifest;
  }
}

function eventPagePath(version: string, gameId: string, page: number): string {
  return `schedule-api/event-pages/${version}/${gameId}/page-${String(page + 1).padStart(4, '0')}.json`;
}

interface EventPageCursor {
  gameId: string;
  page: number;
  version: string;
}

function encodeCursor(cursor: EventPageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string | undefined, gameId: string): EventPageCursor | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<EventPageCursor>;
    if (decoded.gameId !== gameId
      || typeof decoded.version !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(decoded.version)
      || !Number.isInteger(decoded.page) || Number(decoded.page) < 0) throw new Error('invalid cursor');
    return decoded as EventPageCursor;
  } catch {
    throw new BadRequestException('cursor is invalid for the requested game');
  }
}

function eventPagesGenerationManifestPath(version: string): string {
  return `schedule-api/event-pages/${version}/manifest.json`;
}

function occursOnDate(event: ScheduleEvent, date: string): boolean {
  const starts = event.startsAt?.slice(0, 10);
  const ends = event.endsAt?.slice(0, 10);
  if (!starts && !ends) return event.publishedAt?.slice(0, 10) === date;
  return (!starts || starts <= date) && (!ends || ends >= date);
}

function latestRetrievedAt(events: ScheduleEvent[]): string | undefined {
  return events.map((event) => event.retrievedAt).sort().at(-1);
}
