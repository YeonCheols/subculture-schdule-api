import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('schedule API', () => {
  let app: INestApplication;
  let dataDirectory: string;
  const event = {
    id: 'genshin-test-1', gameId: 'genshin', type: 'event', title: '테스트 이벤트', sourceTitle: '테스트 이벤트',
    sourceUrl: 'https://example.com/event/1', sourceLocale: 'ko-KR', publishedAt: null,
    startsAt: '2026-08-07T00:00:00+09:00', endsAt: '2026-08-08T23:59:00+09:00', sourceTimeText: '8월 7일',
    status: 'active', confidence: 'confirmed', retrievedAt: '2026-08-07T00:00:00Z', version: null, summary: '',
  };

  beforeAll(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'schedule-api-'));
    process.env.LOCAL_DATA_DIR = dataDirectory;
    process.env.INGEST_TOKEN = 'test-token';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it('checks health', () => request(app.getHttpServer()).get('/health').expect(200, { ok: true }));

  it('protects imports', () => request(app.getHttpServer()).post('/api/internal/events/import').send([event]).expect(401));

  it('imports and serves events', async () => {
    await request(app.getHttpServer()).post('/api/internal/events/import').set('Authorization', 'Bearer test-token').send([event]).expect(201);
    const response = await request(app.getHttpServer()).get('/api/v1/events?gameId=genshin&date=2026-08-08').expect(200);
    expect(response.body).toHaveLength(1);
    await request(app.getHttpServer()).get('/api/v1/collection-status').expect(200).expect(({ body }) => expect(body.eventCount).toBe(1));
  });

  it('rejects unsupported query values', () => request(app.getHttpServer()).get('/api/v1/events?gameId=unknown').expect(400));
});
