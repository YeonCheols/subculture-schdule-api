import { createHash } from 'node:crypto';

export const USER_AGENT = 'GameTimeCalendar/0.1 (+official schedule collector)';

export function decodeHtml(value = '') {
  return value.replace(/<[^>]+>/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}

export function collectText(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectText(item, output);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectText(item, output);
  return output.join('\n');
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
  return deduplicate([...existingEvents, ...collectedEvents]).filter((event) => event.startsAt).map((event) => ({ ...event, status: getEventStatus(event, now) }));
}
