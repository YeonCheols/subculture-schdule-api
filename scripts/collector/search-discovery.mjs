import { createHash } from 'node:crypto';

export function candidatesFromSearchResults(definition, results, discoveredAt) {
  const output = new Map();
  const pattern = /(?:리딤|교환|프로모션|쿠폰|redeem(?:ption)?)[ \t]*(?:코드)?[ \t]*[:：-]?[ \t]*[\[【(]?([A-Za-z0-9]{6,32})[\]】)]?/gi;
  for (const result of results) {
    let sourceUrl;
    try { sourceUrl = new URL(result.url); } catch { continue; }
    if (sourceUrl.protocol !== 'https:') continue;
    const evidence = `${result.title || ''}\n${result.content || ''}`.slice(0, 4000);
    for (const match of evidence.matchAll(pattern)) {
      const code = match[1];
      if (!/[A-Z]/i.test(code) || !/\d/.test(code)) continue;
      const normalized = code.toUpperCase();
      const digest = createHash('sha256').update(`${definition.gameId}:${sourceUrl}:${normalized}`).digest('hex').slice(0, 14);
      output.set(`${sourceUrl}:${normalized}`, {
        id: `${definition.gameId}-search-code-${digest}`, gameId: definition.gameId, candidateCode: code,
        status: 'pending', sourceTitle: result.title || sourceUrl.hostname, sourceUrl: sourceUrl.toString(),
        sourceLocale: definition.locale, imageUrl: null, mediaType: 'web-search-result', ocrText: evidence, discoveredAt,
      });
    }
  }
  return [...output.values()];
}

export async function discoverUnofficialRedemptionCandidates(config, discoveredAt) {
  const base = process.env.SEARCH_ENGINE_URL?.replace(/\/$/, '');
  if (!config.enabled || !base) return { candidates: [], skipped: true, errors: [] };
  const candidates = []; const errors = [];
  for (const definition of config.queries || []) {
    try {
      const url = new URL(`${base}/search`);
      url.search = new URLSearchParams({ q: definition.query, format: 'json', language: definition.locale || 'all', safesearch: '1' });
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.results)) throw new Error('results must be an array');
      candidates.push(...candidatesFromSearchResults(definition, payload.results.slice(0, config.maxResultsPerQuery || 10), discoveredAt));
    } catch (error) { errors.push(`${definition.gameId}: ${error.message}`); }
  }
  return { candidates, skipped: false, errors };
}
