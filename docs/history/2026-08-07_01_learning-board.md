# 과제·서비스 제보 게시판

## 범위

- 수강생(STUDENT) 이상 등급만 과제 게시판과 서비스 버그·개선 제보를 이용한다.
- 물건 찾기 과제는 사건번호/주소, 주변 시세 조사, 전화 시세 조사 결과, 최종 시세, 입찰가, 필요자금, 메모를 저장한다.
- 입찰계획의 수치와 연결할 수 있도록 `auctionId`, `requiredEquity`를 저장한다.
- 서비스 제보는 버그/개선 제안 유형, 제목, 상세 내용, 상태와 관리자 답변 필드를 가진다.

## API

- `GET/POST /learning-board/assignments`
- `PATCH /learning-board/assignments/:id`
- `GET/POST /learning-board/reports`

모든 API는 기존 `requireSearchAccess`를 사용해 수강생 이상을 서버에서 검증한다. 데이터는 `auction_assignments`, `service_reports` 테이블에 저장한다.

## 화면

- `/assignments`: 과제 입력 및 본인 과제 목록
- `/reports`: 서비스 버그·개선 제보 및 본인 제보 목록

후속 작업으로 입찰계획 목록의 각 행에서 과제 작성 화면으로 이동하는 링크와 관리자 답변 화면을 추가할 수 있다.

## 追記 (2026-08-07) — 과제제출 방식 변경 + 코치 검토 화면 추가

사용자 요청: "과제제출 방식을 바꾸고 싶어... 기존에 물건을 볼때 수강생
등급인 사람은 입찰계획 저장 버튼 위에 과제제출 버튼이 있어서 그걸
누르면... 입찰계획 내용이 같이 저장돼서 과제제출이 되면... 해당
과제제출 내용은 입찰계획에서 보이는게 아니라 내물건 > 관심물건/
입찰계획/과제제출 이렇게 탭이 하나 있어서" + "코치(관리자는) 해당
제출된 내용을 볼 수 있으면 좋겠어".

### 제출 흐름 변경
- 별도 `/assignments` 페이지에서 직접 입력·제출하던 방식을 없애고,
  물건 상세(수익계산기, `ProfitCalculatorPanel.tsx`)의 "입찰계획 저장"
  버튼 위에 "과제제출" 버튼을 추가(수강생/컨설팅수강생/컨설턴트/관리자
  등급만 노출). 클릭하면 메모/전화시세결과(4)/주변 안전마진 조사(4)를
  입력하는 폼이 펼쳐지고, 제출 시 현재 계산기의 입찰가·매도가·최종수익·
  필요자기자본(입찰계획 값)을 함께 저장한다 — 입찰계획도 이 시점에
  같이 저장(갱신)된다.
- 같은 물건에 이미 제출한 과제가 있으면 새로 만들지 않고 덮어쓴다
  (`LearningBoardService.saveAssignment` upsert, username+auctionId
  기준). 물건 상세를 열 때 `GET /learning-board/assignments/by-auction/
  :auctionId`로 기존 제출 여부를 확인해 폼을 미리 채운다.
- `/assignments` 페이지는 완전히 지우지 않고 `/favorites?tab=assignments`
  로 리다이렉트만 하도록 남겨둠(입찰 달력·서비스 제보 페이지 네비 링크가
  이 경로를 참조하고 있어 깨지지 않게 하기 위함).

### 제출 현황 열람 위치 변경
- `/favorites`(내 물건) 페이지의 탭을 관심물건/입찰계획 2개에서
  **관심물건/입찰계획/과제제출 3개**로 개편. 입찰계획 탭 각 행에 있던
  인라인 "과제 제출" 링크는 제거(이제 물건 상세에서 제출하므로 불필요).
  과제제출 탭에서는 제출한 과제 목록 + 코치 피드백 표시 + 인라인 수정
  (전화시세/안전마진/메모, `PATCH /learning-board/assignments/:id`)을
  제공한다.

### 코치(관리자) 검토 화면 신설
- `GET /learning-board/assignments/coach`(전체 제출 목록, 소유자 제한
  없음) / `PATCH /learning-board/assignments/:id/coach`(피드백·상태
  저장, 소유자 제한 없음) — 둘 다 `requireAdmin`으로 보호.
- 관리자 페이지에 "과제 검토" 탭(`AssignmentReviewTab.tsx`) 신설 —
  제출자별 과제를 펼쳐서 메모/전화시세/안전마진/입찰계획 수치를 보고
  코치 피드백을 남기거나 "확인 완료"로 상태를 바꿀 수 있다.

### 참고
- `AuctionAssignment` 프론트 타입에 빠져 있던 `finalProfit` 필드를
  추가(백엔드 엔티티엔 있었으나 프론트 인터페이스에서 누락돼 있었음).

## 追記 (2026-08-07, 2차) — 코치 검토 화면에 입찰계획 상세 추가

사용자 확인 질문: "제출된 과제는 관리자(코치)한테는 어떻게 보여?
입찰계획까지 보이나?? 지금은 안보이는거 같아서" — 실제로
`AssignmentReviewTab.tsx`엔 요약 3개(입찰가/매도가/수익)만 보이고
계산기 상세 입력값(대출비율/이자율/보유기간/인테리어비용/명도비/
부가세 등)은 `auction_assignments`에 아예 저장되지 않아 보여줄 방법이
없었다(입찰계획 전체 입력값은 `auction_bid_plans.inputsJson`에만
있음).

- `GET /bid-plans/coach/:username/:auctionId`(requireAdmin, 소유자
  제한 없음) 추가 — `bidPlanService.findOne()`을 그대로 재사용.
- `AssignmentReviewTab.tsx`에 행을 펼칠 때 이 API로 제출자의 저장된
  입찰계획을 가져와 계산기 전체 입력값(라벨 매핑, `inputsJson` 파싱)
  + 입찰계획 자체 메모를 함께 표시. 목록 헤더 요약에도 빠져 있던
  "투입자금"(requiredEquity)을 추가.

과제제출 당시 입찰계획도 함께 저장(upsert)되므로, 코치는 이제 학생이
과제제출 버튼을 눌렀을 때의 계산기 스냅샷 전체를 볼 수 있다.
