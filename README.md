# subculture-schedule-api

게임타임 Electron 앱에 몬길: STAR DIVE, 명조, 원신의 공식 일정 데이터를 제공하는 독립형 수집/API 프로젝트입니다.

이 저장소 하나가 다음 작업을 모두 담당합니다.

1. GitHub Actions에서 매일 00:10 KST 공식 사이트 수집
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
| `GET` | `/api/v1/collection-status` | 마지막 수집 상태 조회 |
| `GET` | `/api/v1/redemption-code-candidates` | OCR 리딤코드 검수 후보 조회 |
| `POST` | `/api/internal/redemption-code-candidates/import` | 인증된 후보 데이터 import |
| `PATCH` | `/api/internal/redemption-code-candidates/:id` | 후보 승인 또는 거절 |
| `GET` | `/api/v1/redemption-codes?gameId=genshin&status=active` | 공식 본문에서 확인한 공용 리딤코드 조회 |
| `POST` | `/api/internal/events/import` | 수동/외부 데이터 저장(Bearer 인증) |
| `POST` | `/api/internal/redemption-codes/import` | 리딤코드 저장(Bearer 인증) |

## 로컬에서 바로 수집하고 서빙하기

```bash
npm install
npm run collect
npm run dev
```

도메인 제한 없는 비공식 리딤코드 후보 검색은 SearXNG 호환 인스턴스를 사용한다. GitHub Actions는 매 수집 실행마다 localhost 전용 SearXNG 컨테이너를 임시로 시작하므로 별도 검색 서버나 `SEARCH_ENGINE_URL` repository secret이 필요 없다. 로컬에서 검색 수집을 시험할 때만 `SEARCH_ENGINE_URL`에 직접 실행한 SearXNG 주소를 지정한다. 검색 결과는 자동 확정하지 않고 `redemption-code-candidates.json`의 `pending` 후보로만 저장한다.

개발 서버는 기본적으로 `127.0.0.1:5000`에서 실행됩니다. 포트가 사용 중이면 `PORT=5100 npm run dev`처럼 변경할 수 있습니다.

수집기는 `data/schedule-api/events.json`과 `collection-status.json`을 생성하고 로컬 API는 같은 파일을 즉시 읽습니다.

```bash
curl http://localhost:5000/api/v1/events
curl http://localhost:5000/api/v1/collection-status
curl http://localhost:5000/api/v1/redemption-codes
```

몬길 공식 포럼은 브라우저 렌더링이 필요하므로 로컬에서는 Electron Chromium을 사용하고, GitHub Actions에서는 `xvfb-run`으로 실행합니다. 원신과 명조는 공식 JSON API를 직접 조회합니다.

## Vercel 및 자동 수집 설정

1. 이 저장소를 Vercel 프로젝트로 연결합니다.
2. Vercel Storage에서 **private Blob store**를 생성하고 프로젝트에 연결합니다. Vercel Function은 OIDC로 Blob에 접근합니다.
3. `openssl rand -hex 32`로 수집 업로드용 비밀 값을 생성합니다.
4. 생성한 값을 Vercel 환경 변수와 GitHub Actions Secret 양쪽에 `INGEST_TOKEN`으로 등록합니다.
5. GitHub Actions Secret `SCHEDULE_API_URL`에 배포 주소를 등록합니다. 예: `https://subculture-schdule-api.vercel.app`
6. 환경 변수를 적용해 Vercel을 재배포합니다.
7. Actions의 `Collect and publish official schedules`를 한 번 수동 실행해 최초 데이터를 적재합니다.

이후 `.github/workflows/collect-schedules.yml`이 매일 다음 명령을 실행합니다.

```bash
npm run api:pull
xvfb-run -a npm run collect
npm run api:publish
```

예약 작업은 API에서 기존 이력을 내려받고 새 수집 결과를 병합한 다음, 인증된 import API로 전송합니다. GitHub Actions는 Blob 토큰을 가지지 않으며 Vercel Function만 Blob을 읽고 씁니다. 데이터 갱신 시 Vercel 재배포는 필요하지 않습니다.

## 수동 import

수집기 외에 검수된 JSON을 직접 넣어야 할 때만 사용합니다.

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
npm run typecheck
npm run test:collector
npm run test:e2e
npm run build
npm audit
```
