import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, collectText, decodeHtml, deduplicate, extractGenshinMainRedemptionCodes, extractLinks, extractNetmarbleForumLinks, extractPage, extractRedemptionCodes, extractTime, getEventStatus, mergeEventHistory, mergeRedemptionCodeHistory, normalize } from '../scripts/collector/lib.mjs';

const source = { gameId: 'genshin', locale: 'ko-KR', url: 'https://example.com/news', allowedHosts: ['example.com'], detailPattern: '/detail/', keywords: ['이벤트'], redemptionCodes: { enabled: true } };

test('discovers only allowed official detail links', () => {
  const html = '<a href="/detail/123"><span>신규 이벤트 안내</span></a><a href="https://evil.test/detail/9">이벤트</a>';
  assert.deepEqual(extractLinks(html, source), [{ url: 'https://example.com/detail/123', title: '신규 이벤트 안내' }]);
});

test('extracts metadata and Korean KST ranges', () => {
  const page = extractPage('<meta property="og:title" content="신규 이벤트"><p>2026. 8. 7 11:00부터 2026. 8. 9 23:59</p>', { url: 'https://example.com/detail/123', title: 'fallback' });
  assert.equal(page.title, '신규 이벤트');
  assert.deepEqual(extractTime(page.text), { startsAt: '2026-08-07T11:00:00+09:00', endsAt: '2026-08-09T23:59:00+09:00', sourceTimeText: '2026. 8. 7 11:00부터 2026. 8. 9 23:59' });
});

test('normalizes, deduplicates, classifies, and calculates status', () => {
  const event = normalize(source, { title: '1.2 버전 업데이트', canonical: 'https://example.com/detail/123', description: '설명', published: null, text: '2026. 8. 7 11:00 ~ 2026. 8. 9 23:59' }, '2026-08-07T00:00:00Z', Date.parse('2026-08-08T00:00:00Z'));
  assert.equal(event.status, 'active');
  assert.equal(deduplicate([event, { ...event, title: '중복' }]).length, 1);
  assert.equal(classify('특별 방송 안내'), 'broadcast');
});

test('extracts rendered forum links and Naver document text', () => {
  assert.deepEqual(extractNetmarbleForumLinks('<a data-router="view/6/4009"><span>여름 이벤트 안내</span></a>', { url: 'https://forum.netmarble.com/stardive_ko/list/6/1' }), [{ url: 'https://forum.netmarble.com/stardive_ko/view/6/4009', title: '여름 이벤트 안내' }]);
  assert.match(collectText({ components: [{ value: '2026년 8월 7일 20:00' }] }), /2026년/);
  assert.equal(decodeHtml('&#x1f4e3; 공식 방송'), '📣 공식 방송');
  assert.equal(decodeHtml('&lt;개발자 라이브&gt; 안내'), '<개발자 라이브> 안내');
});

test('retains history while replacing recollected URLs', () => {
  const now = Date.parse('2026-08-07T03:00:00Z');
  const existing = [{ id: 'ended', sourceUrl: 'https://example.com/ended', title: '&lt;기존&gt;', sourceTitle: '&lt;기존&gt; - 공식', startsAt: '2026-08-06T20:00:00+09:00', endsAt: null }];
  const merged = mergeEventHistory(existing, [{ ...existing[0], title: '갱신됨' }], now);
  assert.equal(merged[0].title, '갱신됨');
  assert.equal(merged[0].sourceTitle, '<기존> - 공식');
  assert.equal(getEventStatus(merged[0], now), 'ended');
});

test('extracts only explicit public redemption codes from official text', () => {
  const codes = extractRedemptionCodes(source, {
    title: '공식 리딤 코드 안내',
    canonical: 'https://example.com/detail/codes',
    published: '2026-08-07T12:00:00+09:00',
    text: '공용 리딤 코드: PUBLIC2026\n사용 기한은 2026년 8월 9일 23:59까지입니다.',
  }, '2026-08-07T04:00:00Z', Date.parse('2026-08-08T00:00:00Z'));

  assert.equal(codes.length, 1);
  assert.equal(codes[0].code, 'PUBLIC2026');
  assert.equal(codes[0].distributionType, 'public');
  assert.equal(codes[0].expiresAt, '2026-08-09T23:59:00+09:00');
  assert.equal(codes[0].status, 'active');
});

test('uses the official publication year for a redemption code expiry without a year', () => {
  const codes = extractRedemptionCodes(source, {
    title: '개발자 라운지 토크 기념 쿠폰', canonical: 'https://example.com/detail/lounge-code',
    published: '2026-08-14T13:55:00+09:00',
    text: '리딤 코드: LETSGOALFRED\n코드 입력 기간 (KST): 라이브 방송 후 - 8월 19일(수) 08:30까지',
  }, '2026-08-16T12:06:33.434Z', Date.parse('2026-08-16T21:06:33+09:00'));

  assert.equal(codes[0].expiresAt, '2026-08-19T08:30:00+09:00');
  assert.equal(codes[0].sourceTimeText, '코드 입력 기간 (KST): 라이브 방송 후 - 8월 19일(수) 08:30');
  assert.equal(codes[0].status, 'active');
});

test('rejects invitation and individually issued coupon codes', () => {
  const page = {
    title: '콜라보 상품 안내', canonical: 'https://example.com/detail/purchase', published: null,
    text: '상품 구매 시 인게임 쿠폰 번호 1EA를 지급합니다. 초대 코드: PERSONAL123',
  };
  assert.deepEqual(extractRedemptionCodes(source, page, '2026-08-07T04:00:00Z'), []);
});

test('retains redemption code history and refreshes status', () => {
  const existing = [{ id: 'genshin-code', gameId: 'genshin', code: 'PUBLIC2026', sourceUrl: 'https://example.com/old', expiresAt: '2026-08-09T23:59:00+09:00', status: 'active' }];
  const merged = mergeRedemptionCodeHistory(existing, [], Date.parse('2026-08-10T00:00:00+09:00'));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'expired');
});

test('extracts redemption codes only from the official Genshin main-page code section', () => {
  const html = [
    '<div class="pz-text">UnrelatedWord</div>',
    '<div class="pz-text">Redeem Code</div>',
    '<div class="pz-text">×300</div>',
    '<div class="pz-text">Everwinter</div>',
    '<div class="pz-text">OntoSnezhnaya</div>',
    '<div class="pz-text">Odette0812</div>',
    '<div class="pz-text">Redeem Code</div>',
    '<div class="pz-text">Top-Up Bonus</div>',
  ].join('');
  const genshinMain = {
    gameId: 'genshin', locale: 'en-US', canonicalUrl: 'https://genshin.hoyoverse.com/en',
    redemptionCodes: { enabled: true, redemptionUrlTemplate: 'https://genshin.hoyoverse.com/ko/gift?code={code}' },
  };
  const codes = extractGenshinMainRedemptionCodes(genshinMain, html, '2026-08-16T12:30:00Z');

  assert.deepEqual(codes.map((code) => code.code), ['Everwinter', 'OntoSnezhnaya', 'Odette0812']);
  assert.ok(codes.every((code) => code.sourceUrl === 'https://genshin.hoyoverse.com/en'));
  assert.ok(codes.every((code) => code.expiresAt === null && code.status === 'unknown'));
});
