# AGENTS.md

이 문서는 이 저장소에서 작업하는 AI 코딩 에이전트를 위한 프로젝트 정책이다. 별도의 사용자 지시가 없다면 아래 원칙을 따른다.

## 프로젝트 목적

이 저장소는 서브컬처 게임 공식 일정 데이터를 수집·정규화·보관하고 Electron 클라이언트에 제공하는 독립형 API 프로젝트다.

현재 지원 게임은 다음과 같다.

- `monster`: 몬길: STAR DIVE
- `wuthering`: 명조: 워더링 웨이브
- `genshin`: 원신

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
- `src/storage/storage.service.ts`: 로컬 파일/Vercel Blob 저장 추상화
- `scripts/collector/index.mjs`: 매일 실행하는 최신 일정 수집기
- `scripts/collector/backfill.mjs`: 명시한 날짜 범위의 과거 일정 수집기
- `scripts/collector/lib.mjs`: HTML·시간 추출, 정규화, 상태 계산, 병합
- `scripts/api-sync.mjs`: 배포 API의 데이터 pull/push
- `config/sources.json`: 공식 소스 정의
- `data/schedule-api/`: 로컬 및 seed 데이터
- `.github/workflows/`: CI 및 예약 수집

## 데이터 흐름

일반 운영 흐름은 다음과 같다.

1. GitHub Actions가 배포 API에서 기존 이벤트 이력을 내려받는다.
2. 공식 사이트 세 곳에서 최신 게시물을 수집한다.
3. 게시물 내용을 `ScheduleEvent`로 정규화하고 기존 이력과 병합한다.
4. 인증된 import API를 통해 Vercel Blob에 저장한다.
5. Electron 클라이언트는 공개 API를 주기적으로 조회한다.

일정 데이터 갱신을 위해 Vercel을 다시 배포할 필요는 없다.

## 공식 데이터 정책

- 일정 데이터는 각 게임의 공식 웹사이트, 공식 포럼 또는 공식 라운지에서만 수집한다.
- 팬사이트, 커뮤니티 추측, 유출, 검색 결과 요약을 일정 데이터로 저장하지 않는다.
- 명조 데이터는 공식 작성자 `GM 연구소` 게시물만 허용한다.
- 모든 `sourceUrl`은 원문 공식 페이지를 가리키는 HTTPS URL이어야 한다.
- 출처에서 날짜나 시간을 확인할 수 없는 게시물은 일정으로 저장하지 않는다.
- 시간대가 없는 임의의 ISO 문자열을 생성하지 않는다. 한국 공식 소스의 명시된 시간은 `+09:00`으로 저장한다.
- 출처 내용과 충돌하는 날짜를 추론하거나 보정하지 않는다. 불확실한 추론이 필요하면 코드 변경보다 먼저 사용자에게 알린다.
- 이미지에만 일정이 적혀 있고 본문에서 시간을 확인할 수 없다면 OCR을 임의 적용해 확정 일정으로 저장하지 않는다.

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

### 일일 수집기

`scripts/collector/index.mjs`는 최신 데이터의 가벼운 증분 수집에 사용한다.

- 매일 실행 가능한 요청량과 실행 시간을 유지한다.
- 과거 전체 페이지 순회 기능을 일일 수집기에 넣지 않는다.
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

## 저장소 및 API 정책

- 로컬에서는 기본적으로 `data/` 아래 JSON 파일을 읽고 쓴다.
- Vercel 환경에서는 private Vercel Blob을 사용한다.
- 공개 API는 읽기 전용이다.
- import API는 `INGEST_TOKEN` Bearer 인증을 유지한다.
- 비밀 값, Blob 자격 증명 또는 실제 토큰을 코드·문서·fixture에 넣지 않는다.
- 공개 조회 응답의 캐시 정책을 변경할 때 데이터 갱신 주기와 stale 허용 시간을 함께 고려한다.
- 사용자별 데이터나 인증 정보를 현재 JSON 이벤트 파일에 섞지 않는다. 그런 기능에는 별도 데이터 모델과 저장소가 필요하다.

## 변경 작업 원칙

- 요청 범위를 벗어난 리팩터링은 피한다.
- 기존 이벤트 이력이나 사용자의 작업물을 임의로 삭제하지 않는다.
- 데이터 파일을 갱신할 때는 임시 파일 작성 후 rename하는 원자적 방식을 유지한다.
- 수집 대상 사이트의 응답 구조가 바뀌었다면 실제 공개 응답을 확인한 뒤 파서를 수정한다.
- 새로운 게임을 추가할 때는 `GAME_IDS`, 소스 설정, 수집기, validator 테스트, API 필터 테스트를 함께 갱신한다.
- 새로운 이벤트 유형을 추가할 때는 enum, 분류 로직, validator 및 테스트를 함께 갱신한다.
- API가 직접 장시간 타이머를 실행한다고 가정하지 않는다. Vercel Function은 상시 프로세스가 아니다.

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
npm run collect
npm run collect:dry
npm run collect:backfill -- --from=2026-04-08 --to=2026-08-08
npm run collect:backfill -- --from=2026-04-08 --to=2026-08-08 --write
npm run api:pull
npm run api:publish
```

`api:publish`는 외부 배포 데이터를 변경한다. 사용자가 배포 또는 게시를 명시적으로 요청했고 필요한 환경 변수가 준비된 경우에만 실행한다.
