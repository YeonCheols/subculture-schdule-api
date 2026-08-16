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

export function extractNaverOfficialPages(feedGroups, source, limit = 30) {
  const byId = new Map();
  for (const item of feedGroups.flat()) {
    if (item.user?.nickname !== source.officialNickname || !item.feed?.feedId) continue;
    byId.set(String(item.feed.feedId), item);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.feed.createdDate || '').localeCompare(String(a.feed.createdDate || '')))
    .slice(0, limit)
    .map((item) => {
      let document = {};
      try { document = JSON.parse(item.feed.contents || '{}'); } catch {}
      const created = item.feed.createdDate;
      const publishedAt = /^\d{14}$/.test(created) ? `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}T${created.slice(8, 10)}:${created.slice(10, 12)}:${created.slice(12, 14)}+09:00` : null;
      return { title: decodeHtml(item.feed.title), canonical: `${source.canonicalBase}${item.feed.feedId}`, description: '', published: publishedAt, text: collectText(document) };
    });
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
    if (url && title && !seen.has(url)) { seen.add(url); results.push({ url, title }); }
  }
  return results;
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
  return { title, description, published, canonical: absoluteUrl(canonical, candidate.url) || candidate.url, text: decodeHtml(html) };
}

export function classify(title) {
  if (/점검|maintenance/i.test(title)) return 'maintenance';
  if (/방송|프리뷰|special program|livestream/i.test(title)) return 'broadcast';
  if (/기원|픽업|튜닝|convene|banner/i.test(title)) return 'banner';
  if (/업데이트|버전|update|patch/i.test(title)) return 'update';
  if (/이벤트|event/i.test(title)) return 'event';
  return 'notice';
}

export function extractTime(text, referenceYear = null) {
  const range = text.match(/(20\d{2})[.년\-/]\s*(\d{1,2})[.월\-/]\s*(\d{1,2})일?\s*(?:\([^)]+\))?\s*(\d{1,2})[:시]\s*(\d{2})?\s*(?:부터|~|～|—|–|-)[\s\S]{0,80}?(?:(20\d{2})[.년\-/]\s*)?(\d{1,2})[.월\-/]\s*(\d{1,2})일?\s*(?:\([^)]+\))?\s*(\d{1,2})[:시]\s*(\d{2})?/);
  const iso = (y, m, d, h, min) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min.padStart(2, '0')}:00+09:00`;
  if (range) {
    const [, sy, sm, sd, sh, smin = '00', ey = sy, em, ed, eh, emin = '00'] = range;
    return { startsAt: iso(sy, sm, sd, sh, smin), endsAt: iso(ey, em, ed, eh, emin), sourceTimeText: range[0] };
  }
  const shortRange = referenceYear && text.match(/(\d{1,2})월\s*(\d{1,2})일[^\d]{0,20}(\d{1,2}):(\d{2})\s*(?:부터|~|～|—|–|-)\s*(\d{1,2})월\s*(\d{1,2})일[^\d]{0,20}(\d{1,2}):(\d{2})/);
  if (shortRange) return { startsAt: iso(String(referenceYear), shortRange[1], shortRange[2], shortRange[3], shortRange[4]), endsAt: iso(String(referenceYear), shortRange[5], shortRange[6], shortRange[7], shortRange[8]), sourceTimeText: shortRange[0] };
  const single = text.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일[^\d]{0,20}(\d{1,2}):(\d{2})/);
  if (single) return { startsAt: iso(single[1], single[2], single[3], single[4], single[5]), endsAt: null, sourceTimeText: single[0] };
  return { startsAt: null, endsAt: null, sourceTimeText: '' };
}

export function normalize(source, page, retrievedAt, now = Date.now()) {
  const referenceYear = page.published && !Number.isNaN(Date.parse(page.published)) ? new Date(page.published).getFullYear() : null;
  const timing = extractTime(page.text, referenceYear);
  const digest = createHash('sha256').update(page.canonical).digest('hex').slice(0, 14);
  return {
    id: `${source.gameId}-${digest}`, gameId: source.gameId, type: classify(page.title),
    title: page.title.replace(/\s*-\s*몬길:\s*STAR DIVE$/i, ''), sourceTitle: page.title, sourceUrl: page.canonical,
    sourceLocale: source.locale, publishedAt: page.published && !Number.isNaN(Date.parse(page.published)) ? new Date(page.published).toISOString() : null,
    startsAt: timing.startsAt, endsAt: timing.endsAt, sourceTimeText: timing.sourceTimeText,
    status: getEventStatus(timing, now), confidence: timing.startsAt ? 'confirmed' : 'probable', retrievedAt,
    version: page.title.match(/(?:버전|Version|v)\s*([0-9]+(?:\.[0-9]+)+)/i)?.[1] || null, summary: page.description.slice(0, 240),
  };
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
  const timing = extractRedemptionExpiry(text, publishedDate);
  const publishedAt = publishedDate?.toISOString() || null;
  const unique = new Map();
  for (const candidate of candidates) {
    const normalizedCode = candidate.code.toUpperCase();
    if (['REDEMPTIONCODE', 'REDEEMCODE'].includes(normalizedCode)) continue;
    const digest = createHash('sha256').update(`${source.gameId}:${normalizedCode}`).digest('hex').slice(0, 14);
    const redemptionUrl = candidate.redemptionUrl || source.redemptionCodes?.redemptionUrlTemplate?.replace('{code}', encodeURIComponent(candidate.code)) || null;
    const record = {
      id: `${source.gameId}-code-${digest}`, gameId: source.gameId, code: candidate.code, region: null,
      distributionType: 'public', sourceTitle: page.title, sourceUrl: page.canonical, sourceLocale: source.locale,
      publishedAt, startsAt: null, expiresAt: timing.expiresAt, sourceTimeText: timing.sourceTimeText,
      redemptionUrl, rewards: [], status: getRedemptionCodeStatus(timing, now), retrievedAt,
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
  if (Number.isNaN(start)) return 'unknown';
  if (start > now) return 'upcoming';
  if (!event.endsAt) return 'ended';
  const end = Date.parse(event.endsAt);
  return Number.isNaN(end) ? 'unknown' : end < now ? 'ended' : 'active';
}

export function mergeEventHistory(existingEvents, collectedEvents, now = Date.now()) {
  return deduplicate([...existingEvents, ...collectedEvents]).filter((event) => event.startsAt).map((event) => ({
    ...event,
    title: decodeHtmlEntities(event.title),
    sourceTitle: decodeHtmlEntities(event.sourceTitle),
    summary: decodeHtmlEntities(event.summary),
    status: getEventStatus(event, now),
  }));
}

export function mergeRedemptionCodeHistory(existingCodes, collectedCodes, now = Date.now()) {
  const byCode = new Map();
  for (const code of [...existingCodes, ...collectedCodes]) byCode.set(`${code.gameId}:${code.code.toUpperCase()}`, code);
  return [...byCode.values()].map((code) => ({ ...code, status: getRedemptionCodeStatus(code, now) }))
    .sort((a, b) => (b.publishedAt || b.retrievedAt).localeCompare(a.publishedAt || a.retrievedAt));
}
