# subculture-schedule-api

게임타임 Electron 앱에 몬길: STAR DIVE, 명조, 원신, 이환의 공식 일정 데이터를 제공하는 독립형 수집/API 프로젝트입니다.

이 저장소 하나가 다음 작업을 모두 담당합니다.

1. GitHub Actions에서 매시간 17분 공식 사이트 수집
2. 수집 결과 정규화·검증·기존 이력 병합
3. Vercel Blob에 최신 JSON 저장
4. NestJS/Vercel Function에서 Electron에 API 제공

Electron 저장소는 수집 코드를 실행하지 않고 이 API를 조회하기만 하면 됩니다.

## API

| Method | Route | 설명 |
|---|---|---|
| `GET` | `/health` | 배포 상태 확인 |
| `GET` | `/api/v1/events` | 전체 일정 조회 |
| `GET` | `/api/v1/events?gameId=genshin&status=active&date=2026-08-08` | 게임·상태·날짜 필터 |
| `GET` | `/api/v2/events?gameId=genshin&cursor=...` | 게임별 cursor 페이지 조회(페이지당 100개) |
| `GET` | `/api/v1/collection-status` | 마지막 수집 상태 조회 |
| `GET` | `/api/v1/characters?gameId=nte` | 공식 캐릭터 프로필 조회 |
| `GET` | `/api/v1/redemption-code-candidates` | OCR 리딤코드 검수 후보 조회 |
| `POST` | `/api/internal/redemption-code-candidates/import` | 인증된 후보 데이터 import |
| `PATCH` | `/api/internal/redemption-code-candidates/:id` | 후보 승인 또는 거절 |
| `GET` | `/api/v1/redemption-codes?gameId=genshin&status=active` | 공식 본문에서 확인한 공용 리딤코드 조회 |
| `GET` | `/api/v1/redemption-codes/expiring-today?gameId=genshin` | 한국 시간 기준 오늘 만료되는 리딤코드 조회 |
| `GET` | `/api/v1/redemption-codes/expiring?withinHours=24&gameId=genshin` | 지정 시간 이내 만료 예정인 리딤코드 조회 |
| `POST` | `/api/internal/events/import` | 수동/외부 데이터 저장(Bearer 인증) |
| `POST` | `/api/internal/event-imports/:runId/batches` | workflow 이벤트 임시 배치 저장(Bearer 인증) |
| `POST` | `/api/internal/event-imports/:runId/finalize` | 전체 배치 검증 및 운영 데이터 확정(Bearer 인증) |
| `GET` | `/api/internal/admin/event-imports` | 관리자용 import 실행 목록(`ADMIN_TOKEN` 인증) |
| `GET` | `/api/internal/admin/event-imports/:runId` | 관리자용 import 실행 메타데이터(`ADMIN_TOKEN` 인증) |
| `GET` | `/api/internal/admin/event-imports/:runId/batches/:part` | 남아 있는 미완료 배치 조회(`ADMIN_TOKEN` 인증) |
| `POST` | `/api/internal/redemption-codes/import` | 리딤코드 저장(Bearer 인증) |
| `POST` | `/api/internal/characters/import` | 캐릭터 프로필 저장(Bearer 인증) |

v2 이벤트 조회는 `gameId`가 필수이며 페이지당 최대 100개를 반환합니다.

```bash
curl 'http://localhost:5000/api/v2/events?gameId=genshin'
curl 'http://localhost:5000/api/v2/events?gameId=genshin&cursor=PREVIOUS_NEXT_CURSOR'
```

```json
{
  "items": [],
  "nextCursor": null,
  "total": 0
}
```

cursor에는 조회를 시작한 page generation이 포함됩니다. 조회 도중 새 수집 결과가 게시돼도 다음 페이지는 동일한 generation에서 이어집니다.

## 로컬에서 바로 수집하고 서빙하기

```bash
npm install
npm run collect
npm run dev
```

도메인 제한 없는 비공식 리딤코드 후보 검색은 SearXNG 호환 인스턴스를 사용한다. GitHub Actions는 매 수집 실행마다 localhost 전용 SearXNG 컨테이너를 임시로 시작하므로 별도 검색 서버나 `SEARCH_ENGINE_URL` repository secret이 필요 없다. 로컬에서 검색 수집을 시험할 때만 `SEARCH_ENGINE_URL`에 직접 실행한 SearXNG 주소를 지정한다. 검색 결과는 자동 확정하지 않고 `redemption-code-candidates.json`의 `pending` 후보로만 저장한다.

개발 서버는 기본적으로 `127.0.0.1:5000`에서 실행됩니다. 포트가 사용 중이면 `PORT=5100 npm run dev`처럼 변경할 수 있습니다.

수집기는 `data/schedule-api/events.json`과 `collection-status.json`을 생성하고 로컬 API는 같은 파일을 즉시 읽습니다.
v2 페이지와 manifest는 인증된 단일 import 또는 배치 finalize가 성공할 때 생성되므로, collector만 실행한 새 로컬 데이터 디렉터리에서는 최초 import 전까지 v2가 404를 반환할 수 있습니다.

```bash
curl http://localhost:5000/api/v1/events
curl 'http://localhost:5000/api/v2/events?gameId=genshin'
curl http://localhost:5000/api/v1/collection-status
curl http://localhost:5000/api/v1/redemption-codes
```

몬길 공식 포럼은 브라우저 렌더링이 필요하므로 로컬에서는 Electron Chromium을 사용하고, GitHub Actions에서는 `xvfb-run`으로 실행합니다. 원신과 명조는 공식 JSON API를 직접 조회합니다.

## Vercel 및 자동 수집 설정

1. 이 저장소를 Vercel 프로젝트로 연결합니다.
2. Vercel Storage에서 **private Blob store**를 생성하고 프로젝트에 연결합니다. Vercel Function은 OIDC로 Blob에 접근합니다.
3. `openssl rand -hex 32`로 수집 업로드용 비밀 값을 생성합니다.
4. 생성한 값을 Vercel 환경 변수와 GitHub Actions Secret 양쪽에 `INGEST_TOKEN`으로 등록합니다.
5. 관리자 조회용으로 별도의 충분히 긴 `ADMIN_TOKEN`을 생성해 Vercel 환경 변수에만 등록합니다. 관리자 클라이언트에 토큰을 직접 포함하지 말고 관리자 서버 또는 보호된 프록시에서 사용합니다.
6. GitHub Actions Secret `SCHEDULE_API_URL`에 배포 주소를 등록합니다. 예: `https://subculture-schdule-api.vercel.app`
7. 환경 변수를 적용해 Vercel을 재배포합니다.
8. Actions의 `Collect and publish official schedules`를 한 번 수동 실행해 최초 데이터를 적재합니다.

이후 `.github/workflows/collect-schedules.yml`이 매시간 다음 명령을 실행합니다.

```bash
npm run api:pull
xvfb-run -a npm run collect
npm run api:publish
```

예약 작업은 API에서 기존 이력을 내려받고 새 수집 결과를 병합한 다음, 1MB 이하의 이벤트 배치를 run ID별 임시 Blob에 전송합니다. 모든 배치의 수량과 checksum 검증이 성공한 경우에만 운영 JSON과 게임별 페이지 manifest를 갱신합니다. GitHub Actions는 Blob 토큰을 가지지 않으며 Vercel Function만 Blob을 읽고 씁니다. 데이터 갱신 시 Vercel 재배포는 필요하지 않습니다.

### Blob 저장 구조

```text
schedule-api/
├── events.json                         # v1 호환 전체 이벤트
├── collection-status.json
├── imports/
│   └── {runId}/
│       ├── completed.json              # finalize 멱등성 기록
│       └── events/part-NNNN.json       # finalize 성공 후 삭제되는 임시 배치
└── event-pages/
    ├── manifest.json                   # 새 v2 조회가 사용할 현재 generation
    └── {version}/
        ├── manifest.json               # cursor 스냅샷용 generation metadata
        └── {gameId}/page-NNNN.json     # 게임별 최대 100개 이벤트
```

`api:publish`는 `EVENT_IMPORT_BATCH_BYTES`를 지정하지 않으면 UTF-8 JSON 기준 1,000,000 bytes를 목표로 분할합니다. 서버는 이벤트 배열이 1,250,000 bytes를 넘는 배치를 거부합니다. 이는 NestJS의 2MB JSON body 제한과 [Vercel Function의 4.5MB request/response 상한](https://vercel.com/docs/functions/limitations#request-body-size)보다 충분한 여유를 두기 위한 값입니다.

finalize는 모든 part의 존재와 순서, 개별·전체 SHA-256 checksum, 예상 이벤트 수, 이벤트 스키마, ID와 `sourceUrl` 유일성을 확인합니다. 검증에 실패하면 기존 운영 JSON은 유지됩니다. 성공한 part는 삭제하고 `completed.json`을 남겨 응답 유실 후 같은 `runId`의 finalize 재시도를 처리합니다.

각 실행은 `manifest.json`에 run ID, 상태, 전체 part 수, 업로드된 part의 수량·크기·checksum을 기록합니다. 관리자는 `GET /api/internal/admin/event-imports`에서 run ID를 포함한 최근 실행 목록을 확인할 수 있습니다. 성공 실행은 완료 메타데이터만 조회되고 배치 본문은 삭제됩니다. 미완료 실행은 남아 있는 part의 메타데이터와 내용을 관리자 API로 확인할 수 있습니다. 관리자 응답은 `private, no-store`이며 공개 API로 제공하지 않습니다.

별도 관리자 프런트엔드 없이 배포 도메인의 `/admin/imports`에서 실행 목록과 상태를 확인할 수 있습니다. 최초 접근 시 `ADMIN_TOKEN`을 입력하면 서버가 1시간짜리 `HttpOnly`, `SameSite=Strict` 세션 쿠키를 발급하며 토큰을 브라우저 저장소나 URL에 보관하지 않습니다. 이 화면과 관리자 API는 운영 진단 전용이며 Electron 클라이언트와 공개 `/api/v1`, `/api/v2` 응답에는 배치 정보를 포함하지 않습니다.

## 수동 import

수집기 외에 2MB 미만의 검수된 JSON을 직접 넣어야 할 때만 기존 단일 import를 사용합니다. 자동 수집 게시에는 `npm run api:publish`의 배치/finalize 경로를 사용합니다.

```bash
curl -X POST https://YOUR_PROJECT.vercel.app/api/internal/events/import \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @data/schedule-api/events.json
```

이벤트 import는 잘못된 enum, 중복 ID, timezone 없는 시각, HTTP 출처 URL을 거부합니다.

리딤코드는 일정과 분리된 `redemption-codes.json`에 저장합니다. 공식 원문 본문에 코드 문자열이
명시된 공용 코드만 자동 수집하며 초대·추천 코드, 구매 또는 개별 지급 쿠폰, 이미지나 방송에만
표시된 코드는 확정 데이터로 저장하지 않습니다. 만료 시각이 원문에 없으면 상태는 `unknown`입니다.

## Electron 연동

Electron 메인 프로세스에서 아래 주소를 앱 시작 시점과 15분 간격으로 조회하면 됩니다.

```text
https://YOUR_PROJECT.vercel.app/api/v1/events
https://YOUR_PROJECT.vercel.app/api/v1/collection-status
```

네트워크 오류 시 마지막 성공 캐시, 설치 파일 JSON 순서로 fallback하는 구성을 권장합니다.

`/api/v1/events`는 기존 Electron 호환성을 위해 배열 응답을 유지합니다. 전체 응답이 커지기 전에 Electron을 게임별 `/api/v2/events` cursor 순회로 전환해야 합니다. v2에서는 각 게임의 `nextCursor`가 `null`이 될 때까지 조회하고 게임별 결과를 합칩니다.

## 과거 일정 백필

일일 수집기와 별도로 공식 게시물의 과거 페이지를 순회할 수 있습니다. 기본 실행은 결과 요약만 출력하며,
`--write`를 지정해야 기존 `events.json`과 병합해 저장합니다.

```bash
npm run collect:backfill -- --from=2026-04-08 --to=2026-08-08
npm run collect:backfill -- --from=2026-04-08 --to=2026-08-08 --write
```

`BACKFILL_MAX_PAGES`(기본 50), `BACKFILL_PAGE_SIZE`(기본 30), `COLLECT_TIMEOUT_MS`로 실행 범위를 조정할 수 있습니다.

## 검증

```bash
npm test
npm run typecheck
npm run test:collector
npm run test:e2e
npm run build
npm audit
```

배치 import 또는 페이지 저장을 변경한 뒤 운영 workflow를 명시적으로 실행했다면 Actions 로그의 `Uploaded event batch`, `Published schedules`, `temporaryBatchesDeleted`를 확인합니다. 이어서 v1 전체 이벤트 수와 모든 게임의 v2 `total` 합계, ID·`sourceUrl` 유일성, `collection-status.eventCount`가 일치하는지 비교합니다. 운영 workflow와 `api:publish`는 데이터를 변경하므로 사용자가 배포 또는 게시를 명시적으로 요청한 경우에만 실행합니다.
