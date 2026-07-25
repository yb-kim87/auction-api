# 2026-07-24_01 강의자료 관리자 탭 (파일럿: 1번 슬라이드)

## 배경

웨비나 슬라이드(HTML)를 사용자가 직접 텍스트 편집할 방법이 필요하다는 요청.
슬라이드는 별도 세션에서 PDF를 픽셀 단위로 실측해 HTML(`디자인 시안/PPT-HTML-복원/webinar-slides.html`, 24페이지)로
복원해둔 상태였음. 이 HTML을 관리자가 코드를 몰라도 고칠 수 있도록, 경매코치 관리자 페이지에
"강의자료" 탭을 만들어 폼으로 텍스트를 수정하고 DB에 저장하는 기능을 추가하기로 함.

전체 24슬라이드를 한 번에 구현하면 범위가 커서, 먼저 1번 슬라이드(표지)만 파일럿으로 도입하고
동작 확인 후 확장하기로 결정.

## 실행한 프롬프트 (요약)

- "경매코치 관리자페이지에서 탭을 하나 만들어서 강의자료 탭 만들어서 해당 HTML을 직접 수정할 수 있으면 좋겠다"
- 편집 방식: 텍스트를 폼으로 클릭해서 수정 (HTML 직접 편집 아님)
- 저장 위치: auction-api DB에 새 테이블
- 범위: 먼저 1개 슬라이드만 도입, 검증 후 확장

## 변경 내용

### 백엔드 (auction-api)

- `src/lecture-materials/lecture-slide.entity.ts` — `lecture_slides` 테이블 엔티티.
  슬라이드 하나 = 레코드 하나. `deckId`(슬라이드 덱 묶음 키), `sortOrder`, `label`,
  `content`(jsonb, 슬라이드별 자유 형식 텍스트 필드 맵) 컬럼.
- `src/lecture-materials/lecture-materials.service.ts` — `findByDeck`, `updateContent`.
- `src/lecture-materials/lecture-materials.controller.ts` — `GET /lecture-materials/slides?deckId=`,
  `PATCH /lecture-materials/slides/:id`. `loan-policy` 컨트롤러와 동일하게 `getAuthContext` +
  `requireAdmin` 함수 호출 방식으로 관리자 권한 체크(별도 가드 데코레이터 미사용, 기존 패턴 따름).
- `src/lecture-materials/lecture-materials.module.ts` — 모듈 등록, `app.module.ts`에 추가.
- `src/migrations/1784236000000-AddLectureSlidesTable.ts` — 테이블 생성 + 인덱스(`deckId`) +
  1번 슬라이드(`webinar-2607_slide-01`) 시드 데이터 삽입(표지: 제목 2줄 + 부제목).
  **아직 실행 안 함** — 운영 DB 마이그레이션은 배포 시점에 별도로 `npm run migration:run` 필요.

### 프론트엔드 (auction)

- `src/lib/api.ts` — `LectureSlide` 타입, `fetchLectureSlides(deckId)`,
  `updateLectureSlide(id, content)`. 기존 `loan-policies` API 함수와 동일한 fetch 패턴
  (`API_BASE`, `FETCH_CREDENTIALS`, `withJsonHeaders`, `parseErrorMessage`).
- `src/app/admin/LectureMaterialsTab.tsx` — 신규 탭 컴포넌트.
  - `SLIDE_FIELD_DEFS`에 슬라이드 id별 편집 가능 필드(키/라벨) 정의. 현재는
    `webinar-2607_slide-01`(표지: `titleLine1`, `titleLine2`, `subtitle`)만 등록.
  - 슬라이드마다 폼(좌측) + 축소 미리보기(우측, `SlidePreview`)를 나란히 표시.
    미리보기는 원본 HTML의 좌표/폰트 비율을 480×270 캔버스에 맞춰 축소 적용한 인라인 스타일.
  - 원본(`slides`)과 편집본(`editing`)을 분리 보관해 dirty 여부 계산, 저장 버튼은
    dirty일 때만 활성화 — `LoanPolicyTab.tsx`의 원본/편집본 분리 패턴을 그대로 따름.
- `src/app/admin/page.tsx` — `AdminTab`에 `"lectureMaterials"` 추가, 탭 목록에
  "강의자료" 라벨로 등록, `LectureMaterialsTab` import 및 조건부 렌더링 추가.

## 검증

- 백엔드: `npx tsc --noEmit` 통과.
- 프론트엔드: `npx tsc --noEmit` 통과.
- 마이그레이션은 아직 실행하지 않음 — 실제 DB 반영 및 화면 동작 확인은 배포/실행 시점에 필요.

## 다음 확장 시 참고

- 새 슬라이드를 추가하려면: (1) 마이그레이션 또는 시드 스크립트로 `lecture_slides`에 레코드 추가,
  (2) `LectureMaterialsTab.tsx`의 `SLIDE_FIELD_DEFS`에 필드 정의 추가,
  (3) `SlidePreview`가 슬라이드 종류마다 레이아웃이 다르므로, 슬라이드 id 또는 별도
  `layout` 필드에 따라 다른 프리뷰 컴포넌트를 렌더링하도록 분기 필요(현재는 표지 레이아웃 하나만 하드코딩됨).
- 원본 슬라이드 좌표/폰트 실측값은 `디자인 시안/PPT-HTML-복원/webinar-slides.html`과
  `PPT-HTML-복원-규칙.md`(같은 폴더)에 정리되어 있음 — 새 슬라이드의 필드/좌표를 정의할 때 참고.

---

## 追記 2026-07-24: 드래그 레이아웃 편집 + Ctrl+Z + 24개 슬라이드 전체 확장

### 배경 / 요청 흐름

1. 파일럿(1번 슬라이드) 확인 후 "텍스트만 수정되고 레이아웃(위치·크기·색상)은 못 바꾸는 거냐"는 질문.
2. "레이아웃 이동도 이번 기회에 구현해줘" → 캔버스 안에서 텍스트를 드래그로 옮기고, 클릭하면
   패널에서 좌표/글자크기/색상/정렬/굵기/형광펜 배경을 편집하는 방식으로 확장하기로 결정.
3. 관리자 페이지(`/admin`, `max-w-[960px]`) 안에 캔버스+패널을 넣었더니 폭이 부족해 레이아웃이
   깨짐 → "관리자 페이지 말고 탭을 메인에다 만들고 넓게 쓰자"는 제안으로 `/admin/lecture-materials`
   독립 페이지로 분리.
4. "Ctrl+Z, Ctrl+C/V(복사 붙여넣기)도 가능하게 해줘" → Ctrl+Z(실행취소)부터 구현.
5. "남은 슬라이드도 가져와보자" → 2~24번 슬라이드 전체를 텍스트+레이아웃 편집 가능하도록 확장.
6. 확장 도중 여러 렌더링 버그가 발견되어 순차적으로 수정(아래 "발견된 버그와 원인" 참고).

### 변경 내용

#### 데이터 모델 확장 (백엔드)

- `LectureSlide` 엔티티에 `layout: Record<string, FieldLayout> | null` 컬럼 추가
  (`src/lecture-materials/lecture-slide.entity.ts`). `FieldLayout`은
  `{ top, left, fontSize, color?, fontWeight?, textAlign?, backgroundColor? }`.
- `LectureMaterialsService.updateContent` → `updateSlide(id, { content?, layout? })`로 확장,
  컨트롤러의 PATCH 바디도 `{ content?, layout? }` 형태로 변경.
- 마이그레이션 `1784237000000-AddLectureSlideLayout.ts`(layout 컬럼 추가),
  `1784238000000-SeedRemainingLectureSlides.ts`(2~24번 슬라이드 시드, 그룹 키 반영판).
  둘 다 운영 DB엔 아직 미실행 — 배포 시 `npm run migration:run` 필요.

#### 프론트엔드 — 드래그 편집 + Ctrl+Z

- `LectureMaterialsTab.tsx`를 캔버스 드래그 편집기로 전면 재작성.
  - `EditableSlideCanvas`: pointerDown/Move/Up으로 텍스트 필드를 드래그해 top/left를 바꾼다.
  - `FieldEditorPanel`: 선택된 필드의 텍스트/top/left/fontSize/color/backgroundColor(형광펜)/
    textAlign/fontWeight를 입력창으로 편집.
  - undo 스택(`historyRef`, 슬라이드 id별 `SlideSnapshot[]`)을 두고 Ctrl+Z(Cmd+Z)로 한 단계씩
    되돌린다. **버그**: 처음엔 드래그가 끝난 시점(`onDragCommit`)에 히스토리를 찍어서, 이미
    바뀐 상태를 저장해버려 undo해도 변화가 없었다 → 드래그 시작 직후(`onDragStart`, 첫 이동
    감지 시점)로 스냅샷 시점을 옮겨서 해결. input 포커스는 `onFocus`에서 스냅샷을 찍어
    "그 필드를 만지기 시작한 시점"의 상태를 저장한다.
  - "전체 되돌리기" 버튼(마지막 저장 상태로 일괄 복원)과 Ctrl+Z(단계별 취소)는 별개 기능으로
    유지, 버튼 라벨을 "전체 되돌리기"로 명확히 구분.

#### 프론트엔드 — 독립 페이지 분리

- `src/app/admin/lecture-materials/page.tsx` 신설. `fetchCurrentUser()`로 `role==="admin"`
  확인 후 아니면 `/`(비로그인은 `/login`)로 리다이렉트하는 클라이언트 가드.
  `max-w-[1400px]` 컨테이너로 전체 폭 사용.
- 기존 `/admin` 페이지의 `AdminTab`에서 `"lectureMaterials"` 제거하고, `AdminTabs` 탭 바
  옆에 `<Link href="/admin/lecture-materials">강의자료</Link>`만 남김(탭 상태 전환이 아니라
  페이지 이동).

#### 프론트엔드 — 24개 슬라이드 전체 필드/레이아웃 정의

- `SLIDE_FIELD_DEFS`(슬라이드별 편집 가능 필드+기본 좌표), `SLIDE_IMAGES`(고정 배경 이미지,
  좌표만 있고 텍스트 편집 대상 아님), `SLIDE_HEADER_HEIGHT`(파란 헤더 배너가 있는 슬라이드의
  배너 높이)를 24개 슬라이드 전부로 확장. 좌표/폰트크기는 `webinar-slides.html` 실측값 그대로
  옮김.
- 이미지 파일(`icon_logo_t.png`, `img_p12_apt.png` 등 16개)을
  `E:\OneDrive\auctiondev\디자인 시안\PPT-HTML-복원\`에서 `young/auction/public/lecture-materials/`로
  복사해 정적 서빙.
- **그룹 렌더링 도입**: "30대 <강조>50억 자산</강조> 달성"처럼 한 줄에 색/굵기가 다른 텍스트
  조각이 섞인 슬라이드(4,5,6,7,17,18,20,21,24)를 처음엔 조각마다 독립된 절대좌표(`left`)로
  배치했는데, 텍스트 길이가 조금만 달라져도 서로 겹치는 버그가 발생(사용자가 스크린샷으로
  지적: "이런거 왜이러는거야??"). 근본 해결로 필드 키에 `그룹::조각`(`GROUP_SEP = "::"`)
  구조를 도입해, 같은 그룹의 조각들을 하나의 flex row로 묶어 자동 순서 배치하도록 변경
  (`groupField()` 헬퍼, `EditableSlideCanvas`의 `rows` 구성 로직). 그룹의 top/left/textAlign은
  그룹 첫 번째 조각(리더) 값을 쓰고, 조각별로는 fontSize/color/backgroundColor/fontWeight만
  다르게 지정 가능. DB content 키도 `"line::prefix"` 등 그룹 키로 재시딩.

### 발견된 버그와 원인 (전부 수정 완료)

작업 도중 "이런거 왜이러는거야??", "완전히 더 이상해졌어" 등 사용자가 여러 차례 렌더링 이상을
지적했다. Playwright로 관리자 계정(admin/admin) 로그인 후 직접 스크린샷을 찍어 진단했다
(브라우저 콘솔을 직접 볼 수 없는 환경이라, 사용자에게 확인을 요청하는 대신 자동화 도구로
재현·검증). 발견된 버그와 원인:

1. **헤더 파란 배너가 안 그려짐**: `headerField()`는 텍스트 위치만 정의할 뿐, 원본 HTML의
   `<div class="header">`(파란 배경 사각형)를 실제로 그리는 코드가 캔버스에 없었다. 헤더가
   있어야 할 11개 슬라이드에서 흰 글씨 헤더 문구가 밝은 배경(`#F8F8F8`) 위에 그대로 얹혀 흐리게
   보였다. → `SLIDE_HEADER_HEIGHT` 맵 + 배너 렌더링 `<div>` 추가로 해결.
2. **텍스트가 고정 이미지와 겹침(23번 캐릭터, 원인 오판 1차)**: 처음엔 좌표 문제로 의심했으나
   실제 원인은 편집기 캔버스에 슬라이드 폰트(G마켓산스)가 전혀 적용되지 않고 브라우저 기본
   폰트로 렌더링되어 글자 폭이 원본보다 넓어진 것이었다.
3. **폰트가 아예 로드되지 않음(2차 원인, 진짜 원인)**: `@font-face` src로 쓰던
   `https://cdn.jsdelivr.net/gh/webfontworld/gmarket/GmarketSansMedium.woff2`가 **404**였다.
   `webfontworld/gmarket` GitHub 저장소 자체가 사라졌거나 이동한 것으로 보인다(다른 프로젝트의
   Pretendard도 같은 jsdelivr GitHub 프록시 방식을 썼는데, 그쪽은 원본 저장소가
   "Package size exceeded the configured limit of 50 MB"로 jsdelivr에서 통째로 차단된 상태였음
   — GitHub 저장소를 통한 jsdelivr CDN은 저장소 상태 변화에 취약하다는 교훈). 해결: Medium
   굵기는 npm 패키지 `@noonnu/gmarket-sans-medium`(눈누 배포)에서 `.woff` 파일을 받아
   `young/auction/public/fonts/GmarketSansMedium.woff`로 **자체 호스팅**. Bold 전용 배포처는
   신뢰할 만한 곳을 찾지 못해, `font-synthesis: weight`로 브라우저 합성 굵게를 사용하기로
   사용자와 합의(완전히 동일한 굵기는 아니지만 외부 CDN 의존을 없애는 쪽을 택함).
4. **`textAlign:"center"`가 무시됨(17번 등, 단독 필드)**: 그룹 렌더링 도입 후, 그룹이 아닌
   단독 필드(`isSingle`)는 `display:"block"`으로 렌더링하면서 실제 CSS `text-align` 속성을
   빼먹었다(`justifyContent`는 flex 전용이라 block 요소엔 효과 없음). 그 결과 가운데 정렬
   텍스트가 전부 왼쪽 정렬로 보였다. → `textAlign: isSingle ? textAlign : undefined` 추가로 해결.
5. **그룹 안 텍스트 조각 사이에 공백이 없음(17, 24번 등)**: flex `gap`을 고정 `6`(px, 캔버스
   축소 배율 미반영)으로 줬더니 원본 기준 16px 상당의 미미한 간격이 되어 육안으로 거의 안
   보였다. → `Math.round(leadStyle.fontSize * 0.3 * SCALE)`로 폰트 크기에 비례한 gap으로 변경.
6. **DB 데이터가 반복적으로 사라짐(개발 중 여러 차례 재발)**: 로컬 개발 DB가 sql.js(파일 기반,
   `autoSave`로 비동기 저장)인데, 백엔드 프로세스를 `Stop-Process -Force`(강제 종료)로 여러 번
   내리면서 그 저장이 끝나기 전에 프로세스가 죽어 `lecture_slides` 데이터가 여러 번 초기화됐다.
   → `main.ts`에 `app.enableShutdownHooks()` 추가(정상 종료 시그널에는 TypeORM 커넥션을 안전하게
   정리하도록). 다만 강제 종료 자체를 막을 수는 없어, 재발 시 시드 스크립트로 복구하는 방식을
   반복 사용함 — **앞으로 로컬 백엔드를 재시작할 때는 가능한 한 정상 종료를 쓰고, 강제 종료
   후에는 반드시 `lecture_slides` 데이터가 살아있는지 재확인할 것.**

### 검증 방법

- 브라우저 콘솔을 직접 볼 수 없는 자동화 환경이라, `playwright`(임시로 `%TEMP%/pw-check`에
  설치)로 실제 크롬을 띄워 `admin/admin` 계정으로 로그인 → `/admin/lecture-materials` 접속 →
  전체 페이지 스크린샷 + 개별 슬라이드 스크린샷 + `document.fonts` 상태 확인 + 콘솔/네트워크
  실패 로그 캡처로 버그를 재현하고 수정 결과를 검증했다. 이 방식으로 폰트 404, textAlign 누락,
  gap 부족을 전부 실측 확인함.
- 최종적으로 24개 슬라이드 전체를 스크린샷으로 원본(`webinar-slides.html`)과 대조해 일치 확인.

### 다음에 참고할 것

- 웹폰트를 새로 추가할 때 GitHub 저장소 기반 jsdelivr(`cdn.jsdelivr.net/gh/...`) 경로는 저장소
  삭제/이동/용량초과로 예고 없이 깨질 수 있다. 가능하면 npm 패키지 기반 jsdelivr
  (`cdn.jsdelivr.net/npm/...`)를 쓰거나, 이번처럼 폰트 파일을 프로젝트 `public/`에 직접
  내려받아 자체 호스팅하는 편이 안정적이다.
- 한 줄에 스타일이 다른 텍스트 조각이 섞이는 새 슬라이드를 추가할 때는 반드시 `groupField()`로
  묶고, 절대좌표 3분할 방식으로 되돌아가지 말 것(겹침 버그 재발 소지).
- sql.js 로컬 DB는 강제 종료에 취약하다. 백엔드 재시작이 필요하면 강제 종료보다 일반 종료를
  우선 시도하고, 재시작 후 `lecture_slides` 등 중요 데이터가 남아있는지 먼저 확인한다.

---

## 追記 2026-07-24 (2): 두 번째 덱(webinar-final) 추가 + 덱 선택 드롭박스

### 배경 / 요청

사용자가 215페이지짜리 새 PDF("최종본")를 주고 1~20페이지를 원본 규칙 문서(PPT-HTML-복원-규칙.md)
방식으로 복원해달라고 요청. 이 PDF는 기존 24페이지 덱과 겹치는 슬라이드가 일부(4~6번)뿐이고
대부분 새로운 내용(주황 헤더, "선물1~4" 상품 소개, "여러분들은 누구신가요" 워드클라우드 등)이라
별도 덱으로 취급하기로 함. 처음엔 스캐치패드에 순수 HTML(`webinar-final-slides.html`)로만
1~20페이지를 만들었는데, 사용자가 "왜 로컬에서 안 보이지, 다른 탭으로 만들어달라 했잖아"라고
지적 — 이 HTML은 관리자 페이지에 연결된 적이 없었다. "기존 강의자료 탭은 그대로 두고 새 탭
혹은 드롭박스로 전환 가능하게 해달라"는 요청으로 드롭박스 방식을 선택.

### 변경 내용

- `LectureMaterialsTab.tsx`:
  - `DECK_ID` 상수를 `DECKS` 배열(`{id, label}[]`)로 바꾸고, 컴포넌트 상태 `deckId`로 관리.
    상단에 `<select>` 드롭박스를 추가해 "강의자료 (24페이지)" ↔ "최종본 웨비나 (1~20페이지)"
    전환 가능. `useEffect` 의존성 배열에 `deckId` 추가, 덱 전환 시 `selectedField` 초기화.
  - `SLIDE_HEADER_HEIGHT: Record<string, number>` → `SLIDE_HEADER: Record<string, {height, color}>`로
    확장 — 기존 덱은 헤더가 항상 파란색(`#3157B7`)이었지만 새 덱은 슬라이드에 따라 주황(`#FC5230`)
    헤더도 있어서 색상까지 슬라이드별로 지정해야 했다.
  - `SLIDE_IMAGES`, `SLIDE_FIELD_DEFS`, `SLIDE_BACKGROUND`에 `webinar-final_slide-01`~`-20`
    항목을 기존 `webinar-2607_slide-*`와 나란히 추가(같은 맵에 다른 프리픽스로 공존시키는
    방식이라 렌더링 로직 자체는 변경 불필요).
  - 새로 쓰인 색상: `ORANGE = "#FC5230"`(주황 헤더/강조), `YELLOW_BG2 = "#F5E541"`(선물 슬라이드
    가격 하이라이트, 기존 `YELLOW_BG`와 톤이 달라 별도 상수로 분리).
- 이미지 에셋(`img_p11_ebook.png` 등 8개)을 `young/auction/public/lecture-materials/`에 복사.
- DB 시드: `webinar-final` 덱 20개 슬라이드 추가(기존 `webinar-2607` 24개는 유지).

### 겪은 문제와 원인

1. **프론트 500 에러**: 덱 전환 기능을 넣고 확인하려는데 `/login`부터 500을 반환. 원인은
   오래전부터 떠 있던 Next dev 서버 프로세스(며칠간 누적된 HMR 상태 꼬임으로 추정) — 정상
   종료(`Stop-Process`, force 없이) 후 `npm run dev`로 재시작하니 즉시 200으로 정상화됐다.
   **교훈**: 프론트가 이유 없이 500을 반환하면 먼저 dev 서버를 정상 재시작해볼 것.
2. **DB 데이터 유실 재발**: 시드 스크립트 실행 → 확인(같은 커넥션에서는 정상 카운트) →
   `rm -rf dist && nest build`로 재빌드 → `node dist/main.js`로 재기동 → 조회하면 두 덱 모두
   0건. 재빌드 자체가 sql.js 파일에 손상을 주는지, 그 사이 시점에 다른 프로세스가 파일을
   건드리는지 정확한 메커니즘은 특정하지 못했으나, **재현 가능한 회피책**을 확인했다: 시드
   스크립트 실행 직후 **재빌드를 생략**하고 기존 `dist/main.js`를 그대로 재기동하면 데이터가
   보존된다. 최종적으로 이 방식(시드 → 재빌드 없이 바로 `node dist/main.js`)으로 두 덱
   24+20건이 정상적으로 남아있음을 확인했다.

### 다음에 참고할 것

- **sql.js 로컬 DB에 대해 앞으로는 "시드 스크립트 실행 후 재빌드하지 않고 바로 기존 dist로
  재기동"을 기본 절차로 삼는다.** 재빌드가 꼭 필요한 코드 변경(엔티티/컨트롤러 등)이 있었다면
  재빌드 → 재기동 → 즉시 데이터 재확인(별도 스크립트로 count 조회) → 비어있으면 그 자리에서
  바로 재시딩, 이후로는 재빌드하지 않는다.
- 덱을 하나 더 늘릴 경우 `DECKS` 배열에 항목을 추가하고, `SLIDE_HEADER`/`SLIDE_IMAGES`/
  `SLIDE_FIELD_DEFS`/`SLIDE_BACKGROUND` 네 군데 모두에 새 프리픽스로 슬라이드를 추가해야
  한다(하나라도 빠지면 그 슬라이드만 렌더링이 깨짐).
- 원본 215페이지 PDF의 21~50페이지 이후는 아직 미착수 상태(`디자인 시안/PPT-HTML-복원/final/`에
  slide_1.png~slide_50.png 렌더링만 되어 있음). 이어서 작업할 때는 이 폴더의 실측 데이터와
  `webinar-final-slides.html`(스캐치패드 원본, 관리자 페이지와 별개로 보관 중)을 참고.

## 2026-07-25 追記: 21~70페이지 확장, 이미지 붙여넣기 기능, 토큰 절약 방식 전환

### 배경

215페이지짜리 새 PDF(`투자맹수오마주)7월30일 웨비나 PPT- 복사본.pdf`, `C:\Users\young\Downloads\`)를
받아 "최종본 웨비나" 덱을 21페이지부터 70페이지까지 순차적으로 확장했다. 동시에 사용자가
"강의자료 슬라이드에 이미지를 직접 붙여넣기 하고 싶다"고 요청해 Ctrl+V 이미지 업로드 기능을
추가했고, 작업 도중 토큰 소모가 너무 크다는 지적을 받아 이미지 확인 해상도/방식을 단계적으로
조정했다.

### 1. 이미지 붙여넣기(Ctrl+V) 기능 추가

- **백엔드**
  - `LectureSlide` 엔티티(`auction-api/src/lecture-materials/lecture-slide.entity.ts`)에
    `images: ImagePlacement[] | null` 컬럼 추가. `ImagePlacement = {id, src, top, left, width}`.
  - `POST /lecture-materials/upload-image` 엔드포인트 신설(`multer FileInterceptor`, 10MB 제한,
    png/jpeg/webp/gif만 허용). 업로드된 파일은 API 서버가 아니라 **Next.js 프론트의
    `young/auction/public/lecture-materials/uploads/`에 직접 write**해서, 기존
    `/lecture-materials/*.png` 정적 서빙 경로와 동일하게 동작하도록 했다(API 서버 자체에는
    정적 파일 서빙 설정이 없었음).
  - `PATCH /lecture-materials/slides/:id` 바디에 `images` 필드 추가.
  - 마이그레이션 `1784239000000-AddLectureSlideImages.ts` 추가(`images jsonb` 컬럼, 운영 postgres용
    — 로컬 sql.js는 `synchronize:true`라 마이그레이션이 실행되지 않는 구조임을 이후 재확인, 아래 참고).
- **프론트(`LectureMaterialsTab.tsx`)**
  - `api.ts`에 `uploadLectureImage(file)`, `LectureImagePlacement` 타입 추가.
  - `EditableSlideCanvas`에 `onPaste` 핸들러 추가: 캔버스를 클릭(포커스)한 상태에서 이미지를
    복사해 Ctrl+V 하면 클립보드 이미지가 자동 업로드되고 캔버스 중앙 부근(top:200, left:200,
    width:400)에 배치된다.
  - 붙여넣은 이미지는 드래그로 이동, 우하단 빨간 점 핸들로 리사이즈, 선택 후 Delete 키 또는
    "선택한 이미지 삭제" 버튼으로 제거 가능. "이미지 추가" 버튼으로 파일 선택 업로드도 지원.
  - undo(Ctrl+Z) 스택(`historyRef`, `SlideSnapshot`)에 `images` 배열도 포함시켜서, 이미지
    추가/이동/삭제도 텍스트 편집과 동일하게 되돌릴 수 있게 했다.

### 2. 토큰 소모 문제와 대응 과정

21~50페이지 작업 때 슬라이드 원본 PNG를 200dpi(4000x2250)로 렌더링해서 다수 확인했더니 토큰
소모가 매우 컸다. 사용자가 이를 지적해 다음 순서로 대안을 검토했다:

1. **OCR(tesseract) 시도** — 이미지 대신 텍스트만 추출하면 토큰이 거의 안 들 것으로 기대하고
   `pip install pytesseract` + `winget install UB-Mannheim.TesseractOCR` + 한글 언어팩(kor.traineddata)을
   설치해 51번 슬라이드로 테스트. **결과: 정확도가 실무에 못 쓸 수준.** "7주"→"7추", "만에"→"민에"
   같은 치명적 오인식이 발생했고, 텍스트 블록 하나(30대 직장인 카톡 대화)가 통째로 누락됐다.
   검증을 위해 결국 원본을 다시 봐야 해서 토큰 절감 효과가 없다고 판단, 폐기.
2. **저해상도(100dpi) 렌더링으로 전환** — 200dpi 대신 100dpi(2000x1125)로 다시 렌더링해서
   확인하니 텍스트 판독에는 전혀 문제가 없었고, 이미지당 토큰이 대략 절반 이하로 줄었다.
   **51번 이후부터는 이 방식(100dpi)을 기본으로 사용.**
3. **이미지 자리 비워두기** — 사진/스크린샷이 필요한 슬라이드(55~70번 대부분)는 원본 이미지를
   크롭하지 않고 회색 점선 placeholder(`[이미지 자리: images/sXX_photo.png]`)로만 남겨뒀다.
   사용자가 위 1번 기능(Ctrl+V)으로 직접 채워 넣는 것을 전제로 한 설계 — 이러면 사진류는
   아예 내가 볼 필요가 없어 토큰이 가장 크게 절약된다.
4. **pdfplumber `page.images`로 좌표 자동 추출 방법도 확인**(실제 사진 객체가 PDF에 삽입된
   경우 이미지를 보지 않고도 top/left/width/height를 코드로 뽑아낼 수 있음, `SCALE=1920/1440`
   곱해서 슬라이드 좌표로 환산). 이번 51~70번 작업에서는 사진 자체를 아예 안 쓰기로 해서
   실제로 활용하지는 않았지만, 사진 위치를 정확히 잡아야 할 다음 작업에서 쓸 수 있다.

### 3. 21~70페이지 등록 작업(백그라운드 에이전트 활용 시 겪은 문제)

- 21~50페이지는 별도 세션에서 이미 HTML까지 완성돼 있었고, 이번 세션에서는 관리자 페이지
  등록(`SLIDE_FIELD_DEFS`/`SLIDE_IMAGES`/`SLIDE_BACKGROUND`/`SLIDE_HEADER`)과 DB 시드만
  진행했다.
- **에이전트가 실제 작업 없이 "위임했다"는 자기 설명만 남기고 조기 종료되는 문제가 반복 발생.**
  첫 번째 시도(3번 도구 호출, 45초 만에 종료)는 완료 보고를 받았지만 실제로는 파일이 전혀
  수정되지 않았다. **교훈**: 에이전트 완료 보고를 받으면 곧바로 신뢰하지 말고, grep 등으로
  실제 파일이 바뀌었는지 최소 한 번은 직접 확인할 것. 프롬프트에도 "실제로 도구를 호출해서
  끝까지 수행하라, '위임했다'는 자기 설명이 아니라 완료한 작업 내역을 보고하라"를 명시적으로
  넣어야 재발이 줄었다.
- **로컬 sql.js DB에 대해 마이그레이션 파일은 실행되지 않는 구조임을 재확인.** `typeorm.config.ts`가
  `DATABASE_URL`이 없는 로컬 환경에서는 `synchronize:true`로 sql.js를 쓰고, 이 경로에서는
  `migrations` 배열이 있어도 TypeORM이 마이그레이션을 실행하지 않는다. 그래서 로컬 시드는
  항상 `auction-api/scripts/*.mjs`(sql.js 파일을 `initSqlJs`로 직접 열어 SQL 실행 후
  `db.export()`로 다시 파일에 씀) 패턴으로 진행하고, Postgres 운영 배포용 마이그레이션 파일은
  기록/재현성 목적으로 별도 작성해둔다(이번에 `1784240000000-SeedLectureSlides21to60.ts`,
  `1784241000000-SeedLectureSlides61to70.ts` 추가).
- DB 유실 방지 절차를 매번 지켰다: 시드 스크립트 실행 전 `auction.db`를 타임스탬프 붙여 백업 →
  API 서버 프로세스를 `Stop-Process`로 정상 종료(재빌드 없이) → `.mjs` 스크립트로 직접
  INSERT → `npm run start:dev`로 재기동 → 인증된 API 호출로 row 수와 기존 슬라이드가 그대로
  있는지 재확인. 한 번은 구버전 좀비 API 프로세스가 메모리에 있던 오래된 DB 상태로 파일을
  덮어써서 시드 결과가 유실된 적이 있었는데, 프로세스를 완전히 죽이고 재시딩해서 복구했다.

### 4. 버그: 카드형 슬라이드의 "강조 텍스트"가 관리자 화면에서 작게 보임

- **증상**: 41~46번(먼저 만든 "낙찰사례" 카드형 슬라이드)은 정상인데, 54~70번("수강생 성과"
  카드형)에서는 원본 PPT에서 46px/44px 등으로 크게 강조되던 "투자 : ○천 / 수익: ○천" 줄이
  다른 본문 텍스트와 똑같이 작게(30~36px) 보였다.
- **원인**: 41~46번은 처음부터 "표(작은 글씨)"와 "요약(56px 큰 강조)"을 `table`/`summary`
  두 개의 별도 필드로 나눠 등록했다. 반면 54~70번을 등록할 때는 시세/낙찰/투자/수익 4줄을
  `info` 필드 하나(`<br>`로 줄바꿈만 한 하나의 텍스트, fontSize 30~36 고정)에 다 몰아넣어서,
  원본 HTML에서 `<span style="font-size:46px">`로 강조되던 부분의 크기 차이가 통째로
  사라졌다.
- **수정**: 55,56,57,58,59,60,61,62,63,64,68,69번의 `SLIDE_FIELD_DEFS`를 `info`(시세/낙찰,
  작은 글씨)와 `highlight`(투자/수익, 원본 크기 그대로 큰 강조)로 분리. DB의 기존 `content`도
  `auction-api/scripts/fix-webinar-final-highlight-split.mjs`로 두 필드에 맞게 나눠서
  갱신했다(65,66,67,70번은 처음부터 `info`/`highlight`로 잘 나뉘어 있어서 문제 없었음).
- **교훈(재발 방지)**: 카드형 슬라이드를 관리자 화면에 등록할 때, 원본 HTML에 `font-size`가
  서로 다른 텍스트 블록이 한 `<div>` 안에 섞여 있으면(예: 본문 안에 `<span style="font-size:
  46px">`로 강조된 부분) **절대 하나의 필드로 뭉치지 말고 반드시 별도 필드로 나눌 것.**
  등록 후에는 관리자 화면 스크린샷이나 API 응답을 원본 HTML의 font-size 값과 대조해서
  강조 크기가 그대로 반영됐는지 확인하는 습관을 들인다.

### 5. 기타 변경

- 관리자 페이지 상단 덱 선택 드롭박스 순서를 사용자 요청으로 변경: `DECKS` 배열에서
  `webinar-final`(최종본 웨비나)을 `webinar-2607`(기존 24페이지 강의자료)보다 앞에 두어,
  드롭박스 첫 항목이자 페이지 진입 시 기본 선택 덱이 되도록 했다.
- `DECKS` 라벨을 진행 상황에 맞춰 "최종본 웨비나 (1~20페이지)" → "(1~60페이지)" →
  "(1~70페이지)" → "(1~90페이지)"로 계속 갱신했다. 페이지 수를 더 늘릴 때 라벨 갱신을
  빠뜨리지 않도록 주의.

### 6. 71~90번 슬라이드 등록 (2026-07-25)

- `webinar-final-slides.html`에 71~90번 마크업이 파일 끝에 추가된 것을 확인하고, 61~70번과
  동일한 방식으로 등록했다.
  - `LectureMaterialsTab.tsx`의 `SLIDE_FIELD_DEFS`/`SLIDE_BACKGROUND`/`SLIDE_HEADER`에
    71~90번 항목 추가, `DECKS` 라벨을 "(1~90페이지)"로 갱신.
  - 71,73,77,80,85,86번: 중앙정렬 단순 텍스트. 72,74,75,76,82,83번: 색이 다른 span이
    섞인 줄은 `groupField()`로 조각을 나눠 등록(재발 방지 규칙 준수).
  - 78번: "방법은?"(56px, `small`)과 "규제정책인한 두려움 + 방향성"(44px, `info`)과
    "낮은 경쟁입찰"(56px 파란색, `highlight`)을 각각 별도 필드로 분리 등록.
  - 89번: 노란 하이라이트 "입찰!"(`title::highlight`, backgroundColor 지정)과 나머지 문구
    (`title::suffix`)를 그룹 필드로 분리, 카드 텍스트 3개(cardTitle/cardSubtitle/cardBody)
    별도 등록.
  - 78,79,88,90번은 사진/스크린샷 자리가 회색 placeholder뿐이라 `SLIDE_IMAGES`에는 항목을
    추가하지 않음(61~70번 패턴과 동일).
  - 87번("모두 대행으로 가능")은 파란 테두리 박스 7개를 정적 요소로 두고, 각 박스 라벨만
    `label1~label7` 필드로 편집 가능하게 등록. 제목은 "모두"/"대행"(강조)/"으로 가능" 3조각
    그룹 필드로 분리.
- DB 시드: `auction-api/scripts/seed-webinar-final-71-90.mjs` 작성 후 실행. 시드 전 DB를
  `data/auction.db.bak-71-90-<timestamp>`로 백업했고, 시드 전 좀비 node 프로세스(`nest start
  --watch` 및 `dist/main` 잔존 프로세스 다수)를 모두 강제 종료한 뒤 재빌드 없이 시드 →
  `npm run start:dev`로 재기동했다. 시드 전 70개 → 시드 후 90개(20건 추가, 0건 스킵) 확인.
  Postgres 운영 배포용으로 `src/migrations/1784242000000-SeedLectureSlides71to90.ts`도
  동일한 content로 작성(`ON CONFLICT DO NOTHING`, down에서 71~90 id 삭제).
- 검증: admin/admin으로 `/auth/login` 후 쿠키로 `GET /lecture-materials/slides?deckId=
  webinar-final` 호출 → 90건, id 01~90 연속 확인. 71/78/87/89/90번 content를 원본 HTML과
  대조해 강조 필드 분리가 의도대로 반영됨을 확인. 웹 서버(localhost:3000)도 정상 응답(200)
  확인.

### 다음에 참고할 것 (갱신)

- 90페이지까지 전체 등록 완료. 향후 페이지가 더 늘어나면 동일 패턴(HTML 확인 →
  SLIDE_FIELD_DEFS/BACKGROUND/HEADER 등록 → DB 백업 → 시드 스크립트 → 마이그레이션 →
  API 응답 검증)을 반복한다. 100dpi 저해상도 렌더링 + 사진 placeholder 방식(위 2번)을
  기본으로 사용하고, 사용자가 이후 Ctrl+V로 직접 이미지를 채워 넣는 흐름을 유지한다.
- 새 카드형 슬라이드를 추가할 때는 처음부터 "본문"과 "강조 문구"를 별도 필드로 설계할 것
  (위 4번 재발 방지).
- 에이전트에게 위임한 작업은 완료 보고를 받아도 최소 한 번은 grep/API 호출 등으로 실제
  반영 여부를 직접 확인할 것(위 3번).

### 7. 91~100번 슬라이드 등록 (2026-07-25, 마지막 페이지까지 완료)

- `webinar-final-slides.html` 파일 끝(1139~1249줄)에 있던 91~100번 마크업을 확인하고,
  71~90번과 동일한 방식으로 `LectureMaterialsTab.tsx`의 `SLIDE_FIELD_DEFS`/`SLIDE_BACKGROUND`/
  `SLIDE_HEADER`에 등록, `DECKS` 라벨을 "(1~100페이지)"로 갱신했다.
  - 91,93,95번: "이제는/낙찰 후 [서비스] 부탁하세요" 제목을 `line1::prefix/emphasisText/suffix`
    그룹 필드로 분리(색이 다른 조각), "당근/해주세요" 큰 강조는 `line2` 단독 필드, 아래 검색결과
    카드(출처/제목/설명)는 `cardTitle`/`cardSubtitle`/`cardBody` 3개 필드로 분리.
  - 97번: 91/93/95와 같은 제목 그룹 패턴이지만 카드 없이 "네이버 부동산" `line2`만 있음.
  - 92,94,96번: 카톡 대화/편지 스크린샷 placeholder만 있어 실제 이미지 파일이 없으므로
    `SLIDE_FIELD_DEFS`에 빈 배열(`[]`)만 등록(편집 가능한 텍스트 없음), `SLIDE_IMAGES`에도
    항목 추가하지 않음.
  - **98,100번(재발 방지 핵심)**: 원본 HTML이 `position:absolute; top:0; bottom:0; ...
    display:flex; align-items:center; justify-content:center`인 화면 전체 중앙정렬 슬라이드.
    71~90 작업 때 이미 71/73/77/80/85/86번에서 같은 유형을 다뤄본 선례가 있어, 그 패턴(원본
    HTML의 폰트크기·줄 수를 기준으로 화면 세로 중앙 1080/2=540 부근에 오도록 top을 역산)을
    그대로 따랐다. 85,86번(2줄, 70px, line1 top:410/line2 top:570)을 참고해 98,100번도 2줄
    70px 텍스트로 구성 — 98번은 `line1::emphasisText`("돈많은")+`line1::suffix`("사람만")
    그룹 필드(top:400)와 `line2`("하는거 아니야?", top:560) 두 줄로, 100번은
    `line1::emphasisText`("1000만원으로도", top:400)와 `line2`("수익을 내고 있습니다.",
    top:560)로 등록해 top:0을 그대로 쓰지 않았다. DB `layout` 컬럼은 시드하지 않고(NULL)
    프론트의 `defaultLayout`(top:400/560)을 그대로 쓰도록 했다.
  - 99번("수강생 성과 모음"): 55~60번 카드 스타일을 축소해 6개 카드를 한 슬라이드에 모은
    요약 슬라이드. 5개는 실제 데이터, 6번째는 이미지 placeholder만 있어 실제 파일이 없으므로
    필드로 등록하지 않았다. 5개 카드 각각을 `card{N}_label`/`card{N}_info`/
    `card{N}_highlight` 3개씩, 총 15개 필드로 분리 등록(원본에서 라벨(24px)/정보(20px)/
    강조(24~26px)의 font-size가 서로 달라 하나로 뭉치지 않고 분리 — 54번 버그 재발 방지
    원칙 준수). `headerField()`로 "수강생 성과 모음" 헤더 문구도 등록.
- DB 시드: `auction-api/scripts/seed-webinar-final-91-100.mjs` 작성 후 실행(멱등, 이미
  존재하는 id는 스킵). Postgres 운영 배포용 `src/migrations/1784243000000-SeedLectureSlides91to100.ts`도
  동일 content로 작성(`ON CONFLICT DO NOTHING`, down에서 91~100 id 삭제).
- **DB 유실 위험이 실제로 재발했다**: 세션 시작 시점에 이미 91~100 데이터가 시드되어 100건
  있었으나(과거 세션에서 먼저 완료된 상태), 이번 세션에서 서버 프로세스를 여러 차례 강제
  종료(`Stop-Process`)하는 과정에서 좀비 `nest start --watch` 프로세스가 반복적으로 재생성되며
  (watch 모드 자동 재시작 추정) `lecture_slides` 테이블이 두 차례 빈 상태로 덮어써졌다. 매번
  직전에 만들어둔 백업(`auction.db.bak-91-100-20260725-131817`, 100건 확인됨)으로 복구했고,
  **모든 관련 프로세스(`node.exe`/`cmd.exe`, CommandLine에 `auction-api`/`nest` 포함)를
  완전히 죽인 것을 재확인한 뒥에만 DB를 복원**하는 순서로 최종 안정화했다. 이후 재빌드 없이
  `node --enable-source-maps dist/main`(watch 모드 아닌 단발 실행)으로 재기동해 안정적으로
  유지됨을 확인. **교훈**: `npm run start:dev`(nest watch 모드)는 파일 변경이나 좀비
  프로세스 잔존 시 예기치 않게 여러 인스턴스가 동시에 sql.js 파일을 저장해 데이터를
  덮어쓸 위험이 있다 — 로컬에서 안정적으로 재기동할 때는 재빌드 없이 `node dist/main`
  단발 실행을 우선 고려할 것.
- 검증: admin/admin으로 `/auth/login` 후 쿠키로 `GET /lecture-materials/slides?deckId=
  webinar-final` 호출 → 100건, id `webinar-final_slide-01`~`slide-100` 연속 확인. 91,98,99번
  content를 원본 HTML 및 필드 정의와 대조해 그룹 필드/카드 필드 분리가 의도대로 반영됨을
  확인. 프론트(`npx tsc --noEmit`)·백엔드(`npx tsc --noEmit`) 모두 통과. 웹 서버
  (localhost:3000, 307 리다이렉트 = 정상)와 API 서버(localhost:3001) 모두 기동 확인.

### 다음에 참고할 것 (2026-07-25 최종 갱신)

- **100페이지 전체 등록 완료.** "최종본 웨비나" 덱은 더 이상 확장할 페이지가 없다(215페이지
  원본 PDF 중 1~100페이지만 사용하기로 한 범위 완료로 추정 — 추가 확장 필요 시 사용자 확인).
- 로컬 sql.js DB 재기동 시 `nest start --watch`(nodemon류) 대신 `node dist/main` 단발 실행을
  우선 사용해 좀비 프로세스로 인한 반복적 데이터 유실 위험을 줄일 것.
- 화면 전체 중앙정렬(`top:0;bottom:0;...flex center`) 슬라이드를 새로 등록할 때는 반드시
  줄 수 × 폰트 크기를 기준으로 1080px 세로 중앙(540px) 부근에 오도록 top을 직접 계산하고,
  원본 HTML의 `top:0`을 그대로 필드에 넣지 말 것(이번에도 71~90 선례를 따라 정상 처리함).

### 7. 91~100번 슬라이드 등록 — 최종 100페이지 완성 (2026-07-25)

- `webinar-final-slides.html` 끝에 91~100번 마크업 확인 후 등록. `LectureMaterialsTab.tsx`의
  `SLIDE_FIELD_DEFS`는 이미 이전 세션에서 91~100번까지 채워져 있었으나, `SLIDE_HEADER`와
  `SLIDE_BACKGROUND`에는 99번("수강생 성과 모음", `headerField()` 사용, 흰 배경 + 파란
  헤더 배너 필요)이 누락되어 있어 이번에 추가로 등록했다(빠졌다면 헤더 문구가 밝은 배경
  위에 흰 글씨로 흐리게 보이는 문제가 재발했을 것 — 3번 항목의 버그와 동일 유형).
  - 91,93,95번: `line1::prefix/emphasisText/suffix` 그룹 필드 + `line2`(당근/해주세요) +
    `cardTitle/cardSubtitle/cardBody` 카드 텍스트 3종.
  - 97번: 그룹 필드 2줄만(카드 없음, 원본에 검색결과 카드 블록 자체가 없음).
  - 92,94,96번: 카카오톡 대화/편지 스크린샷 placeholder만 있는 슬라이드라 `content: {}`로
    시드하고 `SLIDE_IMAGES`에는 등록하지 않음(원본에 실제 이미지 파일 없음, 78/79/88/90번과
    동일 패턴).
  - 98,100번: 원본 HTML이 `top:0;bottom:0;...display:flex;align-items:center`로 수직
    중앙정렬이라, 이 값을 그대로 `defaultLayout.top:0`으로 쓰면 텍스트가 화면 상단에
    쌓이는 버그가 재발한다(71~90 등록 때 실제 겪었던 문제) — 이미 `top:400`(1줄째)/
    `top:560~400`(2줄째) 근사값으로 등록돼 있어 그대로 유지.
  - 99번: 55~60번과 같은 카드 축소판 6장을 한 슬라이드에 압축한 요약 슬라이드.
    `card1~5_label/info/highlight`로 라벨/시세정보/투자수익 강조를 필드별로 분리
    (4번 재발 방지 규칙 준수). 6번째 카드는 이미지 자리뿐이라 필드/이미지 모두 미등록.
- DB 시드: `auction-api/scripts/seed-webinar-final-91-100.mjs` 신규 작성 후 실행. 시드 전
  `data/auction.db.bak-91-100-<timestamp>`로 백업.
  - **DB 유실 재발**: 시드 스크립트 실행 직후 `npm run start:dev`로 서버를 백그라운드
    기동했는데, 도구 세션 경계를 넘나들며 프로세스가 끊기고 재시작되는 과정에서 sql.js
    파일이 빈 상태로 여러 차례 덮어써졌다(오래된 좀비 프로세스가 autoSave로 옛 스냅샷을
    다시 써버린 것으로 추정). 최종적으로 백업에서 복원 → 시드 재실행 → **서버 기동과
    로그인/조회 검증을 전부 한 번의 Bash 호출 안에서 처리하고 그 안에서 서버를 종료**하는
    방식으로 안정적으로 검증했다. **교훈**: 이 환경은 백그라운드로 띄운 dev 서버가 다음
    도구 호출까지 살아있다는 보장이 없다 — 시드 직후 검증까지 한 번의 셸 세션(호출) 안에서
    끝내는 것이 가장 안전하다.
  - 시드 전 90개 → 시드 후 100개(10건 추가, 0건 스킵) 확인. Postgres 운영 배포용으로
    `src/migrations/1784243000000-SeedLectureSlides91to100.ts`도 동일 content로 작성
    (`ON CONFLICT DO NOTHING`, down에서 91~100 id 삭제).
- 검증: admin/admin으로 `/auth/login` 후 쿠키로 `GET /lecture-materials/slides?deckId=
  webinar-final` 호출 → 100건, id 01~100 연속 확인. 91/98/99/100번 content를 원본 HTML과
  대조해 그룹 필드 분리·카드 필드 분리가 의도대로 반영됨을 확인.
- `DECKS` 라벨은 이미 "최종본 웨비나 (1~100페이지)"로 갱신되어 있었음(이전 세션에서 처리).
- 관련 파일: `young/auction/src/app/admin/LectureMaterialsTab.tsx`,
  `auction-api/scripts/seed-webinar-final-91-100.mjs`,
  `auction-api/src/migrations/1784243000000-SeedLectureSlides91to100.ts`.

## 2026-07-25 追記: 101~110번 슬라이드 등록

- 기존 구현에는 101~105번까지 등록되어 있었으나 작업 이력의 마지막 설명이 100페이지에
  머물러 있어 현재 상태와 맞지 않았다. 실제 구현 기준을 반영해 이 문서를 갱신했다.
- 101~105번은 `SeedLectureSlides101to105` 마이그레이션과 로컬 시드 스크립트로 등록되어 있다.
- 사용자가 제공한 원본 PPTX
  `투자맹수오마주_7월30일 웨비나 PPT.pptx`에서 106~110번을 추가로 복원했다.
  - PPTX 내부 XML에서 텍스트, 런별 크기·색상, 도형 좌표와 원본 미디어 관계를 추출했다.
  - PowerPoint로 1920×1080 PNG를 내보내 실제 배치와 추출값을 교차 검증했다.
  - 원본 미디어 `image162.png`~`image184.png`를 프런트 정적 자산으로 복사해
    스크린샷·이모지·장식 요소를 임의 대체하지 않고 그대로 사용했다.
  - 107번의 투자금·차익처럼 글자 크기와 강조 배경이 다른 문구는 본문과 별도 그룹 필드로
    분리했다. 109번의 색이 다른 한 줄 문구도 `groupField()`로 묶어 겹침을 방지했다.
- 프런트 덱 라벨을 `최종본 웨비나 (1~110페이지)`로 갱신하고,
  `SLIDE_IMAGES`/`SLIDE_FIELD_DEFS`/`SLIDE_BACKGROUND`에 106~110번을 등록했다.
- 로컬 sql.js용 `scripts/seed-webinar-final-106-110.mjs`와 운영 PostgreSQL용
  `1784245000000-SeedLectureSlides106to110.ts` 마이그레이션을 추가했다.
- 검증 시에는 기존 규칙대로 로컬 DB를 먼저 백업하고, 실행 중인 API 프로세스가 없는지
  확인한 다음 시드해야 한다. 시드 후에는 110건과 id 01~110 연속성을 확인한다.
