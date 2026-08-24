import { createHash } from 'node:crypto';

export const USER_AGENT = 'GameTimeCalendar/0.1 (+official schedule collector)';

function decodeHtmlEntities(value = '') {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

export function decodeHtml(value = '') {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function collectText(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectText(item, output);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectText(item, output);
  return output.join('\n');
}

function collectNaverDocumentText(value, output = []) {
  if (Array.isArray(value)) for (const item of value) collectNaverDocumentText(item, output);
  else if (value && typeof value === 'object') {
    if (typeof value.value === 'string') output.push(value.value);
    else if (value.value !== undefined) collectNaverDocumentText(value.value, output);
    for (const [key, item] of Object.entries(value)) if (key !== 'value') collectNaverDocumentText(item, output);
  }
  return output.join('\n');
}

export function extractImageUrls(value = '') {
  const urls = new Set();
  for (const match of String(value).matchAll(/https:\/\/[^\s"'<>\\]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>\\]*)?/gi)) {
    try {
      const url = new URL(decodeHtmlEntities(match[0]));
      if (url.protocol === 'https:') urls.add(url.toString());
    } catch {}
  }
  return [...urls];
}

export function isOfficialNaverAuthor(item, source) {
  if (!item?.user || !source?.officialNickname) return false;
  if (item.user.nickname !== source.officialNickname) return false;
  return !source.officialUserRoleCode || item.user.userRoleCode === source.officialUserRoleCode;
}

export function createNaverFeedUrl(source, { offset = 0, limit = 30, boardId }) {
  const loungeId = source.loungeId || 'WutheringWaves';
  const url = new URL(`https://comm-api.game.naver.com/nng_main/v1/community/lounge/${loungeId}/feed`);
  url.search = new URLSearchParams({ offset: String(offset), limit: String(limit), order: 'NEW', boardId: String(boardId), buffFilteringYN: 'N' });
  return url;
}

export function extractNaverOfficialPages(feedGroups, source, limit = 30) {
  const byId = new Map();
  for (const item of feedGroups.flat()) {
    if (!isOfficialNaverAuthor(item, source) || !item.feed?.feedId) continue;
    byId.set(String(item.feed.feedId), item);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.feed.createdDate || '').localeCompare(String(a.feed.createdDate || '')))
    .slice(0, limit)
    .map((item) => {
      let document = {};
      const contents = item.feed.contents || '';
      try { document = JSON.parse(contents || '{}'); } catch {}
      const created = item.feed.createdDate;
      const publishedAt = /^\d{14}$/.test(created) ? `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}T${created.slice(8, 10)}:${created.slice(10, 12)}:${created.slice(12, 14)}+09:00` : null;
      const structuredText = collectText(document);
      const text = structuredText || decodeHtml(contents);
      const imageSource = `${contents}\n${item.feed.repImageUrl || ''}`;
      return { title: decodeHtml(item.feed.title), canonical: `${source.canonicalBase}${item.feed.feedId}`, description: '', published: publishedAt, text, imageUrls: extractImageUrls(imageSource) };
    });
}

export function extractNaverCharacters(items, source, retrievedAt) {
  const marker = source.characters?.titlePattern || '캐릭터 파일 소개丨';
  const characters = [];
  for (const item of items) {
    if (!isOfficialNaverAuthor(item, source) || !item.feed?.feedId || !item.feed.title?.startsWith(marker)) continue;
    const name = decodeHtml(item.feed.title.slice(marker.length)).trim();
    if (!name) continue;
    let document = {};
    try { document = JSON.parse(item.feed.contents || '{}'); } catch {}
    const text = decodeHtml(collectNaverDocumentText(document)).replace(/\s+/g, ' ').trim();
    const created = item.feed.createdDate;
    const publishedAt = /^\d{14}$/.test(created || '') ? `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}T${created.slice(8, 10)}:${created.slice(10, 12)}:${created.slice(12, 14)}+09:00` : null;
    const sourceUrl = `${source.canonicalBase}${item.feed.feedId}`;
    characters.push({
      id: `${source.gameId}-character-${createHash('sha256').update(sourceUrl).digest('hex').slice(0, 14)}`,
      gameId: source.gameId, name, sourceTitle: decodeHtml(item.feed.title), sourceUrl, sourceLocale: source.locale,
      publishedAt, summary: text.slice(0, 1000), imageUrls: extractImageUrls(`${item.feed.contents || ''}\n${item.feed.repImageUrl || ''}`), retrievedAt,
    });
  }
  return characters;
}

export function mergeCharacterHistory(existing, collected) {
  const byCharacter = new Map(existing.map((character) => [`${character.gameId}:${character.name}`, character]));
  for (const character of collected) byCharacter.set(`${character.gameId}:${character.name}`, character);
  return [...byCharacter.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function absoluteUrl(value, base) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

export function extractLinks(html, source) {
  const results = []; const seen = new Set();
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const url = absoluteUrl(match[1], source.url); const title = decodeHtml(match[2]);
    if (!url || !title || seen.has(url)) continue;
    const parsed = new URL(url);
    if (!source.allowedHosts.includes(parsed.hostname)) continue;
    if (source.detailPattern && !parsed.pathname.includes(source.detailPattern) && !source.keywords.some((keyword) => title.includes(keyword))) continue;
    seen.add(url); results.push({ url, title });
  }
  return results;
}

export function extractNetmarbleForumLinks(html, source) {
  const results = []; const seen = new Set();
  const anchors = /<a\b[^>]*(?:href=["']([^"']*\/view\/\d+\/\d+)["']|data-router=["']view\/(\d+\/\d+)["'])[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const value = match[1] || `/stardive_ko/view/${match[2]}`;
    const url = absoluteUrl(value, source.url); const title = decodeHtml(match[3]);
    if (url && title && !seen.has(url)) {
      const publishedDate = extractNetmarbleListedDate(title);
      seen.add(url); results.push({ url, title, ...(publishedDate ? { publishedDate } : {}) });
    }
  }
  return results;
}

function extractNetmarbleListedDate(title) {
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const match = title.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s*(20\d{2})\b/i);
  if (!match) return null;
  const month = months[match[1].slice(0, 3).toLowerCase()];
  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
}

export function selectNetmarbleForumCandidates(linkGroups, limit = 30) {
  const selected = [];
  const seen = new Set();
  for (const candidate of linkGroups.flat().filter((item) => /,\s*[^,]+\s*등장!/.test(item.title))) {
    if (selected.length >= limit || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    selected.push(candidate);
  }
  const positions = linkGroups.map(() => 0);
  while (selected.length < limit) {
    let advanced = false;
    for (let groupIndex = 0; groupIndex < linkGroups.length && selected.length < limit; groupIndex += 1) {
      const group = linkGroups[groupIndex];
      while (positions[groupIndex] < group.length) {
        const candidate = group[positions[groupIndex]++];
        advanced = true;
        if (seen.has(candidate.url)) continue;
        seen.add(candidate.url);
        selected.push(candidate);
        break;
      }
    }
    if (!advanced) break;
  }
  return selected;
}

export function diagnoseNetmarbleCandidate(candidate, event = null, page = null) {
  if (candidate.error) return { title: candidate.title, sourceUrl: candidate.url, outcome: 'excluded', reason: 'detail-render-failed' };
  const warnings = /모집|픽업|확률\s*(?:UP|업)|확정\s*획득/i.test(`${candidate.title}\n${page?.text || ''}`) && !event?.banners?.length
    ? ['possible-banner-without-structured-pickups'] : [];
  return {
    title: candidate.title, sourceUrl: candidate.finalUrl || candidate.url,
    outcome: isCollectableEvent(event) ? 'collected' : 'excluded',
    ...(isCollectableEvent(event) ? {} : { reason: 'missing-explicit-schedule-time' }),
    ...(event?.banners?.length ? { banners: event.banners } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

function meta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match) return decodeHtml(match[1]); }
  return null;
}

export function extractPage(html, candidate) {
  const title = meta(html, 'og:title') || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || candidate.title;
  const description = meta(html, 'og:description') || meta(html, 'description') || '';
  const visiblePublished = decodeHtml(html).match(/\|\s*(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2})\s*\|/);
  const published = meta(html, 'article:published_time') || (visiblePublished ? `${visiblePublished[1]}-${visiblePublished[2].padStart(2, '0')}-${visiblePublished[3].padStart(2, '0')}T${visiblePublished[4].padStart(2, '0')}:${visiblePublished[5]}:00+09:00` : null);
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || candidate.url;
  const articleHtml = html.match(/<div\b[^>]*class=["'][^"']*contents_detail[^"']*["'][^>]*id=["']contentsDetail["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*contents_detail[^"']*["'][^>]*id=["']contentsBlock["'])/i)?.[1] || html;
  return { title, description, published, ...(candidate.publishedDate ? { publishedDate: candidate.publishedDate } : {}), canonical: absoluteUrl(canonical, candidate.url) || candidate.url, text: decodeHtml(articleHtml), imageUrls: extractImageUrls(articleHtml) };
}

export function extractNetmarbleOfficialPage(payload, candidate) {
  const article = payload?.article;
  const match = String(candidate.url).match(/\/view\/(\d+)\/(\d+)(?:[/?#]|$)/);
  if (payload?.code !== 0 || !article || !match || Number(article.menuSeq) !== Number(match[1]) || Number(article.id) !== Number(match[2])) {
    throw new Error('Invalid Netmarble official article response');
  }
  const published = Number.isFinite(Number(article.regDate)) ? new Date(Number(article.regDate)).toISOString() : null;
  return {
    title: decodeHtml(article.title) || candidate.title, description: '', published,
    canonical: candidate.url, text: decodeHtml(article.content || ''), imageUrls: extractImageUrls(article.content || ''),
  };
}

export function classify(title) {
  if (/점검|maintenance/i.test(title)) return 'maintenance';
  if (/방송|프리뷰|special program|livestream/i.test(title)) return 'broadcast';
  if (/기원|픽업|튜닝|convene|banner/i.test(title)) return 'banner';
  if (/업데이트|버전|update|patch/i.test(title)) return 'update';
  if (/이벤트|event/i.test(title)) return 'event';
  return 'notice';
}

function bannerPhase(title) {
  if (/(?:제\s*1\s*회|1\s*차|전반)/i.test(title)) return 'first';
  if (/(?:제\s*2\s*회|2\s*차|후반)/i.test(title)) return 'second';
  return 'unknown';
}

function bannerKind(title, text) {
  if (/캐릭터\s*[/·&]\s*무기|무기\s*[/·&]\s*캐릭터/i.test(title)) return 'mixed';
  if (/무기/i.test(title)) return 'weapon';
  if (/캐릭터|공명자/i.test(title)) return 'character';
  const hasCharacter = /캐릭터|공명자/i.test(text);
  const hasWeapon = /무기/i.test(text);
  if (hasCharacter && hasWeapon) return 'mixed';
  if (hasWeapon) return 'weapon';
  return 'character';
}

function targetName(label) {
  const withoutEditorMetadata = label.split(/\r?\n/).map((value) => value.trim())
    .filter((value) => value && !/^#(?:[0-9a-f]{3,8})$/i.test(value) && !/^(?:nodeStyle|textNode|SE-[0-9a-f-]+)$/i.test(value))
    .join(' ');
  const withoutElement = withoutEditorMetadata.replace(/\s*\([^)]+\)\s*$/, '').trim();
  return withoutElement.split('·').at(-1).trim();
}

function extractFeaturedTargets(text) {
  const characters = new Map();
  const weapons = new Map();
  const pattern = /(?:★\s*)?([45])\s*성?\s*(캐릭터|공명자|무기)\s*((?:「[^」]+」(?:\s*[,，]\s*)?)+)/g;
  for (const match of text.matchAll(pattern)) {
    const output = match[2] === '무기' ? weapons : characters;
    for (const quoted of match[3].matchAll(/「([^」]+)」/g)) {
      const name = targetName(quoted[1]);
      output.set(name, { name, rarity: Number(match[1]) });
    }
  }
  return { featuredCharacters: [...characters.values()], featuredWeapons: [...weapons.values()] };
}

function extractOcrFeaturedTargets(text = '') {
  const characters = new Map();
  const weapons = new Map();
  const pattern = /(?:★\s*)?([45])\s*성\s*(?:픽업\s*)?(캐릭터|공명자|무기)\s*[:：-]?\s*[「『\[]?([가-힣A-Za-z][가-힣A-Za-z0-9 '’·-]{1,30})/gi;
  for (const match of text.matchAll(pattern)) {
    const output = match[2] === '무기' ? weapons : characters;
    const name = match[3].trim().replace(/[」』\]]+$/, '').trim();
    if (!name || /이벤트|기간|확률|안내/.test(name)) continue;
    output.set(name, { name, rarity: Number(match[1]), extractionMethod: 'official-image-ocr', confidence: 'unverified' });
  }
  return { featuredCharacters: [...characters.values()], featuredWeapons: [...weapons.values()] };
}

export function extractBannerInfo(page) {
  const recruitmentNames = [...String(page.text).matchAll(/이벤트\s*\[모집\]\s*[“"「]([^”"」]+)[”"」]/g)].map((match) => match[1].trim());
  const showcase = page.title.match(/^(.+),\s*([^,]+?)\s*등장!\s*(?:-\s*몬길:\s*STAR DIVE)?$/i);
  if (classify(page.title) !== 'banner' && !recruitmentNames.length && !showcase) return [];
  const phase = bannerPhase(page.title);
  const imageEvidence = page.imageUrls?.length ? { sourceImageUrls: page.imageUrls } : {};
  if (showcase && !recruitmentNames.length) {
    return [{
      name: showcase[1].trim(), kind: 'character', phase,
      featuredCharacters: [{ name: showcase[2].trim(), rarity: null }], featuredWeapons: [], ...imageEvidence,
    }];
  }
  if (recruitmentNames.length) {
    const newCharacters = [...String(page.text).matchAll(/신규\s*(?:★\s*)?([45])\s*성?\s*캐릭터\s*\[\s*([^\]]+?)\s*\]/g)]
      .map((match) => {
        const name = match[2].trim();
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const descriptor = String(page.text).match(new RegExp(`-\\s*([^,]{2,100}),\\s*\\[\\s*${escapedName}\\s*\\]가\\s*신규\\s*캐릭터`))?.[1]?.trim() || '';
        return { name, rarity: Number(match[1]), descriptor };
      });
    const newWeapons = [...String(page.text).matchAll(/신규\s*(?:★\s*)?([45])\s*성?\s*(?:무기|장비)\s*\[\s*([^\]]+?)\s*\]/g)]
      .map((match) => ({ name: match[2].trim(), rarity: Number(match[1]) }));
    return [...new Set(recruitmentNames)].map((name) => {
      const compactName = name.replace(/\s+/g, '');
      const matchesHeading = page.title.replace(/\s+/g, '').includes(compactName);
      const featuredCharacters = newCharacters.filter((target) => {
        const compactDescriptor = target.descriptor.replace(/\s+/g, '');
        return matchesHeading || (compactDescriptor && (compactDescriptor.includes(compactName) || compactName.includes(compactDescriptor)));
      })
        .map(({ descriptor, ...target }) => target);
      const featuredWeapons = matchesHeading ? newWeapons : [];
      const kind = featuredCharacters.length && !featuredWeapons.length ? 'character'
        : featuredWeapons.length && !featuredCharacters.length ? 'weapon' : 'mixed';
      return { name, kind, phase, featuredCharacters, featuredWeapons, ...imageEvidence };
    });
  }
  const evidence = {
    ...imageEvidence,
    ...(page.ocrText ? { ocrText: page.ocrText } : {}),
  };
  const banners = [];
  const sectionPattern = /「([^」]+)」\s*(?:이벤트\s*)?(?:기원|튜닝)\s*[:：]([\s\S]*?)(?=「[^」]+」\s*(?:이벤트\s*)?(?:기원|튜닝)\s*[:：]|$)/g;
  for (const section of page.text.matchAll(sectionPattern)) {
    const targets = extractFeaturedTargets(section[2]);
    const kind = targets.featuredCharacters.length && targets.featuredWeapons.length ? 'mixed'
      : targets.featuredWeapons.length ? 'weapon' : 'character';
    banners.push({ name: section[1].trim(), kind, phase, ...targets, ...evidence });
  }
  if (banners.length) return banners;

  const bracketName = page.title.match(/[「[]([^」\]]+)[」\]]/)?.[1]?.trim();
  const name = bracketName || page.title.trim();
  const textTargets = extractFeaturedTargets(page.text);
  const hasTextTargets = textTargets.featuredCharacters.length || textTargets.featuredWeapons.length;
  const targets = hasTextTargets ? textTargets : extractOcrFeaturedTargets(page.ocrText);
  return [{
    name, kind: bannerKind(page.title, page.text), phase, ...targets,
    ...evidence,
  }];
}

export function extractTime(text, referenceYear = null) {
  const iso = (y, m, d, h, min) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min.padStart(2, '0')}:00+09:00`;
  const sameDayRange = text.match(/(20\d{2})[.년\-/]\s*(\d{1,2})[.월\-/]\s*(\d{1,2})일?\s*(?:\([^)]+\))?\s*(\d{1,2})[:시]\s*(\d{2})?\s*(?:부터|~|～|—|–|-)\s*(\d{1,2})[:시]\s*(\d{2})?/);
  if (sameDayRange) {
    const [, year, month, day, startHour, startMinute = '00', endHour, endMinute = '00'] = sameDayRange;
    return {
      startsAt: iso(year, month, day, startHour, startMinute),
      endsAt: iso(year, month, day, endHour, endMinute),
      sourceTimeText: sameDayRange[0],
    };
  }
  const range = text.match(/(20\d{2})[.년\-/]\s*(\d{1,2})[.월\-/]\s*(\d{1,2})일?\s*(?:\([^)]+\))?\s*(\d{1,2})[:시]\s*(\d{2})?\s*(?:부터|~|～|—|–|-)[\s\S]{0,80}?(?:(20\d{2})[.년\-/]\s*)?(\d{1,2})[.월\-/]\s*(\d{1,2})일?\s*(?:\([^)]+\))?\s*(\d{1,2})[:시]\s*(\d{2})?/);
  if (range) {
    const [, sy, sm, sd, sh, smin = '00', ey = sy, em, ed, eh, emin = '00'] = range;
    return { startsAt: iso(sy, sm, sd, sh, smin), endsAt: iso(ey, em, ed, eh, emin), sourceTimeText: range[0] };
  }
  const updateRelative = text.match(/버전\s*업데이트\s*후\s*(?:부터|~|～|—|–|-)\s*(20\d{2})[.년\-/]\s*(\d{1,2})[.월\-/]\s*(\d{1,2})일?\s*(?:\([^)]+\))?\s*(\d{1,2})[:시]\s*(\d{2})?/);
  if (updateRelative) return {
    startsAt: null,
    endsAt: iso(updateRelative[1], updateRelative[2], updateRelative[3], updateRelative[4], updateRelative[5] || '00'),
    sourceTimeText: updateRelative[0],
  };
  const shortRange = referenceYear && text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일[^\d]{0,20}(\d{1,2}):(\d{2})\s*(?:부터|~|～|—|–|-)\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[^\d]{0,20}(\d{1,2}):(\d{2})/);
  if (shortRange) return { startsAt: iso(String(referenceYear), shortRange[1], shortRange[2], shortRange[3], shortRange[4]), endsAt: iso(String(referenceYear), shortRange[5], shortRange[6], shortRange[7], shortRange[8]), sourceTimeText: shortRange[0] };
  const single = text.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일[^\d]{0,20}(\d{1,2}):(\d{2})/);
  if (single) return { startsAt: iso(single[1], single[2], single[3], single[4], single[5]), endsAt: null, sourceTimeText: single[0] };
  return { startsAt: null, endsAt: null, sourceTimeText: '' };
}

export function normalize(source, page, retrievedAt, now = Date.now()) {
  const publishedAt = page.published && !Number.isNaN(Date.parse(page.published)) ? new Date(page.published).toISOString() : null;
  const listedPublishedDate = /^20\d{2}-\d{2}-\d{2}$/.test(page.publishedDate || '') ? page.publishedDate : null;
  const referenceDate = publishedAt || listedPublishedDate;
  const referenceYear = referenceDate ? new Date(referenceDate).getUTCFullYear() : null;
  const timingEstimate = publishedAt
    ? { value: page.published, basis: '게시 시각' }
    : listedPublishedDate
      ? { value: `${listedPublishedDate}T00:00:00+09:00`, basis: '게시일' }
      : { value: retrievedAt, basis: '수집 시각' };
  const extractedTiming = extractTime(page.text, referenceYear);
  const hasOnlyOfficialEnd = !extractedTiming.startsAt && extractedTiming.endsAt;
  const confidence = hasOnlyOfficialEnd || (!extractedTiming.startsAt && !extractedTiming.endsAt) ? 'probable' : 'confirmed';
  const timing = hasOnlyOfficialEnd
    ? collectionStartForEndOnlyTiming(extractedTiming, timingEstimate)
    : (extractedTiming.startsAt || extractedTiming.endsAt ? extractedTiming : collectionWindowTiming(timingEstimate));
  const digest = createHash('sha256').update(page.canonical).digest('hex').slice(0, 14);
  const banners = extractBannerInfo(page);
  return {
    id: `${source.gameId}-${digest}`, gameId: source.gameId, type: banners.length ? 'banner' : classify(page.title),
    title: page.title.replace(/\s*-\s*몬길:\s*STAR DIVE$/i, ''), sourceTitle: page.title, sourceUrl: page.canonical,
    sourceLocale: source.locale, publishedAt,
    startsAt: timing.startsAt, endsAt: timing.endsAt, sourceTimeText: timing.sourceTimeText,
    status: getEventStatus(timing, now), confidence, retrievedAt,
    version: page.title.match(/(?:버전|Version|v)\s*([0-9]+(?:\.[0-9]+)+)/i)?.[1] || null, summary: page.description.slice(0, 240),
    ...(banners.length ? { banners } : {}),
  };
}

function collectionStartForEndOnlyTiming(timing, estimate) {
  const end = Date.parse(timing.endsAt);
  const estimated = Date.parse(estimate.value);
  const startsAt = estimated <= end ? estimate.value : timing.endsAt;
  const reason = startsAt === estimate.value
    ? `${estimate.basis} 추정 (${estimate.value})`
    : `${estimate.basis}이 공식 종료 시각 이후여서 종료 시각으로 제한 (${timing.endsAt})`;
  return {
    startsAt,
    endsAt: timing.endsAt,
    sourceTimeText: `${timing.sourceTimeText}; 원문에는 종료 시각만 명시됨; 시작 시각은 ${reason}`,
  };
}

function collectionWindowTiming(estimate) {
  const estimatedAt = new Date(estimate.value);
  const koreanDate = new Date(estimatedAt.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = new Date(`${koreanDate}T00:00:00+09:00`);
  end.setUTCDate(end.getUTCDate() + 30);
  const endDate = new Date(end.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    startsAt: estimate.value,
    endsAt: `${endDate}T23:59:59+09:00`,
    sourceTimeText: `원문에 일정 시각 없음; ${estimate.basis} 기준 추정 기간 (${koreanDate} ~ ${endDate}, KST)`,
  };
}

export function isCollectableEvent(event) {
  return Boolean(event && (event.startsAt || event.endsAt || (event.gameId === 'monster' && event.banners?.length)));
}

function koreanInstant(match) {
  let hour = Number(match.groups.hour);
  if (match.groups.meridiem === '오후' && hour < 12) hour += 12;
  if (match.groups.meridiem === '오전' && hour === 12) hour = 0;
  const pad = (value) => String(value).padStart(2, '0');
  return `${match.groups.year}-${pad(match.groups.month)}-${pad(match.groups.day)}T${pad(hour)}:${pad(match.groups.minute || 0)}:00+09:00`;
}

function extractRedemptionExpiry(text, referenceDate = null) {
  const pattern = /(?:코드\s*)?(?:사용|입력|교환|유효|만료)[^\n]{0,60}?(?<year>20\d{2})[.년\/-]\s*(?<month>\d{1,2})[.월\/-]\s*(?<day>\d{1,2})일?[^\d\n]{0,20}(?<meridiem>오전|오후)?\s*(?<hour>\d{1,2})(?:[:시]\s*(?<minute>\d{2}))?/;
  const match = text.match(pattern);
  if (match?.groups) return { expiresAt: koreanInstant(match), sourceTimeText: match[0].trim() };
  const shortPattern = /(?:코드\s*)?(?:사용|입력|교환|유효|만료)[^\n]{0,80}?(?<month>\d{1,2})월\s*(?<day>\d{1,2})일?[^\d\n]{0,20}(?<meridiem>오전|오후)?\s*(?<hour>\d{1,2})(?:[:시]\s*(?<minute>\d{2}))?/;
  const shortMatch = text.match(shortPattern);
  if (!shortMatch?.groups || !referenceDate || Number(shortMatch.groups.month) < referenceDate.getUTCMonth() + 1) {
    const versionExpiry = text.match(/(?:해당\s*)?(?:리딤|교환|프로모션)\s*코드는?\s*\d+(?:\.\d+)*\s*버전\s*종료\s*시까지\s*유효/i);
    return { expiresAt: null, sourceTimeText: versionExpiry?.[0]?.trim() || '' };
  }
  shortMatch.groups.year = String(referenceDate.getUTCFullYear());
  return { expiresAt: koreanInstant(shortMatch), sourceTimeText: shortMatch[0].trim() };
}

export function getRedemptionCodeStatus(code, now = Date.now()) {
  if (!code.expiresAt || Number.isNaN(Date.parse(code.expiresAt))) return 'unknown';
  return Date.parse(code.expiresAt) < now ? 'expired' : 'active';
}

export function extractGenshinMainRedemptionCodes(source, html, retrievedAt, now = Date.now()) {
  if (source.redemptionCodes?.enabled !== true) return [];
  const texts = [...html.matchAll(/class=["'][^"']*\bpz-text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => decodeHtml(match[1])).filter(Boolean);
  const markerIndex = texts.findIndex((text, index) => /^×\s*\d+$/.test(text) && /redeem code/i.test(texts[index - 1] || ''));
  if (markerIndex < 0) return [];
  const candidates = [];
  for (const text of texts.slice(markerIndex + 1, markerIndex + 8)) {
    if (/redeem code/i.test(text)) break;
    if (/^[A-Za-z0-9]{6,32}$/.test(text)) candidates.push(text);
    if (candidates.length >= 5) break;
  }
  const page = {
    title: 'Genshin Impact official main page redemption codes',
    canonical: source.canonicalUrl || source.url,
    published: null,
  };
  return candidates.flatMap((code) => extractRedemptionCodes(source, { ...page, text: `Redeem code: ${code}` }, retrievedAt, now));
}

function xmlText(fragment) {
  return decodeHtmlEntities(String(fragment || '')
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/<[^>]+>/g, '')
    .trim());
}

function xmlElementText(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? xmlText(match[1]) : '';
}

/**
 * Turns the bounded public YouTube RSS feed of a configured, verified channel
 * into the same page shape used by the normal event and redemption parsers.
 * The feed is discovery only; redemption extraction still accepts explicit
 * public codes from the official video description, never from media.
 */
export function extractYouTubeOfficialPages(source, xml) {
  // YouTube's feed-level yt:channelId currently omits the leading "UC" on
  // some feeds, while the canonical channel link retains the immutable ID.
  const feedHeader = String(xml).split(/<entry\b/i, 1)[0];
  const channelId = feedHeader.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/i)?.[1] || '';
  if (!channelId || channelId !== source.youtube?.channelId) throw new Error('YouTube RSS channel ID mismatch');
  const limit = Math.min(Math.max(Number(source.dailyMaxVideos || 15), 1), 15);
  const pages = [];
  for (const entry of String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    if (pages.length >= limit) break;
    const body = entry[1];
    const videoId = xmlElementText(body, 'yt:videoId');
    const title = xmlElementText(body, 'title');
    const published = xmlElementText(body, 'published');
    const description = xmlElementText(body, 'media:description');
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title || Number.isNaN(Date.parse(published))) continue;
    pages.push({
      title,
      canonical: `https://www.youtube.com/watch?v=${videoId}`,
      description,
      published,
      text: `${title}\n${description}`.trim(),
    });
  }
  return pages;
}

export function extractRedemptionCodes(source, page, retrievedAt, now = Date.now()) {
  if (source.redemptionCodes?.enabled !== true) return [];
  const candidates = [];
  const text = decodeHtmlEntities(page.text || '');
  const labeled = /(?:공용[ \t]+쿠폰[ \t]+코드|(?:공용[ \t]+)?(?:리딤|교환|프로모션)[ \t]*코드|redeem(?:ption)?[ \t]+code)(?:는|은)?[ \t]*[:：]?[ \t]*[\[【(]?([A-Za-z0-9]{6,32})[\]】)]?/gi;
  for (const match of text.matchAll(labeled)) {
    const context = text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
    if (/초대|추천|개별|1회용|구매\s*시|계정당\s*발급/i.test(context)) continue;
    candidates.push({ code: match[1], redemptionUrl: null });
  }

  const bracketedProse = /(?:공용\s+쿠폰\s+코드|(?:공용\s+)?(?:리딤|교환|프로모션)\s*코드)(?:는|은)?[\s\S]{0,180}?\[([A-Za-z0-9]{6,32})\]/gi;
  for (const match of text.matchAll(bracketedProse)) {
    const context = text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
    if (/초대|추천|개별|1회용|구매\s*시|계정당\s*발급/i.test(context)) continue;
    candidates.push({ code: match[1], redemptionUrl: null });
  }

  for (const match of text.matchAll(/https:\/\/[^\s"'<>]+/gi)) {
    try {
      const url = new URL(match[0]);
      const code = url.searchParams.get('code');
      if (!code || !/^[A-Za-z0-9]{6,32}$/.test(code)) continue;
      if (!source.redemptionCodes?.redemptionHosts?.includes(url.hostname)) continue;
      candidates.push({ code, redemptionUrl: url.toString() });
    } catch {}
  }

  const publishedDate = page.published && !Number.isNaN(Date.parse(page.published)) ? new Date(page.published) : null;
  const contentHash = createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
  const timing = extractRedemptionExpiry(text, publishedDate);
  const region = text.match(/(?:대상\s*)?(?:지역|서버)\s*[:：]\s*(글로벌|한국|아시아|유럽|북미|일본)/i)?.[1] || null;
  const rewards = (text.match(/(?:코드\s*)?보상\s*[:：]\s*([^\n]{1,160})/i)?.[1] || '')
    .split(/[,，·]/).map((value) => value.trim()).filter(Boolean).slice(0, 10);
  const publishedAt = publishedDate?.toISOString() || null;
  const unique = new Map();
  for (const candidate of candidates) {
    const normalizedCode = candidate.code.toUpperCase();
    if (['REDEMPTIONCODE', 'REDEEMCODE'].includes(normalizedCode)) continue;
    const digest = createHash('sha256').update(`${source.gameId}:${normalizedCode}`).digest('hex').slice(0, 14);
    const redemptionUrl = candidate.redemptionUrl || source.redemptionCodes?.redemptionUrlTemplate?.replace('{code}', encodeURIComponent(candidate.code)) || null;
    const record = {
      id: `${source.gameId}-code-${digest}`, gameId: source.gameId, code: candidate.code, region,
      distributionType: 'public', sourceTitle: page.title, sourceUrl: page.canonical, sourceLocale: source.locale,
      publishedAt, startsAt: null, expiresAt: timing.expiresAt, sourceTimeText: timing.sourceTimeText,
      redemptionUrl, rewards, status: getRedemptionCodeStatus(timing, now), retrievedAt,
      contentHash, lastVerifiedAt: retrievedAt, changeHistory: [],
    };
    unique.set(normalizedCode, record);
  }
  return [...unique.values()];
}

export function deduplicate(events) {
  const byUrl = new Map();
  for (const event of events) byUrl.set(event.sourceUrl, event);
  return [...byUrl.values()].sort((a, b) => (a.startsAt || a.publishedAt || '9999').localeCompare(b.startsAt || b.publishedAt || '9999'));
}

export function getEventStatus(event, now = Date.now()) {
  const start = Date.parse(event.startsAt);
  if (Number.isNaN(start)) {
    const end = Date.parse(event.endsAt);
    return !Number.isNaN(end) && end < now ? 'ended' : 'unknown';
  }
  if (start > now) return 'upcoming';
  if (!event.endsAt) return 'ended';
  const end = Date.parse(event.endsAt);
  return Number.isNaN(end) ? 'unknown' : end < now ? 'ended' : 'active';
}

export function mergeEventHistory(existingEvents, collectedEvents, now = Date.now()) {
  const byUrl = new Map(existingEvents.map((event) => [event.sourceUrl, event]));
  for (const collected of collectedEvents) {
    const existing = byUrl.get(collected.sourceUrl);
    const preservesConfirmedTiming = existing?.confidence === 'confirmed' && existing.startsAt && collected.confidence === 'probable';
    byUrl.set(collected.sourceUrl, preservesConfirmedTiming
      ? {
        ...collected,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        sourceTimeText: existing.sourceTimeText,
        confidence: 'confirmed',
      }
      : collected);
  }
  return deduplicate([...byUrl.values()]).filter(isCollectableEvent).map((event) => ({
    ...event,
    title: decodeHtmlEntities(event.title),
    sourceTitle: decodeHtmlEntities(event.sourceTitle),
    summary: decodeHtmlEntities(event.summary),
    status: getEventStatus(event, now),
  }));
}

export function mergeRedemptionCodeHistory(existingCodes, collectedCodes, now = Date.now()) {
  const byCode = new Map();
  for (const code of existingCodes) byCode.set(`${code.gameId}:${code.code.toUpperCase()}`, code);
  for (const code of collectedCodes) {
    const key = `${code.gameId}:${code.code.toUpperCase()}`;
    const previous = byCode.get(key);
    const changed = previous?.contentHash && code.contentHash && previous.contentHash !== code.contentHash;
    const changeHistory = changed
      ? [...(previous.changeHistory || []), { detectedAt: code.lastVerifiedAt || code.retrievedAt, previousHash: previous.contentHash, currentHash: code.contentHash }]
      : (previous?.changeHistory || code.changeHistory || []);
    byCode.set(key, {
      ...previous, ...code,
      region: code.region || previous?.region || null,
      expiresAt: code.expiresAt || previous?.expiresAt || null,
      rewards: [...new Set([...(previous?.rewards || []), ...(code.rewards || [])])],
      changeHistory,
    });
  }
  return [...byCode.values()].map((code) => ({ ...code, status: getRedemptionCodeStatus(code, now) }))
    .sort((a, b) => (b.publishedAt || b.retrievedAt).localeCompare(a.publishedAt || a.retrievedAt));
}
