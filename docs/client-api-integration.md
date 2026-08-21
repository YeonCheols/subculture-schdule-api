# Electron 클라이언트 API 연동 가이드

이 문서는 게임타임 Electron 클라이언트에서 운영 일정 API를 읽기 위한 공개 계약을 정리한다. 클라이언트에는 `INGEST_TOKEN`, `ADMIN_TOKEN` 또는 Blob 자격 증명을 포함하지 않는다.

## 기본 주소와 게임 카탈로그

```text
https://subculture-schdule-api.vercel.app
```

새 클라이언트는 게임 ID를 고정하지 말고 앱 시작 시 다음 카탈로그를 조회한다.

```http
GET /api/v1/games
```

```ts
interface GameCatalogItem {
  id: string;
  name: string;
  shortName: string;
  enabled: boolean;
  sortOrder: number;
  icon: { url: string; version: string } | null;
}

interface GamesResponse {
  items: GameCatalogItem[];
  updatedAt: string;
}
```

`id`는 `/api/v2/events`의 `gameId`와 같으며, `enabled: true`인 항목을 `sortOrder` 오름차순으로 순회한다. 비활성 게임은 기존 캐시와 구독 식별을 위해 카탈로그에 남는다. 공식 아이콘이 아직 제공되지 않은 게임은 `icon: null`이며 클라이언트의 번들 아이콘 또는 placeholder로 표시한다.

카탈로그 요청이 실패하면 마지막 성공 카탈로그를 사용하고, 캐시가 없을 때만 번들 기본 목록으로 fallback한다. 성공한 카탈로그만 원자적으로 캐시한다.

서버가 새 게임을 추가하면 카탈로그 `items`에 항목이 추가되고 해당 `id`가 v2·v1 일정 및 게임 ID 필터 API에서 허용된다. 각 API의 기존 응답 모양은 바뀌지 않는다. 따라서 클라이언트는 `id`를 고정 union으로 선언하지 않고 카탈로그에서 받은 문자열을 사용해야 한다.

모든 공개 조회 API는 인증이 필요 없다. 알 수 없는 `gameId`, `status`, 잘못된 날짜 또는 cursor는 `400`을 반환한다.

## 권장 연동: v2 일정 API

새 클라이언트는 게임별 cursor API를 사용한다.

```http
GET /api/v2/events?gameId=nte
GET /api/v2/events?gameId=nte&cursor={nextCursor}
```

페이지당 최대 100건이며 응답은 다음 형태다.

```ts
interface EventsPageResponse {
  items: ScheduleEvent[];
  nextCursor: string | null;
  total: number;
}
```

`nextCursor`는 opaque 값이다. 디코딩하거나 offset으로 해석하지 않고 서버가 반환한 문자열을 그대로 다음 요청에 전달한다. cursor에는 조회를 시작한 데이터 generation이 들어 있으므로 순회 중 새 데이터가 게시되어도 같은 generation을 끝까지 읽는다. 다른 게임에서 받은 cursor를 재사용하면 안 된다.

```ts
const API_BASE_URL = 'https://subculture-schdule-api.vercel.app';

async function fetchGameEvents(gameId: GameId, signal?: AbortSignal): Promise<ScheduleEvent[]> {
  const items: ScheduleEvent[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL('/api/v2/events', API_BASE_URL);
    url.searchParams.set('gameId', gameId);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Schedule API returned HTTP ${response.status}`);

    const page = await response.json() as EventsPageResponse;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}
```

여러 게임을 표시할 때는 각 `gameId`를 독립적으로 순회한 뒤 결과를 합친다. 한 게임의 실패 때문에 다른 게임의 마지막 성공 캐시를 삭제하지 않는다.

## 구버전 호환: v1 일정 API

v1은 전체 또는 필터된 이벤트 배열을 한 번에 반환한다. 기존 Electron 클라이언트 호환용이며 이환도 동일하게 포함된다.

```http
GET /api/v1/events
GET /api/v1/events?gameId=nte
GET /api/v1/events?gameId=genshin&status=active&date=2026-08-21
```

지원 query:

| Query | 값 |
|---|---|
| `gameId` | `monster`, `wuthering`, `genshin`, `nte` |
| `status` | `upcoming`, `active`, `ended`, `unknown` |
| `date` | ISO 8601 날짜/시각. 일정과 겹치는 날짜를 조회 |

```ts
const response = await fetch(`${API_BASE_URL}/api/v1/events?gameId=nte`);
if (!response.ok) throw new Error(`Schedule API returned HTTP ${response.status}`);
const events = await response.json() as ScheduleEvent[];
```

v1의 응답이 계속 커질 수 있으므로 신규 구현과 마이그레이션은 v2를 우선한다.

## 일정 데이터 타입

```ts
type GameId = string; // GET /api/v1/games의 GameCatalogItem.id
type EventType = 'event' | 'update' | 'maintenance' | 'banner' | 'broadcast' | 'notice';
type EventStatus = 'upcoming' | 'active' | 'ended' | 'unknown';
type Confidence = 'confirmed' | 'probable' | 'unverified';

interface FeaturedBannerTarget {
  name: string;
  rarity: 4 | 5 | null;
  extractionMethod?: 'official-text' | 'official-image-ocr';
  confidence?: Confidence;
}

interface EventBanner {
  name: string;
  kind: 'character' | 'weapon' | 'mixed';
  phase: 'first' | 'second' | 'unknown';
  featuredCharacters: FeaturedBannerTarget[];
  featuredWeapons: FeaturedBannerTarget[];
  sourceImageUrls?: string[];
  ocrText?: string | null;
}

interface ScheduleEvent {
  id: string;
  gameId: GameId;
  type: EventType;
  title: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceLocale: string;
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sourceTimeText: string;
  status: EventStatus;
  confidence: Confidence;
  retrievedAt: string;
  version: string | null;
  summary: string;
  banners?: EventBanner[];
}
```

시간 필드는 시간대가 포함된 ISO 8601 문자열 또는 `null`이다. 공식 수집 후보에 원문 일정 시각이 없으면 서버는 수집일 00:00 KST부터 30일 뒤 23:59:59 KST까지의 추정 구간을 `confidence: probable`로 반환한다. 이 경우 `sourceTimeText`는 `원문에 일정 시각 없음; 수집 기준 추정 기간 (...)`으로 시작한다. 화면 표시는 ISO 문자열의 offset을 존중하고, 이 문구를 원문 일정이 아닌 추정값임을 알리는 근거로 활용한다.

`id`와 `sourceUrl`은 논리 이벤트의 안정적인 식별자다. 캐시 병합은 `id`를 우선하며, 새 응답에 없는 과거 항목을 즉시 삭제할지는 클라이언트 보존 정책으로 결정한다.

## 수집 상태

```http
GET /api/v1/collection-status
```

```ts
interface CollectionStatus {
  retrievedAt: string;
  eventCount: number;
  collectedEventCount: number;
  sources: Array<{
    id: string;
    ok: boolean;
    candidateCount?: number;
    collectedEventCount?: number;
    storedEventCount?: number;
    error?: string;
  }>;
}
```

`retrievedAt`은 원문 게시 시각이 아니라 마지막 수집 시각이다. `sources[].ok === false`이면 해당 소스의 새 데이터가 누락됐을 수 있으므로 마지막 성공 캐시를 유지한다. `eventCount`는 현재 공개 v1 전체 이벤트 수와 일치해야 한다.

## 캐릭터와 리딤 코드

```http
GET /api/v1/characters?gameId=nte
GET /api/v1/redemption-codes
GET /api/v1/redemption-codes?gameId=genshin&status=active
GET /api/v1/redemption-codes/expiring-today?gameId=genshin
GET /api/v1/redemption-codes/expiring?withinHours=24&gameId=genshin
```

캐릭터 API는 배열을 반환하며 `gameId`는 선택 사항이다. 리딤 코드 상태는 `active`, `expired`, `unknown`이다. `expiresAt: null` 또는 `status: unknown`인 코드를 임의 만료 처리하지 않는다.

## 캐시와 오류 처리

공개 카탈로그·이벤트·캐릭터·리딤 코드 응답은 `Cache-Control: public, max-age=300, stale-while-revalidate=3600`, 수집 상태는 `max-age=60, stale-while-revalidate=300`을 사용한다.

클라이언트 권장 동작:

1. 앱 시작 시 서버를 조회하고 이후 약 15분 간격으로 갱신한다.
2. 요청 timeout과 `AbortSignal`을 둔다.
3. 성공한 응답만 원자적으로 로컬 캐시에 교체한다.
4. 네트워크 오류, `5xx`, JSON 파싱 실패에는 마지막 성공 캐시를 표시한다.
5. `400`은 잘못된 클라이언트 query/cursor이므로 같은 요청을 무한 재시도하지 않는다.
6. v2 순회 도중 실패하면 불완전한 새 배열로 기존 캐시를 덮어쓰지 않는다.
7. `sourceUrl`을 열 때는 외부 HTTPS 링크로 처리한다.

## 운영 URL 빠른 확인

```text
Health:            https://subculture-schdule-api.vercel.app/health
게임 카탈로그:     https://subculture-schdule-api.vercel.app/api/v1/games
v1 전체 일정:      https://subculture-schdule-api.vercel.app/api/v1/events
v1 이환 일정:      https://subculture-schdule-api.vercel.app/api/v1/events?gameId=nte
v2 이환 일정:      https://subculture-schdule-api.vercel.app/api/v2/events?gameId=nte
수집 상태:         https://subculture-schdule-api.vercel.app/api/v1/collection-status
이환 캐릭터:       https://subculture-schdule-api.vercel.app/api/v1/characters?gameId=nte
```
