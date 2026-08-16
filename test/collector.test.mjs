import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, collectText, decodeHtml, deduplicate, extractLinks, extractNetmarbleForumLinks, extractPage, extractTime, getEventStatus, mergeEventHistory, normalize } from '../scripts/collector/lib.mjs';

const source = { gameId: 'genshin', locale: 'ko-KR', url: 'https://example.com/news', allowedHosts: ['example.com'], detailPattern: '/detail/', keywords: ['이벤트'] };

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
