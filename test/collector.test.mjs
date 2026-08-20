import assert from 'node:assert/strict';
import test from 'node:test';
import { splitJsonArray } from '../scripts/api-sync-lib.mjs';
import { classify, collectText, createNaverFeedUrl, decodeHtml, deduplicate, diagnoseNetmarbleCandidate, extractBannerInfo, extractGenshinMainRedemptionCodes, extractImageUrls, extractLinks, extractNaverCharacters, extractNaverOfficialPages, extractNetmarbleForumLinks, extractPage, extractRedemptionCodes, extractTime, getEventStatus, mergeCharacterHistory, mergeEventHistory, mergeRedemptionCodeHistory, normalize, selectNetmarbleForumCandidates } from '../scripts/collector/lib.mjs';
import { extractRedemptionCandidatesFromOcr } from '../scripts/collector/ocr.mjs';
import { candidatesFromSearchResults } from '../scripts/collector/search-discovery.mjs';

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

test('extracts spaced Korean month and day ranges used by Netmarble posts', () => {
  assert.deepEqual(extractTime('이벤트 진행 기간 - 8 월 12일(수) 09:00 ~ 8월 19일(수) 08:59(KST)', 2026), {
    startsAt: '2026-08-12T09:00:00+09:00', endsAt: '2026-08-19T08:59:00+09:00',
    sourceTimeText: '8 월 12일(수) 09:00 ~ 8월 19일(수) 08:59',
  });
});

test('extracts an official same-day NTE maintenance range before later event dates', () => {
  assert.deepEqual(extractTime('점검 기간: 2026년 5월 13일 07:00 ~ 12:00(KST)\n이벤트 기간: 5월 27일 13:00 ~ 6월 3일 05:59', 2026), {
    startsAt: '2026-05-13T07:00:00+09:00',
    endsAt: '2026-05-13T12:00:00+09:00',
    sourceTimeText: '2026년 5월 13일 07:00 ~ 12:00',
  });
});

test('preserves an official banner end when its start is only version-update-relative', () => {
  assert.deepEqual(extractTime('〓기원 기간〓 7.0 버전 업데이트 후~2026/9/1 18:59'), {
    startsAt: null,
    endsAt: '2026-09-01T18:59:00+09:00',
    sourceTimeText: '버전 업데이트 후~2026/9/1 18:59',
  });
});

test('normalizes, deduplicates, classifies, and calculates status', () => {
  const event = normalize(source, { title: '1.2 버전 업데이트', canonical: 'https://example.com/detail/123', description: '설명', published: null, text: '2026. 8. 7 11:00 ~ 2026. 8. 9 23:59' }, '2026-08-07T00:00:00Z', Date.parse('2026-08-08T00:00:00Z'));
  assert.equal(event.status, 'active');
  assert.equal(deduplicate([event, { ...event, title: '중복' }]).length, 1);
  assert.equal(classify('특별 방송 안내'), 'broadcast');
});

test('extracts multiple official character and weapon banners with rarity and phase', () => {
  const page = {
    title: '7.0 버전 이벤트 기원 알림 제1회',
    canonical: 'https://genshin.hoyoverse.com/ko/news/detail/170000',
    description: '', published: '2026-08-12T12:00:00+09:00',
    text: [
      '「백조의 그림자」 기원: 「백조의 춤·오데트(얼음)」 확률 UP!',
      '● 이벤트 기간에 한정 ★5 캐릭터 「백조의 춤·오데트(얼음)」의 기원 획득 확률 대폭 증가!',
      '● 이벤트 기간에 ★4 캐릭터 「섬광의 추적자·알료샤(번개)」, 「무해한 달콤함·설탕(바람)」의 기원 획득 확률 대폭 증가!',
      '「신의 주조」 기원: 「한손검·백조의 호수」, 「장병기·붉은 달의 형상」 확률 UP!',
      '● 이벤트 기간에 한정 ★5 무기 「한손검·백조의 호수」, 「장병기·붉은 달의 형상」의 기원 획득 확률 대폭 증가!',
      '● 이벤트 기간에 ★4 무기 「한손검·페보니우스 검」, 「활·녹슨 활」의 기원 획득 확률 대폭 증가!',
    ].join('\n'),
  };

  assert.deepEqual(extractBannerInfo(page), [
    {
      name: '백조의 그림자', kind: 'character', phase: 'first',
      featuredCharacters: [{ name: '오데트', rarity: 5 }, { name: '알료샤', rarity: 4 }, { name: '설탕', rarity: 4 }],
      featuredWeapons: [],
    },
    {
      name: '신의 주조', kind: 'weapon', phase: 'first', featuredCharacters: [],
      featuredWeapons: [{ name: '백조의 호수', rarity: 5 }, { name: '붉은 달의 형상', rarity: 5 }, { name: '페보니우스 검', rarity: 4 }, { name: '녹슨 활', rarity: 4 }],
    },
  ]);
  assert.deepEqual(normalize(source, page, '2026-08-12T04:00:00Z').banners, extractBannerInfo(page));
});

test('removes Naver editor metadata from official pickup names', () => {
  const banners = extractBannerInfo({
    title: '[바람의 약속] 캐릭터 이벤트 튜닝',
    text: '5성 캐릭터 「#000000\nnodeStyle\ntextNode\nSE-abcd\n수수\n#ac9a00\nnodeStyle\ntextNode\nSE-ef12」',
  });
  assert.deepEqual(banners[0].featuredCharacters, [{ name: '수수', rarity: 5 }]);
});

test('keeps text-only banner identity without inventing image-only featured targets', () => {
  const page = {
    title: '[노을에 깃든 이슬] 무기 이벤트 튜닝 · 2차', canonical: 'https://game.naver.com/lounge/WutheringWaves/board/detail/1',
    description: '', published: '2026-07-29T12:00:00+09:00', text: '이벤트 튜닝을 통해 더 많은 캐릭터와 무기를 획득하세요. 상세 픽업 대상은 공식 이미지에서 확인해 주세요.',
  };
  assert.deepEqual(extractBannerInfo(page), [{
    name: '노을에 깃든 이슬', kind: 'weapon', phase: 'second', featuredCharacters: [], featuredWeapons: [],
  }]);
});

test('extracts only strongly labeled OCR pickup targets and preserves image evidence', () => {
  const page = {
    title: '[별빛의 부름] 캐릭터 픽업', canonical: 'https://forum.netmarble.com/stardive_ko/view/6/1',
    description: '', published: '2026-08-16T12:00:00+09:00', text: '상세 내용은 이미지를 확인해 주세요.',
    imageUrls: ['https://hedwig-cf.netmarble.com/official/banner.jpg'],
    ocrText: '5성 픽업 캐릭터: 프리렌\n4성 픽업 캐릭터: 클라우디아\n무관한 이벤트 문구\n5성 픽업 무기: 별빛의 검',
  };
  assert.deepEqual(extractBannerInfo(page), [{
    name: '별빛의 부름', kind: 'character', phase: 'unknown',
    featuredCharacters: [
      { name: '프리렌', rarity: 5, extractionMethod: 'official-image-ocr', confidence: 'unverified' },
      { name: '클라우디아', rarity: 4, extractionMethod: 'official-image-ocr', confidence: 'unverified' },
    ],
    featuredWeapons: [{ name: '별빛의 검', rarity: 5, extractionMethod: 'official-image-ocr', confidence: 'unverified' }],
    sourceImageUrls: ['https://hedwig-cf.netmarble.com/official/banner.jpg'],
    ocrText: page.ocrText,
  }]);
});

test('extracts official HTTPS image URLs without accepting unrelated links', () => {
  const value = '<img src="https://official.example/banner.jpg"><img data-src="http://unsafe.example/a.png"> https://official.example/card.webp?type=w1678';
  assert.deepEqual(extractImageUrls(value), ['https://official.example/banner.jpg', 'https://official.example/card.webp?type=w1678']);
});

test('keeps the complete Naver image proxy path and exposes it even before OCR succeeds', () => {
  const imageUrl = 'https://nng-phinf.pstatic.net/hash.PNG/01-%EA%B3%B5%EC%A7%80.png?type=w1678';
  assert.deepEqual(extractImageUrls(`<img src="${imageUrl}">`), [imageUrl]);
  assert.deepEqual(extractBannerInfo({
    title: '[단비에서 전하는 연꽃 바람의 축복] 캐릭터 이벤트 튜닝',
    text: '상세 픽업 정보는 공식 이미지에서 확인해 주세요.', imageUrls: [imageUrl],
  }), [{
    name: '단비에서 전하는 연꽃 바람의 축복', kind: 'character', phase: 'unknown',
    featuredCharacters: [], featuredWeapons: [], sourceImageUrls: [imageUrl],
  }]);
});

test('stores strongly labeled OCR redemption codes as review candidates only', () => {
  const candidates = extractRedemptionCandidatesFromOcr(
    { gameId: 'wuthering', locale: 'ko-KR' },
    { title: '3.6 버전 프리뷰 특별 방송', canonical: 'https://game.naver.com/lounge/WutheringWaves/board/detail/1', imageUrl: 'https://nng-phinf.pstatic.net/code.png' },
    '리딤 코드: WAVE2026\n초대 코드: FRIENDONLY',
    '2026-08-16T14:00:00Z',
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateCode, 'WAVE2026');
  assert.equal(candidates[0].status, 'pending');
  assert.equal(candidates[0].mediaType, 'official-image');
});

test('discovers unrestricted HTTPS search results as unverified candidates', () => {
  const candidates = candidatesFromSearchResults(
    { gameId: 'genshin', locale: 'ko-KR' },
    [{ title: '새 코드', url: 'https://community.example/post/1', content: '리딤 코드: WEB2026' }, { title: 'unsafe', url: 'http://unsafe.example', content: '쿠폰 코드: BAD2026' }],
    '2026-08-16T15:00:00Z',
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateCode, 'WEB2026');
  assert.equal(candidates[0].mediaType, 'web-search-result');
  assert.equal(candidates[0].imageUrl, null);
});

test('extracts rendered forum links and Naver document text', () => {
  assert.deepEqual(extractNetmarbleForumLinks('<a data-router="view/6/4009"><span>여름 이벤트 안내</span></a>', { url: 'https://forum.netmarble.com/stardive_ko/list/6/1' }), [{ url: 'https://forum.netmarble.com/stardive_ko/view/6/4009', title: '여름 이벤트 안내' }]);
  assert.match(collectText({ components: [{ value: '2026년 8월 7일 20:00' }] }), /2026년/);
  assert.equal(decodeHtml('&#x1f4e3; 공식 방송'), '📣 공식 방송');
  assert.equal(decodeHtml('&lt;개발자 라이브&gt; 안내'), '<개발자 라이브> 안내');
});

test('limits Netmarble images to the official article body', () => {
  const page = extractPage([
    '<img src="https://sgimage.netmarble.com/ui.png">',
    '<div class="contents_detail" id="contentsDetail"><p>신규 이벤트 [모집] “별빛의 약속”</p><img src="https://hedwig-cf.netmarble.com/official-banner.jpg"></div>',
    '<div class="contents_detail" id="contentsBlock"><img src="https://sgimage.netmarble.com/sticker.png"></div>',
  ].join(''), { url: 'https://forum.netmarble.com/stardive_ko/view/3/1', title: '업데이트 안내' });
  assert.deepEqual(page.imageUrls, ['https://hedwig-cf.netmarble.com/official-banner.jpg']);
});

test('exposes official Monster recruitment names as banner candidates', () => {
  assert.deepEqual(extractBannerInfo({
    title: '「현실과 현상을 기록하는 이단심판관 」 업데이트 안내',
    text: '✨ 신규 ★5 캐릭터 [메이벨] 추가 ✨ 신규 모집 추가 - 이벤트 [모집] “현실과 현상을 기록하는 이단 심판관”이 추가됩니다.',
    imageUrls: ['https://hedwig-cf.netmarble.com/official-banner.jpg'],
  }), [{
    name: '현실과 현상을 기록하는 이단 심판관', kind: 'character', phase: 'unknown',
    featuredCharacters: [{ name: '메이벨', rarity: 5 }], featuredWeapons: [], sourceImageUrls: ['https://hedwig-cf.netmarble.com/official-banner.jpg'],
  }]);
});

test('associates a Monster recruitment with its explicitly described new character', () => {
  const banners = extractBannerInfo({
    title: '「추앙하지 않는 자, 모두 유죄」 업데이트 안내',
    text: '신규 ★5 캐릭터 [나기] 추가 - 백린의 무녀, [나기]가 신규 캐릭터로 추가됩니다. 신규 모집 추가 - 이벤트 [모집] “백린의 무녀”가 추가됩니다. - 이벤트 [모집] “교룡의 백린”이 추가됩니다.',
    imageUrls: ['https://hedwig-cf.netmarble.com/update.jpg'],
  });
  assert.deepEqual(banners[0].featuredCharacters, [{ name: '나기', rarity: 5 }]);
  assert.deepEqual(banners[1].featuredCharacters, []);
});

test('exposes an official Monster character showcase as a pickup candidate', () => {
  assert.deepEqual(extractBannerInfo({
    title: '메이드와 토끼풀 여관의 간판 메이드, 에스데 등장! - 몬길: STAR DIVE',
    text: '',
    imageUrls: ['https://hedwig-cf.netmarble.com/esde.jpg'],
  }), [{
    name: '메이드와 토끼풀 여관의 간판 메이드', kind: 'character', phase: 'unknown',
    featuredCharacters: [{ name: '에스데', rarity: null }], featuredWeapons: [],
    sourceImageUrls: ['https://hedwig-cf.netmarble.com/esde.jpg'],
  }]);
});

test('retains an official timeless Monster pickup as a public banner event', () => {
  const event = normalize({ gameId: 'monster', locale: 'ko-KR' }, {
    title: '운명의 힘을 품은 구미호, 미나 등장! - 몬길: STAR DIVE',
    canonical: 'https://forum.netmarble.com/stardive_ko/view/20/2268',
    published: '2026-04-29T10:03:00+09:00', text: '', description: '',
    imageUrls: ['https://hedwig-cf.netmarble.com/mina.jpg'],
  }, '2026-08-16T00:00:00Z');

  assert.equal(event.type, 'banner');
  assert.equal(event.startsAt, null);
  assert.equal(event.status, 'unknown');
  assert.deepEqual(mergeEventHistory([], [event]), [event]);
});

test('selects Netmarble candidates fairly across official boards', () => {
  const shared = { url: 'https://forum.netmarble.com/stardive_ko/view/2/1', title: '고정 공지' };
  const groups = [
    [shared, ...Array.from({ length: 8 }, (_, index) => ({ url: `https://forum.netmarble.com/stardive_ko/view/2/${index + 10}`, title: `공지 ${index}` }))],
    [shared, { url: 'https://forum.netmarble.com/stardive_ko/view/4/5445', title: '개발자 노트 #9' }],
    [shared, { url: 'https://forum.netmarble.com/stardive_ko/view/6/5442', title: '8월 12일 이벤트 안내' }],
  ];
  const selected = selectNetmarbleForumCandidates(groups, 6);
  assert.ok(selected.some((candidate) => candidate.url.endsWith('/4/5445')));
  assert.ok(selected.some((candidate) => candidate.url.endsWith('/6/5442')));
  assert.equal(new Set(selected.map((candidate) => candidate.url)).size, selected.length);
});

test('prioritizes official Monster character showcases within the daily detail limit', () => {
  const selected = selectNetmarbleForumCandidates([
    [
      { url: 'https://forum.netmarble.com/stardive_ko/view/2/1', title: '일반 공지' },
      { url: 'https://forum.netmarble.com/stardive_ko/view/2/2', title: '추가 공지' },
    ],
    [
      { url: 'https://forum.netmarble.com/stardive_ko/view/20/3', title: '공식 영상' },
      { url: 'https://forum.netmarble.com/stardive_ko/view/20/4', title: '간판 메이드, 에스데 등장!' },
    ],
  ], 2);
  assert.ok(selected.some((candidate) => candidate.title.includes('에스데 등장!')));
});

test('reports an official timeless Netmarble banner as collected', () => {
  const banners = [{ name: '별빛의 약속', kind: 'mixed', phase: 'unknown', featuredCharacters: [], featuredWeapons: [] }];
  assert.deepEqual(diagnoseNetmarbleCandidate(
    { title: '업데이트 안내', url: 'https://forum.netmarble.com/stardive_ko/view/3/1', finalUrl: 'https://forum.netmarble.com/stardive_ko/view/3/1' },
    { gameId: 'monster', startsAt: null, endsAt: null, banners },
    { text: '신규 이벤트 [모집] 「별빛의 약속」이 추가됩니다.' },
  ), {
    title: '업데이트 안내', sourceUrl: 'https://forum.netmarble.com/stardive_ko/view/3/1',
    outcome: 'collected', banners,
  });
});

test('discovers configured Naver board posts beyond current pins and keeps official authors only', () => {
  const naverSource = { gameId: 'wuthering', locale: 'ko-KR', canonicalBase: 'https://game.naver.com/lounge/WutheringWaves/board/detail/', officialNickname: 'GM 연구소' };
  const official = { user: { nickname: 'GM 연구소' }, feed: { feedId: 7917001, createdDate: '20260711200035', title: '양양의 드림 이스케이프 · 정답 공개', contents: JSON.stringify({ components: [{ value: '최종 리딤 코드는 [F5F4D3B2A2]' }] }) } };
  const community = { user: { nickname: '일반 사용자' }, feed: { feedId: 999, createdDate: '20260711200035', title: '비공식 코드', contents: '{}' } };

  const pages = extractNaverOfficialPages([[official], [official, community]], naverSource, 30);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].canonical, 'https://game.naver.com/lounge/WutheringWaves/board/detail/7917001');
  assert.match(pages[0].text, /F5F4D3B2A2/);
});

test('builds paginated Naver feed URLs from each configured lounge', () => {
  const url = createNaverFeedUrl({ loungeId: 'nte' }, { offset: 2, limit: 30, boardId: 17 });
  assert.equal(url.pathname, '/nng_main/v1/community/lounge/nte/feed');
  assert.equal(url.searchParams.get('offset'), '2');
  assert.equal(url.searchParams.get('boardId'), '17');
});

test('accepts only the configured official NTE manager and ignores malformed feeds', () => {
  const nteSource = {
    gameId: 'nte', locale: 'ko-KR', canonicalBase: 'https://game.naver.com/lounge/nte/board/detail/',
    officialNickname: '이 환', officialUserRoleCode: 'game_manager',
  };
  const official = { user: { nickname: '이 환', userRoleCode: 'game_manager' }, feed: { feedId: 8063606, createdDate: '20260815140035', title: '이환 이벤트 안내', contents: '{"value":"2026년 8월 21일 10:00 ~ 8월 25일 20:00"}' } };
  const sameNicknameWithoutRole = { ...official, user: { nickname: '이 환', userRoleCode: 'user' }, feed: { ...official.feed, feedId: 2 } };

  const pages = extractNaverOfficialPages([[official, sameNicknameWithoutRole, {}, { user: null, feed: null }]], nteSource);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].canonical, 'https://game.naver.com/lounge/nte/board/detail/8063606');
  assert.match(pages[0].text, /2026년 8월 21일/);
});

test('extracts and merges official NTE character profiles separately from schedules', () => {
  const nteSource = { gameId: 'nte', locale: 'ko-KR', canonicalBase: 'https://game.naver.com/lounge/nte/board/detail/', officialNickname: '이 환', officialUserRoleCode: 'game_manager', characters: { titlePattern: '캐릭터 파일 소개丨' } };
  const item = { user: { nickname: '이 환', userRoleCode: 'game_manager' }, feed: { feedId: 8059055, createdDate: '20260814130034', title: '캐릭터 파일 소개丨잔홍', repImageUrl: 'https://nng-phinf.pstatic.net/zanhong.jpg', contents: '{"value":"잔홍 공식 캐릭터 소개"}' } };
  const [character] = extractNaverCharacters([item], nteSource, '2026-08-17T00:00:00Z');
  assert.equal(character.name, '잔홍');
  assert.equal(character.summary, '잔홍 공식 캐릭터 소개');
  assert.equal(character.publishedAt, '2026-08-14T13:00:34+09:00');
  assert.deepEqual(character.imageUrls, ['https://nng-phinf.pstatic.net/zanhong.jpg']);
  assert.equal(mergeCharacterHistory([{ ...character, summary: 'old' }], [character])[0].summary, character.summary);
  assert.deepEqual(extractNaverCharacters([{ ...item, user: { nickname: '일반 사용자', userRoleCode: 'user' } }], nteSource, '2026-08-17T00:00:00Z'), []);
});

test('extracts banner text and complete images from official Naver HTML contents', () => {
  const imageUrl = 'https://nng-phinf.pstatic.net/hash.PNG/01-banner.png?type=w1678';
  const source = { canonicalBase: 'https://game.naver.com/lounge/WutheringWaves/board/detail/', officialNickname: 'GM 연구소' };
  const official = { user: { nickname: 'GM 연구소' }, feed: {
    feedId: 7992626, createdDate: '20260812120000', title: '[단비에서 전하는 연꽃 바람의 축복] 캐릭터 이벤트 튜닝',
    contents: `<p>5성 캐릭터 「카르티시아」</p><img src="${imageUrl}">`,
  } };

  const [page] = extractNaverOfficialPages([[official]], source);
  assert.match(page.text, /카르티시아/);
  assert.deepEqual(page.imageUrls, [imageUrl]);
  assert.deepEqual(extractBannerInfo(page)[0].featuredCharacters, [{ name: '카르티시아', rarity: 5 }]);
  assert.deepEqual(extractBannerInfo(page)[0].sourceImageUrls, [imageUrl]);
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

test('extracts a bracketed Wuthering Waves redemption code from official prose', () => {
  const codes = extractRedemptionCodes({ ...source, gameId: 'wuthering' }, {
    title: '양양의 드림 이스케이프 · 정답 공개',
    canonical: 'https://game.naver.com/lounge/WutheringWaves/board/detail/7917001',
    published: '2026-07-11T20:00:35+09:00',
    text: '그림을 순서대로 조합한 최종 리딤 코드는\nnodeStyle\ntextNode\nSE-4d0800cf-9ee4-4ad6-8607-d9cab6d34eca\n[F5F4D3B2A2]\n입니다. 해당 리딤 코드는 3.5 버전 종료 시까지 유효합니다.',
  }, '2026-08-16T12:50:53.008Z');

  assert.equal(codes.length, 1);
  assert.equal(codes[0].code, 'F5F4D3B2A2');
  assert.equal(codes[0].status, 'unknown');
  assert.equal(codes[0].sourceTimeText, '해당 리딤 코드는 3.5 버전 종료 시까지 유효');
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

test('records official redemption source changes without deleting code history', () => {
  const existing = [{ id: 'code', gameId: 'genshin', code: 'PUBLIC2026', sourceUrl: 'https://example.com/code', contentHash: 'old', changeHistory: [], retrievedAt: '2026-08-01T00:00:00Z', expiresAt: null }];
  const collected = [{ ...existing[0], contentHash: 'new', lastVerifiedAt: '2026-08-16T00:00:00Z', retrievedAt: '2026-08-16T00:00:00Z' }];
  const merged = mergeRedemptionCodeHistory(existing, collected);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].changeHistory, [{ detectedAt: '2026-08-16T00:00:00Z', previousHash: 'old', currentHash: 'new' }]);
});

test('merges richer official region, rewards, and expiry for the same code', () => {
  const base = { id: 'code', gameId: 'genshin', code: 'PUBLIC2026', sourceUrl: 'https://example.com/one', region: null, rewards: ['원석 100'], expiresAt: null, retrievedAt: '2026-08-01T00:00:00Z' };
  const richer = { ...base, sourceUrl: 'https://example.com/two', region: '아시아', rewards: ['모라 5만'], expiresAt: '2026-09-01T00:00:00+09:00', retrievedAt: '2026-08-02T00:00:00Z' };
  const [merged] = mergeRedemptionCodeHistory([base], [richer]);
  assert.equal(merged.region, '아시아');
  assert.deepEqual(merged.rewards, ['원석 100', '모라 5만']);
  assert.equal(merged.expiresAt, '2026-09-01T00:00:00+09:00');
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

test('splits API event imports by UTF-8 JSON byte size without losing order', () => {
  const values = Array.from({ length: 12 }, (_, index) => ({ id: index, title: '한글'.repeat(20) }));
  const batches = splitJsonArray(values, 500);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => Buffer.byteLength(JSON.stringify(batch)) <= 500));
  assert.deepEqual(batches.flat(), values);
  assert.throws(() => splitJsonArray([{ title: '한'.repeat(200) }], 100), /single event exceeds/);
});
