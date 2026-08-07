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
| `POST` | `/api/internal/events/import` | 수동/외부 데이터 저장(Bearer 인증) |

## 로컬에서 바로 수집하고 서빙하기

```bash
npm install
npm run collect
npm run dev
```

개발 서버는 기본적으로 `127.0.0.1:5000`에서 실행됩니다. 포트가 사용 중이면 `PORT=5100 npm run dev`처럼 변경할 수 있습니다.

수집기는 `data/schedule-api/events.json`과 `collection-status.json`을 생성하고 로컬 API는 같은 파일을 즉시 읽습니다.

```bash
curl http://localhost:5000/api/v1/events
curl http://localhost:5000/api/v1/collection-status
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

## Electron 연동

Electron 메인 프로세스에서 아래 주소를 앱 시작 시점과 15분 간격으로 조회하면 됩니다.

```text
https://YOUR_PROJECT.vercel.app/api/v1/events
https://YOUR_PROJECT.vercel.app/api/v1/collection-status
```

네트워크 오류 시 마지막 성공 캐시, 설치 파일 JSON 순서로 fallback하는 구성을 권장합니다.

## 검증

```bash
npm run typecheck
npm run test:collector
npm run test:e2e
npm run build
npm audit
```
