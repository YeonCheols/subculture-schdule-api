import { Injectable } from '@nestjs/common';
import type { CollectionStatus, ScheduleEvent } from '../domain/event';
import { StorageService } from '../storage/storage.service';

const EVENTS_PATH = 'schedule-api/events.json';
const STATUS_PATH = 'schedule-api/collection-status.json';

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

  async import(events: ScheduleEvent[], status?: CollectionStatus): Promise<{ eventCount: number; retrievedAt: string }> {
    const retrievedAt = latestRetrievedAt(events) ?? new Date().toISOString();
    const normalizedStatus: CollectionStatus = status ?? {
      retrievedAt,
      eventCount: events.length,
      collectedEventCount: events.length,
      sources: [],
    };
    normalizedStatus.eventCount = events.length;

    await Promise.all([
      this.storage.writeJson(EVENTS_PATH, events),
      this.storage.writeJson(STATUS_PATH, normalizedStatus),
    ]);
    return { eventCount: events.length, retrievedAt };
  }
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
