import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

describe('schedule API', () => {
  let app: INestApplication;
  let dataDirectory: string;
  const event = {
    id: 'genshin-test-1', gameId: 'genshin', type: 'event', title: '테스트 이벤트', sourceTitle: '테스트 이벤트',
    sourceUrl: 'https://example.com/event/1', sourceLocale: 'ko-KR', publishedAt: null,
    startsAt: '2026-08-07T00:00:00+09:00', endsAt: '2026-08-08T23:59:00+09:00', sourceTimeText: '8월 7일',
    status: 'active', confidence: 'confirmed', retrievedAt: '2026-08-07T00:00:00Z', version: null, summary: '',
    banners: [{ name: '테스트 기원', kind: 'character', phase: 'first', featuredCharacters: [{ name: '테스트 캐릭터', rarity: 5 }], featuredWeapons: [] }],
  };
  const redemptionCode = {
    id: 'genshin-code-test', gameId: 'genshin', code: 'PUBLIC2026', region: null, distributionType: 'public',
    sourceTitle: '공식 리딤 코드 안내', sourceUrl: 'https://example.com/code/1', sourceLocale: 'ko-KR',
    publishedAt: '2026-08-07T00:00:00+09:00', startsAt: null, expiresAt: '2026-08-09T23:59:00+09:00',
    sourceTimeText: '2026년 8월 9일 23:59까지', redemptionUrl: 'https://example.com/redeem?code=PUBLIC2026',
    rewards: ['보상'], status: 'active', retrievedAt: '2026-08-07T00:00:00Z',
  };
  const redemptionCandidate = {
    id: 'wuthering-ocr-code-test', gameId: 'wuthering', candidateCode: 'WAVE2026', status: 'pending',
    sourceTitle: '공식 방송', sourceUrl: 'https://game.naver.com/lounge/WutheringWaves/board/detail/1', sourceLocale: 'ko-KR',
    imageUrl: 'https://nng-phinf.pstatic.net/code.png', mediaType: 'official-image', ocrText: '리딤 코드: WAVE2026', discoveredAt: '2026-08-16T14:00:00Z',
  };
  const nteEvent = {
    ...event,
    id: 'nte-test-1',
    gameId: 'nte',
    title: '이환 테스트 이벤트',
    sourceTitle: '이환 테스트 이벤트',
    sourceUrl: 'https://game.naver.com/lounge/nte/board/detail/8063606',
  };
  const nteCharacter = {
    id: 'nte-character-test', gameId: 'nte', name: '잔홍', sourceTitle: '캐릭터 파일 소개丨잔홍',
    sourceUrl: 'https://game.naver.com/lounge/nte/board/detail/8059055', sourceLocale: 'ko-KR',
    publishedAt: '2026-08-14T13:00:34+09:00', summary: '공식 캐릭터 소개',
    imageUrls: ['https://nng-phinf.pstatic.net/zanhong.jpg'], retrievedAt: '2026-08-17T00:00:00Z',
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
    expect(response.body[0].banners[0].featuredCharacters[0]).toEqual({ name: '테스트 캐릭터', rarity: 5 });
    await request(app.getHttpServer()).get('/api/v1/collection-status').expect(200).expect(({ body }) => expect(body.eventCount).toBe(1));
  });

  it('serves timeless Monster pickups from the public events endpoint', async () => {
    const monsterPickup = {
      ...event,
      id: 'monster-pickup-mina', gameId: 'monster', type: 'banner', title: '운명의 힘을 품은 구미호, 미나 등장!',
      sourceTitle: '운명의 힘을 품은 구미호, 미나 등장!', sourceUrl: 'https://forum.netmarble.com/stardive_ko/view/20/2268',
      startsAt: null, endsAt: null, sourceTimeText: '', status: 'unknown', confidence: 'probable',
      banners: [{ name: '운명의 힘을 품은 구미호', kind: 'character', phase: 'unknown', featuredCharacters: [{ name: '미나', rarity: null }], featuredWeapons: [], sourceImageUrls: ['https://hedwig-cf.netmarble.com/mina.jpg'] }],
    };
    await request(app.getHttpServer()).post('/api/internal/events/import').set('Authorization', 'Bearer test-token').send([monsterPickup]).expect(201);
    await request(app.getHttpServer()).get('/api/v1/events?gameId=monster').expect(200, [monsterPickup]);
  });

  it('rejects malformed banner metadata', () => request(app.getHttpServer()).post('/api/internal/events/import')
    .set('Authorization', 'Bearer test-token')
    .send([{ ...event, banners: [{ ...event.banners[0], kind: 'artifact', featuredCharacters: [{ name: '', rarity: 6 }] }] }])
    .expect(400));

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

  it('accepts and filters NTE schedules without changing existing games', async () => {
    await request(app.getHttpServer()).post('/api/internal/events/import').set('Authorization', 'Bearer test-token').send([event, nteEvent]).expect(201);
    await request(app.getHttpServer()).get('/api/v1/events?gameId=nte').expect(200)
      .expect(({ body }) => expect(body).toEqual([nteEvent]));
    await request(app.getHttpServer()).get('/api/v1/events?gameId=genshin').expect(200)
      .expect(({ body }) => expect(body).toEqual([event]));
  });

  it('protects, imports, and filters character profiles independently', async () => {
    await request(app.getHttpServer()).post('/api/internal/characters/import').send([nteCharacter]).expect(401);
    await request(app.getHttpServer()).post('/api/internal/characters/import').set('Authorization', 'Bearer test-token').send([nteCharacter]).expect(201);
    await request(app.getHttpServer()).get('/api/v1/characters?gameId=nte').expect(200, [nteCharacter]);
    await request(app.getHttpServer()).get('/api/v1/characters?gameId=unknown').expect(400);
    await request(app.getHttpServer()).post('/api/internal/characters/import').set('Authorization', 'Bearer test-token')
      .send([{ ...nteCharacter, sourceUrl: 'http://unsafe.example', imageUrls: ['http://unsafe.example/image.png'] }]).expect(400);
  });

  it('protects, validates, imports, and filters redemption codes', async () => {
    const todayInKorea = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const expiringToday = {
      ...redemptionCode,
      id: 'wuthering-code-today',
      gameId: 'wuthering',
      code: 'TODAY2026',
      expiresAt: `${todayInKorea}T23:59:00+09:00`,
    };
    const expiringSoon = {
      ...redemptionCode,
      id: 'monster-code-soon',
      gameId: 'monster',
      code: 'SOON2026',
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    };
    await request(app.getHttpServer()).post('/api/internal/redemption-codes/import').send([redemptionCode]).expect(401);
    await request(app.getHttpServer()).post('/api/internal/redemption-codes/import').set('Authorization', 'Bearer test-token').send([redemptionCode, expiringToday, expiringSoon]).expect(201);
    const response = await request(app.getHttpServer()).get('/api/v1/redemption-codes?gameId=genshin&status=active').expect(200);
    expect(response.body).toEqual([redemptionCode]);
    await request(app.getHttpServer()).get('/api/v1/redemption-codes/expiring-today?gameId=wuthering').expect(200)
      .expect(({ body }) => expect(body).toEqual([expiringToday]));
    await request(app.getHttpServer()).get('/api/v1/redemption-codes/expiring-today?gameId=unknown').expect(400);
    await request(app.getHttpServer()).get('/api/v1/redemption-codes/expiring?withinHours=12&gameId=monster').expect(200)
      .expect(({ body }) => expect(body).toEqual([expiringSoon]));
    await request(app.getHttpServer()).get('/api/v1/redemption-codes/expiring?withinHours=1&gameId=monster').expect(200, []);
    await request(app.getHttpServer()).get('/api/v1/redemption-codes/expiring?withinHours=169').expect(400);
    await request(app.getHttpServer()).post('/api/internal/redemption-codes/import').set('Authorization', 'Bearer test-token')
      .send([{ ...redemptionCode, code: 'PERSONAL123', distributionType: 'single-use' }]).expect(400);
  });

  it('validates and imports schedules and redemption codes in one sync request', async () => {
    const response = await request(app.getHttpServer()).post('/api/internal/events/import').set('Authorization', 'Bearer test-token')
      .send({ events: [event], redemptionCodes: [redemptionCode] }).expect(201);
    expect(response.body).toMatchObject({ eventCount: 1, redemptionCodeCount: 1 });
  });

  it('stages event batches, preserves production data on incomplete runs, and serves finalized pages', async () => {
    const events = Array.from({ length: 205 }, (_, index) => ({
      ...event,
      id: `genshin-batch-${index}`,
      title: `배치 이벤트 ${index}`,
      sourceTitle: `배치 이벤트 ${index}`,
      sourceUrl: `https://example.com/event/batch-${index}`,
    }));
    const batches = [events.slice(0, 100), events.slice(100)];
    const headers = { Authorization: 'Bearer test-token' };
    const before = await request(app.getHttpServer()).get('/api/v1/events').expect(200);

    await request(app.getHttpServer()).post('/api/internal/event-imports/incomplete-run/batches').set(headers)
      .send({ part: 1, totalParts: 2, checksum: checksum(batches[0]), events: batches[0] }).expect(201);
    await request(app.getHttpServer()).post('/api/internal/event-imports/incomplete-run/finalize').set(headers)
      .send({ totalParts: 2, expectedEventCount: events.length, checksum: checksum(events), redemptionCodes: [] }).expect(404);
    await request(app.getHttpServer()).get('/api/v1/events').expect(200, before.body);

    for (const [index, batch] of batches.entries()) {
      await request(app.getHttpServer()).post('/api/internal/event-imports/complete-run/batches').set(headers)
        .send({ part: index + 1, totalParts: batches.length, checksum: checksum(batch), events: batch }).expect(201);
    }
    const finalizeBody = {
      totalParts: batches.length,
      expectedEventCount: events.length,
      checksum: checksum(events),
      redemptionCodes: [redemptionCode],
      collectionStatus: { retrievedAt: event.retrievedAt, eventCount: 0, collectedEventCount: 205, sources: [] },
    };
    await request(app.getHttpServer()).post('/api/internal/event-imports/complete-run/finalize').set(headers)
      .send(finalizeBody)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ runId: 'complete-run', totalParts: 2, eventCount: 205, redemptionCodeCount: 1 }));
    await request(app.getHttpServer()).post('/api/internal/event-imports/complete-run/finalize').set(headers)
      .send(finalizeBody).expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ runId: 'complete-run', eventCount: 205, temporaryBatchesDeleted: true }));
    await request(app.getHttpServer()).post('/api/internal/event-imports/complete-run/finalize').set(headers)
      .send({ ...finalizeBody, expectedEventCount: 204 }).expect(400);

    const first = await request(app.getHttpServer()).get('/api/v2/events?gameId=genshin').expect(200);
    expect(first.body.items).toHaveLength(100);
    expect(first.body.total).toBe(205);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(app.getHttpServer()).get(`/api/v2/events?gameId=genshin&cursor=${encodeURIComponent(first.body.nextCursor)}`).expect(200);
    expect(second.body.items).toHaveLength(100);
    const third = await request(app.getHttpServer()).get(`/api/v2/events?gameId=genshin&cursor=${encodeURIComponent(second.body.nextCursor)}`).expect(200);
    expect(third.body.items).toHaveLength(5);
    expect(third.body.nextCursor).toBeNull();
    await request(app.getHttpServer()).get('/api/v2/events?gameId=wuthering').expect(200, { items: [], nextCursor: null, total: 0 });
    await request(app.getHttpServer()).get('/api/v2/events?gameId=genshin&cursor=invalid').expect(400);
    await request(app.getHttpServer()).get('/api/v1/collection-status').expect(200)
      .expect(({ body }) => expect(body.eventCount).toBe(205));
  });

  it('imports, filters, and reviews OCR redemption candidates', async () => {
    await request(app.getHttpServer()).post('/api/internal/redemption-code-candidates/import').send([redemptionCandidate]).expect(401);
    await request(app.getHttpServer()).post('/api/internal/redemption-code-candidates/import').set('Authorization', 'Bearer test-token').send([redemptionCandidate]).expect(201);
    await request(app.getHttpServer()).get('/api/v1/redemption-code-candidates?gameId=wuthering&status=pending').expect(200)
      .expect(({ body }) => expect(body).toEqual([redemptionCandidate]));
    await request(app.getHttpServer()).patch(`/api/internal/redemption-code-candidates/${redemptionCandidate.id}`).set('Authorization', 'Bearer test-token')
      .send({ status: 'accepted' }).expect(200).expect(({ body }) => expect(body.status).toBe('accepted'));
    await request(app.getHttpServer()).get('/api/v1/redemption-codes?gameId=wuthering').expect(200)
      .expect(({ body }) => expect(body[0].code).toBe('WAVE2026'));
  });
});

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
