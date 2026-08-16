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
  const redemptionCode = {
    id: 'genshin-code-test', gameId: 'genshin', code: 'PUBLIC2026', region: null, distributionType: 'public',
    sourceTitle: '공식 리딤 코드 안내', sourceUrl: 'https://example.com/code/1', sourceLocale: 'ko-KR',
    publishedAt: '2026-08-07T00:00:00+09:00', startsAt: null, expiresAt: '2026-08-09T23:59:00+09:00',
    sourceTimeText: '2026년 8월 9일 23:59까지', redemptionUrl: 'https://example.com/redeem?code=PUBLIC2026',
    rewards: ['보상'], status: 'active', retrievedAt: '2026-08-07T00:00:00Z',
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

  it('does not cache a missing dataset response', async () => {
    const originalDirectory = process.env.LOCAL_DATA_DIR;
    process.env.LOCAL_DATA_DIR = `${dataDirectory}/missing`;
    // StorageService captured its directory during bootstrap, so a new app is used for this case.
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const missingApp = module.createNestApplication();
    await missingApp.init();
    const response = await request(missingApp.getHttpServer()).get('/api/v1/events').expect(404);
    expect(response.headers['cache-control']).toBeUndefined();
    await missingApp.close();
    if (originalDirectory === undefined) delete process.env.LOCAL_DATA_DIR;
    else process.env.LOCAL_DATA_DIR = originalDirectory;
  });

  it('rejects unsupported query values', () => request(app.getHttpServer()).get('/api/v1/events?gameId=unknown').expect(400));

  it('protects, validates, imports, and filters redemption codes', async () => {
    await request(app.getHttpServer()).post('/api/internal/redemption-codes/import').send([redemptionCode]).expect(401);
    await request(app.getHttpServer()).post('/api/internal/redemption-codes/import').set('Authorization', 'Bearer test-token').send([redemptionCode]).expect(201);
    const response = await request(app.getHttpServer()).get('/api/v1/redemption-codes?gameId=genshin&status=active').expect(200);
    expect(response.body).toEqual([redemptionCode]);
    await request(app.getHttpServer()).post('/api/internal/redemption-codes/import').set('Authorization', 'Bearer test-token')
      .send([{ ...redemptionCode, code: 'PERSONAL123', distributionType: 'single-use' }]).expect(400);
  });

  it('validates and imports schedules and redemption codes in one sync request', async () => {
    const response = await request(app.getHttpServer()).post('/api/internal/events/import').set('Authorization', 'Bearer test-token')
      .send({ events: [event], redemptionCodes: [redemptionCode] }).expect(201);
    expect(response.body).toMatchObject({ eventCount: 1, redemptionCodeCount: 1 });
  });
});
