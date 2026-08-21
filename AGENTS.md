# AGENTS.md

이 문서는 이 저장소에서 작업하는 AI 코딩 에이전트를 위한 프로젝트 정책이다. 별도의 사용자 지시가 없다면 아래 원칙을 따른다.

## 프로젝트 목적

이 저장소는 서브컬처 게임 공식 일정 데이터를 수집·정규화·보관하고 Electron 클라이언트에 제공하는 독립형 API 프로젝트다.

현재 지원 게임은 다음과 같다.

- `monster`: 몬길: STAR DIVE
- `wuthering`: 명조: 워더링 웨이브
- `genshin`: 원신
- `nte`: 이환

Electron 애플리케이션 코드는 이 저장소에 없다. 이 저장소의 책임은 일정 수집과 API 제공까지이며, 데스크톱 UI·로컬 알림·클라이언트 캐시는 Electron 저장소의 책임이다.

## 기술 구성

- Node.js 22 이상
- TypeScript 및 NestJS 11
- 로컬 JSON 또는 Vercel Blob 저장소
- Vercel Function 기반 API
- GitHub Actions 기반 일일 수집
- Electron Chromium 기반 Netmarble 동적 페이지 렌더링

주요 경로:

- `src/domain/event.ts`: 일정 및 수집 상태 도메인 모델
- `src/events/`: 공개 조회 API와 인증된 import API
- `src/characters/`: 공식 캐릭터 프로필 조회와 import API
- `src/redemption-codes/`: 공식 리딤코드 및 OCR 검수 후보 API
- `src/events/event-imports.service.ts`: 임시 이벤트 배치 저장, 전체 검증 및 finalize
- `src/events/events-v2.controller.ts`: 게임별 cursor 페이지 조회 API
- `src/storage/storage.service.ts`: 로컬 파일/Vercel Blob 저장 추상화
- `scripts/collector/index.mjs`: 매시간 실행하는 최신 일정 수집기
- `scripts/collector/backfill.mjs`: 명시한 날짜 범위의 과거 일정 수집기
- `scripts/collector/lib.mjs`: HTML·시간 추출, 정규화, 상태 계산, 병합
- `scripts/api-sync.mjs`: 배포 API의 데이터 pull/push
- `scripts/api-sync-lib.mjs`: UTF-8 JSON 바이트 기준 배치 분할과 checksum
- `config/sources.json`: 공식 소스 정의
- `data/schedule-api/`: 로컬 및 seed 데이터
- `.github/workflows/`: CI 및 예약 수집

## 데이터 흐름

일반 운영 흐름은 다음과 같다.

1. GitHub Actions가 배포 API에서 기존 이벤트 이력을 내려받는다.
2. 등록된 공식 사이트와 공식 API에서 최신 게시물을 수집한다.
3. 게시물 내용을 `ScheduleEvent`로 정규화하고 기존 이력과 병합한다.
4. `scripts/api-sync.mjs`가 이벤트를 UTF-8 JSON 기준 1MB 이하 배치로 나눈다.
5. 각 배치를 `runId`별 임시 Blob에 저장하고, finalize에서 전체 수량·checksum·ID·URL 중복을 검증한다.
6. 검증이 모두 성공한 경우에만 운영 `events.json`, 수집 상태, 게임별 페이지 generation과 현재 manifest를 갱신한다.
7. Electron 클라이언트는 기존 v1 전체 조회 또는 v2 게임별 cursor API를 주기적으로 조회한다.

일정 데이터 갱신을 위해 Vercel을 다시 배포할 필요는 없다.

## 배치 import 및 페이지 저장 정책

- GitHub Actions는 `github.run_id`와 `github.run_attempt` 조합을 `IMPORT_RUN_ID`로 사용한다. 로컬 실행은 UUID를 사용한다.
- `scripts/api-sync.mjs`의 기본 이벤트 배치 목표는 1,000,000 bytes이며 개수가 아니라 `JSON.stringify` 결과의 UTF-8 바이트로 분할한다.
- 서버는 배치 이벤트 배열이 1,250,000 bytes를 넘으면 거부한다. NestJS JSON body 제한은 2MB, Vercel Function request/response 상한은 4.5MB이므로 이 여유를 유지한다.
- 배치는 `schedule-api/imports/{runId}/events/part-NNNN.json`에 임시 저장하며 공개 API가 이 경로를 읽어서는 안 된다.
- finalize는 모든 part의 존재, part/totalParts 일치, 개별 및 전체 SHA-256 checksum, 예상 이벤트 수, 전체 `validateEvents`, ID와 `sourceUrl` 유일성을 확인한다.
- finalize 검증이 실패하면 운영 파일 쓰기를 시작하지 않으며 기존 운영 데이터를 삭제하거나 빈 배열로 교체하지 않는다.
- finalize 성공 결과는 `schedule-api/imports/{runId}/completed.json`에 남겨 동일 실행 재시도를 멱등하게 처리하고, 성공한 임시 part 파일은 삭제한다.
- 운영 호환 파일은 `schedule-api/events.json`이며 `/api/v1/events`가 사용한다.
- v2 페이지는 `schedule-api/event-pages/{version}/{gameId}/page-NNNN.json`에 게임별 최대 100개씩 저장한다.
- 각 generation의 `manifest.json`은 cursor가 시작한 버전을 끝까지 읽게 하며, `schedule-api/event-pages/manifest.json`은 새 조회가 사용할 현재 generation을 가리킨다.
- 현재 cursor가 참조할 수 있는 과거 generation을 임의로 삭제하지 않는다. 정리 정책을 추가할 때 cursor 유효 기간과 API 캐시 시간을 함께 정의한다.
- `/api/v2/events`는 `gameId`가 필수이며 `{ items, nextCursor, total }`을 반환한다. 기존 `/api/v1/events` 배열 계약은 Electron 전환 전까지 유지한다.
- Vercel의 4.5MB 응답 상한에 접근하면 v1 전체 조회를 계속 확장하지 말고 Electron을 v2로 전환한다.

## 공식 데이터 정책

- 일정 데이터는 각 게임의 공식 웹사이트, 공식 포럼 또는 공식 라운지에서만 수집한다.
- 팬사이트, 커뮤니티 추측, 유출, 검색 결과 요약을 일정 데이터로 저장하지 않는다.
- 명조 데이터는 공식 작성자 `GM 연구소` 게시물만 허용한다.
- 모든 `sourceUrl`은 원문 공식 페이지를 가리키는 HTTPS URL이어야 한다.
- 출처에서 날짜나 시간을 확인할 수 없는 일반 게시물은 일정으로 저장하지 않는다. 다만 공식 출처에서 픽업명, 캐릭터명, 무기명 또는 배너 이미지를 확인한 픽업 정보는 별도 후보군에 보관하지 않고 `type: banner`, `startsAt: null`, `endsAt: null`, `status: unknown`인 `ScheduleEvent`로 즉시 저장한다.
- 시간대가 없는 임의의 ISO 문자열을 생성하지 않는다. 한국 공식 소스의 명시된 시간은 `+09:00`으로 저장한다.
- 출처 내용과 충돌하는 날짜를 추론하거나 보정하지 않는다. 불확실한 추론이 필요하면 코드 변경보다 먼저 사용자에게 알린다.
- 이미지 OCR은 공식 게시물에 직접 포함된 HTTPS 이미지를 대상으로 캐릭터·무기 픽업명을 보조 추출할 때만 허용한다.
- OCR 결과는 `unverified`로 저장하고 원본 이미지 URL, OCR 원문과 추출 방식을 함께 보존한다. OCR로 읽은 시간은 확정 일정으로 사용하지 않는다.
- 본문 텍스트에서 픽업 대상을 확인할 수 있으면 OCR보다 본문을 우선하며, OCR 실패가 해당 소스의 텍스트 일정 수집을 실패시키면 안 된다.

### 후보 없는 공식 정보 반영 정책

- 공식 출처와 공식 작성자 검증을 통과하고 스키마에 필요한 출처 정보가 확보된 게임 정보는 별도의 영구 후보 데이터셋을 만들지 않고 해당 공개 도메인 모델에 바로 저장한다.
- 공식 픽업 정보는 일정 시각이 없어도 `ScheduleEvent`의 `banners`에 저장하고 공개 `/api/v1/events` 응답에 포함한다.
- `candidateDiagnostics`는 발견·제외·파싱 오류를 설명하는 실행 진단일 뿐 공개 정보의 대기 저장소로 사용하지 않는다. 진단에 구조화 가능한 공식 정보가 있으면 같은 실행에서 이벤트로 함께 저장한다.
- 검색 결과, 비공식 작성자, 출처가 불명확한 OCR 문자열처럼 공식 사실로 검증되지 않은 값은 이벤트나 별도 후보군에 저장하지 않는다. 오류 또는 검토 필요 사유만 수집 상태에 기록한다.
- 날짜와 시간을 알 수 없는 공식 정보에 임의 시각을 부여하지 않는다. null과 `unknown` 상태로 불확실성을 표현한다.

## ScheduleEvent 규칙

이벤트 스키마의 기준은 `src/domain/event.ts`이며 import 검증 기준은 `src/events/event-validator.ts`다.

- `id`는 공식 원문 URL을 기반으로 안정적으로 생성한다.
- 같은 `sourceUrl`은 같은 논리 이벤트로 취급한다.
- `gameId`, `type`, `status`, `confidence`에는 정의된 enum만 사용한다.
- `startsAt`, `endsAt`, `publishedAt`, `retrievedAt`은 null 또는 시간대가 포함된 유효한 ISO 8601 값이어야 한다.
- 종료 시간이 시작 시간보다 빠르면 안 된다.
- `sourceTimeText`에는 원문에서 추출한 시간 표현을 보존한다.
- `retrievedAt`은 원문의 게시 시각이 아니라 해당 데이터를 실제로 수집한 시각이다.
- 동일 URL을 다시 수집하면 기존 항목을 갱신하되, 이번 실행에서 찾지 못한 과거 이력은 삭제하지 않는다.
- 이벤트 상태는 현재 시각과 시작·종료 시각으로 다시 계산한다.

## 수집기 변경 정책

### 정기 수집기

`scripts/collector/index.mjs`는 최신 데이터의 가벼운 증분 수집에 사용한다.

- 매시간 실행 가능한 요청량과 실행 시간을 유지한다.
- 과거 전체 페이지 순회 기능을 정기 수집기에 넣지 않는다.
- 한 소스의 실패가 다른 소스의 성공 결과를 가리지 않도록 한다.
- 기존 이벤트 이력을 병합 과정에서 유지한다.

### 과거 백필 수집기

`scripts/collector/backfill.mjs`는 사용자가 명시한 기간을 일회성으로 보충할 때만 사용한다.

- `--from=YYYY-MM-DD`와 `--to=YYYY-MM-DD`를 반드시 받는다.
- 기본 실행은 미리보기이며 파일을 변경하지 않는다.
- `--write`가 있을 때만 `events.json`과 `collection-status.json`을 원자적으로 갱신한다.
- 게시일이 범위에 포함된 공식 게시물을 조사한 뒤, 실제 일정이 요청 범위와 겹치는 이벤트만 병합한다.
- `BACKFILL_MAX_PAGES`, `BACKFILL_PAGE_SIZE`, `COLLECT_TIMEOUT_MS`, `BACKFILL_RENDER_WAIT_MS`로 실행량을 제한할 수 있다.
- 실제 저장 전에는 가능하면 동일 조건의 미리보기를 먼저 실행하고 소스별 후보 및 수집 건수를 검토한다.
- 백필 결과도 기존 이력을 삭제하지 않는다.

## 소스별 주의사항

### 몬길: STAR DIVE

- Netmarble 포럼은 JavaScript 렌더링이 필요하다.
- 목록과 상세 페이지는 `render-browser.cjs`의 Electron Chromium으로 읽는다.
- CI에서는 sandbox 관련 Chromium 옵션과 `xvfb-run`이 필요하다.
- 렌더링 대기시간을 지나치게 줄이면 비어 있는 HTML을 정상 응답으로 오인할 수 있다.

### 명조

- 네이버 게임 라운지의 공지, 인게임 공지·정보, 이벤트 게시판을 사용한다.
- 일반 사용자 게시물이 섞이지 않도록 공식 작성자 닉네임을 반드시 검사한다.
- 네이버의 `createdDate` 형식은 `YYYYMMDDHHmmss`이며 한국 시간으로 변환한다.

### 원신

- HoYoverse 공식 콘텐츠 API를 사용한다.
- 과거 수집에서는 `iPage`와 `iPageSize`를 이용해 페이지를 순회한다.
- 응답의 `retcode`, `data.list`, `iTotal` 구조를 검증한다.

### 이환

- 네이버 게임 라운지의 등록된 공식 게시판을 사용한다.
- 공식 작성자 닉네임 `이 환`과 `game_manager` 역할을 함께 검사한다.
- 캐릭터 프로필은 별도 캐릭터 게시판과 `캐릭터 파일 소개丨` 제목 패턴을 사용하며 일정 이벤트와 분리해 저장한다.

## 저장소 및 API 정책

- 로컬에서는 기본적으로 `data/` 아래 JSON 파일을 읽고 쓴다.
- Vercel 환경에서는 private Vercel Blob을 사용한다.
- 공개 API는 읽기 전용이다.
- import API는 `INGEST_TOKEN` Bearer 인증을 유지한다.
- import 실행 목록·메타데이터·미완료 배치 조회 API는 별도의 `ADMIN_TOKEN` Bearer 인증을 유지하며 공개 API로 노출하지 않는다.
- 관리자 화면은 `GET /api/internal/admin/event-imports`에서 run ID를 탐색하고, 성공 실행은 완료 메타데이터와 최종 결과 페이지를, 미완료 실행은 남은 임시 part를 조회한다. 관리자 토큰을 브라우저 번들에 포함하지 않는다.
- 성공 실행의 관리자 상세는 해당 run ID의 `event-pages/{runId}/manifest.json`과 게임별 `page-NNNN.json`을 인증된 API로 조회할 수 있으며 Blob URL이나 자격 증명을 직접 노출하지 않는다.
- 로컬 관리자 화면의 운영 기록 조회는 `ADMIN_READ_PROXY_URL`에 지정한 HTTPS 운영 도메인의 관리자 GET API만 서버 측에서 프록시한다. 로컬에 운영 Blob OIDC 권한을 부여하거나 import POST를 프록시하지 않는다.
- GitHub Actions에 Vercel Blob 장기 자격 증명을 제공하지 않는다. Blob 읽기·쓰기·임시 파일 삭제는 인증된 Vercel Function을 통해 수행한다.
- 기존 `/api/internal/events/import`는 2MB 미만의 수동 import와 하위 호환용이다. 자동 수집 게시에는 배치/finalize API를 사용한다.
- `/api/v1/events`는 기존 배열 응답 계약이며 `/api/v2/events`는 게임별 cursor 계약이다. 응답 모양을 같은 버전에서 바꾸지 않는다.
- v2 cursor를 임의 offset으로 해석하거나 현재 manifest로 다시 매핑하지 않는다. cursor에 포함된 generation의 manifest와 페이지를 읽어 pagination 도중 데이터가 섞이지 않게 한다.
- 운영 이벤트, 현재 페이지 manifest, 수집 상태는 generation 페이지 준비가 끝난 뒤 순서대로 갱신하며 `collection-status.json`은 마지막에 쓴다.
- 비밀 값, Blob 자격 증명 또는 실제 토큰을 코드·문서·fixture에 넣지 않는다.
- 공개 조회 응답의 캐시 정책을 변경할 때 데이터 갱신 주기와 stale 허용 시간을 함께 고려한다.
- 사용자별 데이터나 인증 정보를 현재 JSON 이벤트 파일에 섞지 않는다. 그런 기능에는 별도 데이터 모델과 저장소가 필요하다.

## 변경 작업 원칙

- 요청 범위를 벗어난 리팩터링은 피한다.
- 프로젝트 정책이나 AI 작업 원칙이 변경되면 같은 작업에서 `AGENTS.md`를 반드시 갱신한다.
- 정책 변경이 사용자·운영자에게 영향을 주는 API 계약, 환경 변수, 인증, 저장소, 수집·배포 workflow 또는 실행 절차를 포함하면 `README.md`도 같은 작업에서 함께 갱신한다.
- `AGENTS.md`와 `README.md`가 같은 내용을 다루는 경우 두 문서가 서로 모순되지 않도록 변경 사항을 동기화한다.
- 기존 이벤트 이력이나 사용자의 작업물을 임의로 삭제하지 않는다.
- 데이터 파일을 갱신할 때는 임시 파일 작성 후 rename하는 원자적 방식을 유지한다.
- 배치 import를 변경할 때 임시 part를 운영 조회에 직접 노출하거나 part별로 운영 `events.json`에 병합하지 않는다.
- 배치 크기, checksum 직렬화 방식 또는 페이지 크기를 변경할 때 클라이언트와 서버 상수를 함께 갱신하고 경계값 테스트를 추가한다.
- finalize 완료 기록과 성공한 part 정리를 유지하며, 네트워크 응답 유실 후 같은 `runId`로 재시도 가능한지 확인한다.
- 수집 대상 사이트의 응답 구조가 바뀌었다면 실제 공개 응답을 확인한 뒤 파서를 수정한다.
- 새로운 게임을 추가할 때는 `GAME_IDS`, 소스 설정, 수집기, validator 테스트, API 필터 테스트를 함께 갱신한다.
- 새로운 이벤트 유형을 추가할 때는 enum, 분류 로직, validator 및 테스트를 함께 갱신한다.
- API가 직접 장시간 타이머를 실행한다고 가정하지 않는다. Vercel Function은 상시 프로세스가 아니다.

## AI 수집 품질 자율 점검 정책

AI 코딩 에이전트는 수집기, 공식 소스 설정, 파서, 일정 데이터 또는 수집 장애와 관련된 작업을 수행할 때 사용자의 별도 지시를 기다리지 않고 해당 범위의 수집 품질을 점검한다. 점검의 목적은 지원 게임의 공식 정보가 누락·왜곡·중복 없이 `ScheduleEvent`로 수집되는지 확인하는 것이다.

### 자율 점검 절차

1. 변경 전 기존 이벤트 수, 소스별 수집 상태, 최근 성공 시각과 오류를 확인해 비교 기준을 남긴다.
2. `config/sources.json`에 등록된 공식 원문 또는 공식 API의 실제 공개 응답을 확인하고, 목록·상세 응답 구조와 작성자·게시 시각·일정 표현이 현재 파서의 가정과 일치하는지 대조한다.
3. 가능하면 먼저 `npm run collect:dry` 또는 쓰기 없는 백필 미리보기를 실행해 소스별 후보 수, 수집 수, 제외 사유와 오류를 검토한다.
4. 수집 결과에 `validateEvents`를 적용하고 URL·ID 중복, 시간대, 시작·종료 순서, 상태, `eventCount`, 기존 이력 보존 여부를 확인한다.
5. 문제가 재현되고 공식 원문으로 기대 결과를 입증할 수 있으면 요청 범위 안에서 파서·설정·테스트를 수정하고 같은 조건으로 다시 수집해 회귀 여부를 확인한다.
6. 변경 전후의 소스별 결과와 검증 명령을 비교해 개선 여부를 보고한다. 단순히 명령이 성공했다는 사실만으로 정상 수집을 판단하지 않는다.

### 자율 판단의 제한

- 공식 원문에서 확인할 수 없는 날짜·시간·작성자·이벤트 유형을 추측해 채우지 않는다.
- 공식 사이트 차단, 로그인·인증 요구, CAPTCHA, 응답 구조 불명확, 이미지에만 존재하는 일정처럼 자동 검증이 불가능한 경우에는 데이터를 확정하거나 우회하지 않고 근거와 함께 사용자에게 알린다.
- 일시적인 네트워크 실패와 파서 결함을 구분하기 위해 제한된 범위에서 재시도하거나 원시 응답 구조를 확인하되, 무제한 요청이나 전체 과거 페이지 순회를 수행하지 않는다.
- 데이터 파일을 변경해야 하면 동일 조건의 미리보기와 무결성 검증을 먼저 수행한다. 기존 이력을 삭제하거나 대량 변경 가능성이 있으면 사용자에게 영향 범위를 알리고 명시적 승인을 받은 뒤 저장한다.
- 자율 점검은 로컬 코드와 데이터 검증까지 허용한다. `api:publish`, 배포, 원격 저장소 변경, 운영 데이터 import처럼 외부 상태를 바꾸는 작업은 사용자가 명시적으로 요청한 경우에만 수행한다.
- 일부 소스가 실패해도 성공한 다른 소스의 결과를 폐기하지 않으며, 실패 소스와 원인을 `collection-status.json` 및 작업 보고에 명확히 남긴다.

## 검증

코드 또는 데이터 변경 후 관련 범위에 맞게 아래 명령을 실행한다.

```bash
npm run typecheck
npm run test:collector
npm run test:e2e
npm run build
```

전체 검증은 다음 명령으로 실행할 수 있다.

```bash
npm run test
```

수집기 변경 시 추가로 확인한다.

- 수집 결과의 모든 이벤트가 `validateEvents`를 통과하는가
- 이벤트 ID와 `sourceUrl`이 중복되지 않는가
- 시작·종료 시각에 시간대가 포함되어 있는가
- 기존 이력이 유지되는가
- `collection-status.json`의 `eventCount`가 실제 이벤트 수와 일치하는가
- 소스 실패가 상태 결과에 명확히 기록되는가

배치 import 또는 페이지 API 변경 시 추가로 확인한다.

- UTF-8 JSON 기준 각 event batch가 클라이언트 목표와 서버 상한 이내인가
- 일부 part가 누락되거나 checksum이 다르면 finalize가 실패하고 기존 운영 이벤트가 유지되는가
- finalize 재시도가 같은 결과를 반환하며 다른 metadata를 가진 같은 `runId`를 거부하는가
- finalize 후 성공한 임시 part가 삭제되고 완료 기록이 남는가
- v1 전체 이벤트 수와 v2 게임별 `total` 합계가 일치하는가
- v2의 모든 페이지를 순회했을 때 ID와 `sourceUrl`이 유일하고 누락이 없는가
- pagination 중 현재 manifest가 바뀌어도 기존 cursor가 같은 generation을 계속 읽는가
- 운영 `collection-status.json.eventCount`, page manifest의 `eventCount`, 실제 이벤트 수가 일치하는가

네트워크를 사용하는 수집 테스트는 외부 사이트 상태에 영향을 받을 수 있다. 실패 시 파서 오류와 일시적인 네트워크·사이트 오류를 구분해서 보고한다.

## AI 자율 커밋 정책

AI 코딩 에이전트는 사용자가 요청한 변경을 완료하고 아래 조건을 충족하면 별도의 커밋 요청을 기다리지 않고 작업 단위별로 로컬 커밋을 생성할 수 있다.

### 커밋 전 조건

- 현재 브랜치와 `git status`를 확인하고, 이번 작업에서 AI가 생성하거나 수정한 파일만 커밋 대상으로 선택한다.
- 사용자가 만든 기존 변경, 다른 에이전트의 변경, 요청 범위 밖의 untracked 파일은 stage하거나 수정하지 않는다.
- 변경 범위에 맞는 검증을 실행하고 성공 결과를 확인한다. 문서나 에이전트 정책만 변경했다면 테스트 대신 diff, 링크, 명령, 형식 오류를 점검할 수 있다.
- 실패한 검증이 있으면 원인을 해결하기 전에는 커밋하지 않는다. 외부 사이트나 네트워크 문제처럼 변경과 무관한 실패로 판단되면 커밋을 보류하고 근거와 함께 사용자에게 알린다.
- 비밀 값, 토큰, 자격 증명, 개인 데이터, 임시 출력물 및 로컬 전용 설정이 포함되지 않았는지 확인한다.
- `git diff --cached`로 실제 커밋 내용을 마지막으로 검토한다.

### 커밋 작성 규칙

- 하나의 커밋에는 하나의 논리적 변경만 포함한다. 독립적으로 검증하거나 되돌릴 필요가 있는 변경은 분리한다.
- Conventional Commits 형식의 영어 제목을 사용한다. 예: `feat(collector): add official source adapter`, `fix(events): preserve zoned timestamps`, `docs(agents): define autonomous commit policy`.
- 제목은 변경 결과를 명령형으로 간결하게 표현하고, 동기나 호환성 영향이 필요할 때만 본문을 추가한다.
- 테스트를 우회하기 위한 `--no-verify`를 사용하지 않는다.
- 사용자의 명시적 요청 없이 기존 커밋을 amend, rebase, squash, reset 또는 force push하지 않는다.

### 자율 처리 범위

- 로컬 커밋 생성은 허용한다.
- 원격 저장소로의 `push`, Pull Request 생성·병합, 릴리스, Vercel 배포, `api:publish` 실행은 자율 커밋 범위에 포함되지 않는다. 사용자가 해당 외부 변경을 명시적으로 요청한 경우에만 수행한다.
- 커밋 후 커밋 해시, 제목, 포함 파일, 실행한 검증과 결과를 사용자에게 보고한다.
- 작업 도중 사용자가 커밋하지 말라고 지시하면 그 지시를 우선하며 변경을 working tree에 남긴다.

## 자주 사용하는 명령

```bash
npm run dev
npm run dev:vercel
npm run collect
npm run collect:dry
npm run collect:backfill -- --from=2026-04-08 --to=2026-08-08
npm run collect:backfill -- --from=2026-04-08 --to=2026-08-08 --write
npm run api:pull
npm run api:publish
```

`api:publish`는 외부 배포 데이터를 변경한다. 사용자가 배포 또는 게시를 명시적으로 요청했고 필요한 환경 변수가 준비된 경우에만 실행한다.
